//! Comprobación optativa Azure → SQLite → caché → snapshot → reapertura, sin GUI.
use cloudcost_core::{provider::AZURE, storage};
use serde_json::json;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = PathBuf::from(std::env::args().nth(1).ok_or(
        "Indica una ruta nueva para la base de diagnóstico; nunca uses datos de la aplicación",
    )?);
    if path.exists() {
        return Err("La base de diagnóstico ya existe; usa una ruta nueva".into());
    }
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    runtime.block_on(async {
        let live = storage::azure_prices(&path, "Standard_D4s_v5", "westeurope", 24, false).await?;
        if live.cached || live.rates.is_empty() {
            return Err("Se esperaba un catálogo de red en una base vacía".into());
        }
        let cached =
            storage::azure_prices(&path, "Standard_D4s_v5", "westeurope", 24, false).await?;
        if !cached.cached || cached.fetched != live.fetched || cached.rates != live.rates {
            return Err("La reapertura no recuperó el catálogo original".into());
        }
        // Medidor PAYG Linux revisado en docs/AZURE-LIVE.md. No elegir el más barato.
        let options: Vec<_> = live
            .rates
            .iter()
            .filter(|rate| {
                rate["meterId"] == "1ab41620-5ffa-51b3-ac16-6416f9f747a9"
                    && rate["productName"] == "Virtual Machines Dsv5 Series"
                    && rate["meterName"] == "D4s v5"
                    && rate["tierMinimumUnits"].as_f64() == Some(0.0)
            })
            .collect();
        if options.len() != 1 {
            return Err("El catálogo cambió: revisa expresamente la opción Linux PAYG".into());
        }
        let snapshot = json!({
            "id": "sqlite-live-diagnostic", "name": "Verificación Azure y SQLite",
            "created": chrono::Utc::now().to_rfc3339(), "fetched": live.fetched,
            "config": {"sku":"Standard_D4s_v5", "region":"westeurope",
                "instances":1, "hours":730, "storage":100, "egress":0},
            "rates": [options[0]],
        });
        storage::save_budget(&path, "sqlite-live-diagnostic", &snapshot.to_string())?;
        let rows = storage::list_budgets(&path)?;
        let expected = cloudcost_core::validation::normalize_budget(
            "sqlite-live-diagnostic",
            &snapshot.to_string(),
        )?;
        if rows != vec![expected] {
            return Err("El snapshot no sobrevivió a la reapertura de SQLite".into());
        }
        println!(
            "{}",
            serde_json::to_string_pretty(&json!({
                "ok":true, "source":AZURE, "retrievedAt":live.fetched,
                "items":live.rates.len(), "firstQueryCached":live.cached,
                "reopenedQueryCached":cached.cached, "snapshotsAfterReopen":rows.len(),
                "snapshot":serde_json::from_str::<serde_json::Value>(&rows[0])?,
                "scope":"Servicios reales de caché y persistencia; sin WebView ni IPC Tauri.",
            }))?
        );
        Ok::<(), Box<dyn std::error::Error>>(())
    })
}
