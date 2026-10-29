//! Persistencia SQLite y caché usados por los comandos de escritorio.
use crate::{
    http::ConnectionError,
    provider::{fetch_catalog, fresh},
    validation::{self, valid_input},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{path::Path, time::Duration};

#[derive(Debug, Serialize)]
pub struct Catalog {
    pub rates: Vec<serde_json::Value>,
    pub fetched: String,
    pub cached: bool,
    pub warning: Option<String>,
}
fn database(path: &Path) -> Result<Connection, String> {
    if let Some(dir) = path.parent().filter(|dir| !dir.as_os_str().is_empty()) {
        std::fs::create_dir_all(dir).map_err(|_| "No se pudo crear el directorio de datos")?;
    }
    let db = Connection::open(path).map_err(|_| "No se pudo abrir SQLite")?;
    db.busy_timeout(Duration::from_secs(5))
        .map_err(|_| "SQLite no disponible")?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, data TEXT NOT NULL, fetched TEXT NOT NULL); CREATE TABLE IF NOT EXISTS budgets (id TEXT PRIMARY KEY, data TEXT NOT NULL);").map_err(|_| "No se pudo inicializar SQLite")?;
    Ok(db)
}
pub async fn azure_prices(
    path: &Path,
    sku: &str,
    region: &str,
    ttl_hours: u32,
) -> Result<Catalog, ConnectionError> {
    cached_catalog(path, sku, region, ttl_hours, || async {
        tokio::time::timeout(Duration::from_secs(90), fetch_catalog(sku, region))
            .await
            .unwrap_or_else(|_| {
                Err("Azure superó el tiempo máximo de consulta (90 segundos)".into())
            })
    })
    .await
}

async fn cached_catalog<F, Fut>(
    path: &Path,
    sku: &str,
    region: &str,
    ttl_hours: u32,
    fetch: F,
) -> Result<Catalog, ConnectionError>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<Vec<serde_json::Value>, ConnectionError>>,
{
    if !valid_input(sku, region, ttl_hours) {
        return Err("SKU, región o caducidad no válidos".into());
    }
    let key = format!("azure:USD:{}:{}", region, sku);
    // La conexión no cruza el await; SQLite se abre solo para lecturas/escrituras breves.
    let saved: Option<(String, String)> = {
        let db = database(path)?;
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
    let result = fetch().await;
    match result {
        Ok(rates) => {
            let fetched = chrono::Utc::now().to_rfc3339();
            let data =
                serde_json::to_string(&rates).map_err(|_| "No se pudo serializar catálogo")?;
            database(path)?
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
                    "{} {} Se muestran tarifas de caché sin actualizar; revisa su fecha.",
                    error.message, error.action
                )),
            }),
            None => Err(error),
        },
    }
}
pub fn save_budget(path: &Path, id: &str, data: &str) -> Result<(), String> {
    let data = validation::normalize_budget(id, data)?;
    database(path)?
        .execute(
            "INSERT INTO budgets(id,data) VALUES(?1,?2)",
            params![id, data],
        )
        .map_err(|_| "No se pudo guardar presupuesto")?;
    Ok(())
}
pub fn list_budgets(path: &Path) -> Result<Vec<String>, String> {
    let db = database(path)?;
    let mut stmt = db
        .prepare("SELECT data FROM budgets ORDER BY rowid DESC LIMIT 1000")
        .map_err(|_| "No se pudo leer historial")?;
    let rows = stmt
        .query_map([], |r| r.get(0))
        .map_err(|_| "No se pudo leer historial")?;
    rows.collect::<Result<Vec<String>, _>>()
        .map_err(|_| "Historial no válido".into())
}

#[cfg(test)]
mod tests;
