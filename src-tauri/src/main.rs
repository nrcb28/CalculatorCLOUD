#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::time::Duration;
use tauri::Manager;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const AZURE: &str = "https://prices.azure.com/api/retail/prices";
#[derive(Deserialize)]
struct Page {
    #[serde(rename = "Items")] items: Vec<serde_json::Value>,
    #[serde(rename = "NextPageLink")] next: Option<String>,
}
#[derive(Serialize)]
struct Catalog { rates: Vec<serde_json::Value>, fetched: String, cached: bool }
fn database(app: &tauri::AppHandle) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(|_| "Directorio de datos no disponible")?;
    std::fs::create_dir_all(&dir).map_err(|_| "No se pudo crear el directorio de datos")?;
    let db = Connection::open(dir.join("cloudcost.db")).map_err(|_| "No se pudo abrir SQLite")?;
    db.busy_timeout(Duration::from_secs(5)).map_err(|_| "SQLite no disponible")?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, data TEXT NOT NULL, fetched TEXT NOT NULL); CREATE TABLE IF NOT EXISTS budgets (id TEXT PRIMARY KEY, data TEXT NOT NULL);").map_err(|_| "No se pudo inicializar SQLite")?;
    Ok(db)
}
fn valid_input(sku: &str, region: &str, ttl: u32) -> bool {
    !sku.is_empty() && sku.len() <= 100 && sku.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == ' ')
        && !region.is_empty() && region.len() <= 40 && region.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()) && (1..=720).contains(&ttl)
}
fn valid_url(url: &url::Url) -> bool {
    url.scheme() == "https" && url.host_str() == Some("prices.azure.com") && url.port_or_known_default() == Some(443) && url.path() == "/api/retail/prices" && url.username().is_empty() && url.password().is_none()
}
async fn fetch_catalog(sku: &str, region: &str) -> Result<Vec<serde_json::Value>, String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(30)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_| "Cliente HTTPS no disponible")?;
    let mut next = url::Url::parse(AZURE).map_err(|_| "URL no válida")?;
    next.query_pairs_mut().append_pair("api-version", "2023-01-01-preview").append_pair("currencyCode", "'USD'").append_pair("$filter", &format!("serviceName eq 'Virtual Machines' and armRegionName eq '{}' and armSkuName eq '{}' and priceType eq 'Consumption'", region, sku));
    let mut all = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for _ in 0..100 {
        if !valid_url(&next) || !seen.insert(next.to_string()) { return Err("Paginación Azure no válida".into()); }
        let mut response = None;
        for attempt in 0..3 {
            match client.get(next.clone()).send().await {
                Ok(r) if r.status().is_success() => { response = Some(r); break; },
                Ok(r) if r.status().as_u16() == 429 || r.status().is_server_error() => {
                    let delay = r.headers().get("retry-after").and_then(|x| x.to_str().ok()).and_then(|x| x.parse::<u64>().ok()).unwrap_or(1 << attempt).min(30);
                    tokio::time::sleep(Duration::from_secs(delay)).await;
                },
                Ok(r) => return Err(format!("Azure respondió HTTP {}", r.status().as_u16())),
                Err(_) => { tokio::time::sleep(Duration::from_secs(1 << attempt)).await; }
            }
        }
        let r = response.ok_or("Azure no disponible tras tres intentos")?;
        if r.content_length().unwrap_or(0) > 20_000_000 { return Err("Respuesta demasiado grande".into()); }
        let page: Page = r.json().await.map_err(|_| "Respuesta Azure no válida")?;
        all.extend(page.items);
        if all.len() > 100_000 { return Err("Catálogo demasiado grande".into()); }
        match page.next.filter(|s| !s.is_empty()) {
            Some(link) => next = url::Url::parse(&link).map_err(|_| "Enlace Azure no válido")?,
            None => return Ok(all),
        }
    }
    Err("Se alcanzó el límite de páginas; no se usa un catálogo parcial".into())
}
#[tauri::command]
async fn azure_prices(app: tauri::AppHandle, sku: String, region: String, ttl_hours: u32) -> Result<Catalog, String> {
    if !valid_input(&sku, &region, ttl_hours) { return Err("SKU, región o caducidad no válidos".into()); }
    let key = format!("azure:USD:{}:{}", region, sku);
    // La conexión no cruza el await; SQLite se abre solo para lecturas/escrituras breves.
    let saved: Option<(String,String)> = {
        let db = database(&app)?;
        db.query_row("SELECT data, fetched FROM cache WHERE key=?1", [&key], |r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(|_| "No se pudo leer caché")?
    };
    if let Some((data, fetched)) = &saved {
        if let Ok(date) = chrono::DateTime::parse_from_rfc3339(fetched) {
            if chrono::Utc::now().signed_duration_since(date).num_seconds() < i64::from(ttl_hours)*3600 {
                return Ok(Catalog {rates:serde_json::from_str(data).map_err(|_| "Caché no válida")?, fetched:fetched.clone(),cached:true});
            }
        }
    }
    match fetch_catalog(&sku, &region).await {
        Ok(rates) => {
            let fetched = chrono::Utc::now().to_rfc3339();
            let data = serde_json::to_string(&rates).map_err(|_| "No se pudo serializar catálogo")?;
            database(&app)?.execute("INSERT OR REPLACE INTO cache(key,data,fetched) VALUES(?1,?2,?3)", params![key,data,fetched]).map_err(|_| "No se pudo guardar caché")?;
            Ok(Catalog {rates,fetched,cached:false})
        },
        Err(error) => match saved {
            Some((data,fetched)) => Ok(Catalog {rates:serde_json::from_str(&data).map_err(|_| "Caché no válida")?,fetched,cached:true}),
            None => Err(format!("{}. No hay tarifas guardadas para este SKU y región.", error)),
        }
    }
}
#[derive(Serialize)]
struct ConnectionStatus { provider: String, message: String }
#[tauri::command]
async fn check_provider(provider: String, api_key: Option<String>) -> Result<ConnectionStatus, String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(20)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_| "Cliente HTTPS no disponible")?;
    let request = match provider.as_str() {
        "Azure" => client.get(AZURE).query(&[("$filter", "serviceName eq 'Virtual Machines' and armRegionName eq 'westeurope' and armSkuName eq 'Standard_D4s_v5'")]),
        "AWS" => client.get("https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/index.json"),
        "GCP" => {
            let key = api_key.as_deref().filter(|k| !k.is_empty() && k.len()<500 && k.is_ascii()).ok_or("Introduce una API key de un proyecto con Cloud Billing API habilitada")?;
            client.get("https://cloudbilling.googleapis.com/v1/services?pageSize=1").header("X-Goog-Api-Key", key)
        },
        _ => return Err("Proveedor desconocido".into()),
    };
    let response = request.send().await.map_err(|_| "Sin conexión: comprueba Internet, proxy y firewall. Un login no corrige un bloqueo de red.")?;
    let code = response.status().as_u16();
    if !response.status().is_success() {
        return Err(match code {401|403 => "Acceso rechazado (401/403): revisa permisos, API habilitada y restricciones de clave; también puede intervenir el proxy.".into(),429 => "Límite de solicitudes alcanzado. Inténtalo más tarde.".into(),_=>format!("El proveedor devolvió HTTP {}",code)});
    }
    // No se persiste la clave ni se conserva en estado; se utiliza solo durante esta comprobación.
    Ok(ConnectionStatus {provider, message: "Endpoint oficial accesible. Esta prueba verifica acceso, no una estimación ni un catálogo normalizado de precios.".into()})
}
#[tauri::command]
fn save_budget(app: tauri::AppHandle, id: String, data: String) -> Result<(), String> {
    if id.len()>100 || data.len()>5_000_000 { return Err("Presupuesto demasiado grande".into()); }
    let value:serde_json::Value = serde_json::from_str(&data).map_err(|_| "JSON no válido")?;
    if !value.is_object() || !value["rates"].is_array() || !value["config"].is_object() {return Err("Presupuesto no válido".into());}
    database(&app)?.execute("INSERT INTO budgets(id,data) VALUES(?1,?2)", params![id,data]).map_err(|_| "No se pudo guardar presupuesto")?;
    Ok(())
}
#[tauri::command]
fn list_budgets(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let db=database(&app)?;
    let mut stmt=db.prepare("SELECT data FROM budgets ORDER BY rowid DESC LIMIT 1000").map_err(|_| "No se pudo leer historial")?;
    let rows=stmt.query_map([], |r| r.get(0)).map_err(|_| "No se pudo leer historial")?;
    rows.collect::<Result<Vec<String>,_>>().map_err(|_| "Historial no válido".into())
}
fn main() {
    tauri::Builder::default().invoke_handler(tauri::generate_handler![azure_prices,check_provider,save_budget,list_budgets]).run(tauri::generate_context!()).expect("No se pudo iniciar CloudCost Compare");
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn validates_filters(){assert!(valid_input("Standard_D4s_v5","westeurope",24));assert!(!valid_input("x' or true","westeurope",24));assert!(!valid_input("x","../",24));assert!(!valid_input("x","eastus",0));}
    #[test] fn restricts_pagination(){assert!(valid_url(&url::Url::parse(AZURE).unwrap()));for bad in ["http://prices.azure.com/api/retail/prices","https://evil.example/api/retail/prices","https://prices.azure.com:8443/api/retail/prices","https://prices.azure.com/other"] { assert!(!valid_url(&url::Url::parse(bad).unwrap())); }}
}
