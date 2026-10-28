#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use cloudcost_core::{
    provider::{bounded_json, fetch_catalog, fresh, AZURE},
    validation::{self, valid_input},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::time::Duration;
use tauri::Manager;

#[derive(Serialize)]
struct Catalog {
    rates: Vec<serde_json::Value>,
    fetched: String,
    cached: bool,
    warning: Option<String>,
}
fn database(app: &tauri::AppHandle) -> Result<Connection, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Directorio de datos no disponible")?;
    std::fs::create_dir_all(&dir).map_err(|_| "No se pudo crear el directorio de datos")?;
    let db = Connection::open(dir.join("cloudcost.db")).map_err(|_| "No se pudo abrir SQLite")?;
    db.busy_timeout(Duration::from_secs(5))
        .map_err(|_| "SQLite no disponible")?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, data TEXT NOT NULL, fetched TEXT NOT NULL); CREATE TABLE IF NOT EXISTS budgets (id TEXT PRIMARY KEY, data TEXT NOT NULL);").map_err(|_| "No se pudo inicializar SQLite")?;
    Ok(db)
}
#[tauri::command]
async fn azure_prices(
    app: tauri::AppHandle,
    sku: String,
    region: String,
    ttl_hours: u32,
) -> Result<Catalog, String> {
    if !valid_input(&sku, &region, ttl_hours) {
        return Err("SKU, región o caducidad no válidos".into());
    }
    let key = format!("azure:USD:{}:{}", region, sku);
    // La conexión no cruza el await; SQLite se abre solo para lecturas/escrituras breves.
    let saved: Option<(String, String)> = {
        let db = database(&app)?;
        db.query_row(
            "SELECT data, fetched FROM cache WHERE key=?1",
            [&key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|_| "No se pudo leer caché")?
    };
    if let Some((data, fetched)) = &saved {
        if fresh(fetched, ttl_hours, chrono::Utc::now()) {
            if let Ok(rates) = serde_json::from_str::<Vec<serde_json::Value>>(data) {
                return Ok(Catalog {
                    rates,
                    fetched: fetched.clone(),
                    cached: true,
                    warning: None,
                });
            }
        }
    }
    let result = tokio::time::timeout(Duration::from_secs(90), fetch_catalog(&sku, &region))
        .await
        .unwrap_or_else(|_| Err("Azure superó el tiempo máximo de consulta (90 segundos)".into()));
    match result {
        Ok(rates) => {
            let fetched = chrono::Utc::now().to_rfc3339();
            let data =
                serde_json::to_string(&rates).map_err(|_| "No se pudo serializar catálogo")?;
            database(&app)?
                .execute(
                    "INSERT OR REPLACE INTO cache(key,data,fetched) VALUES(?1,?2,?3)",
                    params![key, data, fetched],
                )
                .map_err(|_| "No se pudo guardar caché")?;
            Ok(Catalog {
                rates,
                fetched,
                cached: false,
                warning: None,
            })
        }
        Err(error) => match saved {
            Some((data, fetched)) => Ok(Catalog {
                rates: serde_json::from_str(&data).map_err(|_| "Caché no válida")?,
                fetched,
                cached: true,
                warning: Some(format!(
                    "{}. Se muestran tarifas de caché sin actualizar; revisa su fecha.",
                    error
                )),
            }),
            None => Err(format!(
                "{}. No hay tarifas guardadas para este SKU y región.",
                error
            )),
        },
    }
}
#[derive(Serialize)]
struct ConnectionStatus {
    provider: String,
    message: String,
}
#[tauri::command]
async fn check_provider(
    provider: String,
    api_key: Option<String>,
) -> Result<ConnectionStatus, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Cliente HTTPS no disponible")?;
    let request = match provider.as_str() {
        "Azure" => client.get(AZURE).query(&[("$filter", "serviceName eq 'Virtual Machines' and armRegionName eq 'westeurope' and armSkuName eq 'Standard_D4s_v5'")]),
        "AWS" => client.get("https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/index.json"),
        "GCP" => {
            let key = api_key.as_deref().filter(|k| !k.is_empty() && k.len()<500 && k.is_ascii()).ok_or("Introduce una API key de un proyecto con Cloud Billing API habilitada")?;
            client.get("https://cloudbilling.googleapis.com/v1/services?pageSize=1").header("X-Goog-Api-Key", key)
        },
        _ => return Err("Proveedor desconocido".into()),
    };
    let response = request.send().await.map_err(|_| {
        "Sin conexión: comprueba Internet, proxy y firewall. Un login no corrige un bloqueo de red."
    })?;
    let code = response.status().as_u16();
    if !response.status().is_success() {
        return Err(match code {401|403 => "Acceso rechazado (401/403): revisa permisos, API habilitada y restricciones de clave; también puede intervenir el proxy.".into(),429 => "Límite de solicitudes alcanzado. Inténtalo más tarde.".into(),_=>format!("El proveedor devolvió HTTP {}",code)});
    }
    let body = bounded_json(response).await?;
    let valid = match provider.as_str() {
        "Azure" => body.get("Items").is_some_and(|items| items.is_array()),
        "AWS" => body.get("offers").is_some_and(|offers| offers.is_object()),
        "GCP" => body
            .get("services")
            .is_some_and(|services| services.is_array()),
        _ => false,
    };
    if !valid {
        return Err("El endpoint respondió pero el catálogo no tiene el formato esperado".into());
    }
    // No se persiste la clave ni se conserva en estado; se utiliza solo durante esta comprobación.
    Ok(ConnectionStatus {provider, message: "Endpoint oficial accesible. Esta prueba verifica acceso, no una estimación ni un catálogo normalizado de precios.".into()})
}
#[tauri::command]
fn save_budget(app: tauri::AppHandle, id: String, data: String) -> Result<(), String> {
    validation::validate_budget(&id, &data)?;
    database(&app)?
        .execute(
            "INSERT INTO budgets(id,data) VALUES(?1,?2)",
            params![id, data],
        )
        .map_err(|_| "No se pudo guardar presupuesto")?;
    Ok(())
}
#[tauri::command]
fn list_budgets(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let db = database(&app)?;
    let mut stmt = db
        .prepare("SELECT data FROM budgets ORDER BY rowid DESC LIMIT 1000")
        .map_err(|_| "No se pudo leer historial")?;
    let rows = stmt
        .query_map([], |r| r.get(0))
        .map_err(|_| "No se pudo leer historial")?;
    rows.collect::<Result<Vec<String>, _>>()
        .map_err(|_| "Historial no válido".into())
}
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            azure_prices,
            check_provider,
            save_budget,
            list_budgets
        ])
        .run(tauri::generate_context!())
        .expect("No se pudo iniciar CloudCost Compare");
}
