#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use cloudcost_core::{
    http::{self, ConnectionError},
    multicloud,
    provider::{bounded_json, fetch_components, AZURE},
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
#[tauri::command]
async fn azure_components(region: String) -> Result<serde_json::Value, ConnectionError> {
    fetch_components(&region).await
}
#[tauri::command]
async fn compute_quote(
    provider: String,
    instance_type: String,
    region: String,
    api_key: Option<String>,
) -> Result<serde_json::Value, ConnectionError> {
    match provider.as_str() {
        "AWS" => multicloud::fetch_aws(&instance_type, &region).await,
        "GCP" => {
            multicloud::fetch_gcp(&instance_type, &region, api_key.as_deref().unwrap_or("")).await
        }
        _ => Err("Proveedor de comparación desconocido".into()),
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
#[tauri::command]
fn save_project(app: tauri::AppHandle, data: String) -> Result<(), String> {
    storage::save_project(&database_path(&app)?, &data)
}
#[tauri::command]
fn list_projects(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    storage::list_projects(&database_path(&app)?)
}
#[tauri::command]
async fn project_pdf(data: String) -> Result<cloudcost_core::report_pdf::ReportPdf, String> {
    tokio::task::spawn_blocking(move || cloudcost_core::report_pdf::render(&data))
        .await
        .map_err(|_| "No se pudo generar el informe")?
}
#[derive(Serialize)]
struct SavedPdf {
    saved: bool,
    pages: usize,
    monthly: String,
    total: String,
}
#[tauri::command]
async fn save_project_pdf(
    app: tauri::AppHandle,
    data: String,
    expected_monthly: String,
    expected_total: String,
) -> Result<SavedPdf, String> {
    tokio::task::spawn_blocking(move || {
        use std::io::Write;
        use tauri_plugin_dialog::DialogExt;
        let report = cloudcost_core::report_pdf::render(&data)?;
        if report.monthly != expected_monthly || report.total != expected_total {
            return Err(
                "El cálculo PDF no coincide con el proyecto. No se guardó ningún archivo.".into(),
            );
        }
        let chosen = app
            .dialog()
            .file()
            .set_title("Guardar informe PDF del proyecto")
            .add_filter("Documento PDF", &["pdf"])
            .set_file_name("proyecto.pdf")
            .blocking_save_file();
        let saved = if let Some(file) = chosen {
            let path = file.into_path().map_err(|_| "Ruta de PDF no disponible")?;
            let parent = path.parent().ok_or("Carpeta no disponible")?;
            let mut temp = tempfile::NamedTempFile::new_in(parent)
                .map_err(|_| "No se pudo preparar el PDF en la carpeta elegida")?;
            temp.write_all(&report.bytes)
                .map_err(|_| "No se pudo escribir el PDF")?;
            temp.as_file()
                .sync_all()
                .map_err(|_| "No se pudo completar el PDF")?;
            temp.persist(path)
                .map_err(|_| "No se pudo guardar el PDF en la ruta elegida")?;
            true
        } else {
            false
        };
        Ok(SavedPdf {
            saved,
            pages: report.pages,
            monthly: report.monthly,
            total: report.total,
        })
    })
    .await
    .map_err(|_| "No se pudo exportar el informe")?
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            azure_prices,
            azure_components,
            compute_quote,
            check_provider,
            save_budget,
            list_budgets,
            save_project,
            list_projects,
            project_pdf,
            save_project_pdf
        ])
        .run(tauri::generate_context!())
        .expect("No se pudo iniciar CloudCost Compare");
}
