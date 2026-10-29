#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use cloudcost_core::{
    http::{self, ConnectionError},
    provider::{bounded_json, AZURE},
    storage,
};
use serde::Serialize;
use std::time::Duration;
use tauri::Manager;

fn database_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("cloudcost.db"))
        .map_err(|_| "Directorio de datos no disponible".into())
}
#[tauri::command]
async fn azure_prices(
    app: tauri::AppHandle,
    sku: String,
    region: String,
    ttl_hours: u32,
    force_refresh: Option<bool>,
) -> Result<storage::Catalog, ConnectionError> {
    storage::azure_prices(
        &database_path(&app)?,
        &sku,
        &region,
        ttl_hours,
        force_refresh.unwrap_or(false),
    )
    .await
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
) -> Result<ConnectionStatus, ConnectionError> {
    let client = http::client(Duration::from_secs(20))?;
    let host = match provider.as_str() {
        "Azure" => "prices.azure.com",
        "AWS" => "pricing.us-east-1.amazonaws.com",
        "GCP" => "cloudbilling.googleapis.com",
        _ => return Err("Proveedor desconocido".into()),
    };
    let request = match provider.as_str() {
        "Azure" => client.get(AZURE).query(&[("$filter", "serviceName eq 'Virtual Machines' and armRegionName eq 'westeurope' and armSkuName eq 'Standard_D4s_v5'")]),
        "AWS" => client.get("https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/index.json"),
        "GCP" => {
            let key = api_key.as_deref().filter(|k| !k.is_empty() && k.len()<500 && k.is_ascii()).ok_or("Introduce una API key de un proyecto con Cloud Billing API habilitada")?;
            client.get("https://cloudbilling.googleapis.com/v1/services?pageSize=1").header("X-Goog-Api-Key", key)
        },
        _ => return Err("Proveedor desconocido".into()),
    };
    let response = request
        .send()
        .await
        .map_err(|error| http::from_transport(&error, host))?;
    if !response.status().is_success() {
        return Err(http::status_error(response.status().as_u16(), host));
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
    storage::save_budget(&database_path(&app)?, &id, &data)
}
#[tauri::command]
fn list_budgets(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    storage::list_budgets(&database_path(&app)?)
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
