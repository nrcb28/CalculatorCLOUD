use cloudcost_core::{
    http::ConnectionError,
    provider::{fetch_catalog, AZURE},
};
use std::time::Duration;
fn main() {
    // Ruta opcional para conservar los registros originales, sin normalizarlos.
    let output = std::env::args().nth(1);
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("No se pudo iniciar el diagnóstico");
    let result = runtime.block_on(async {
        tokio::time::timeout(
            Duration::from_secs(90),
            fetch_catalog("Standard_D4s_v5", "westeurope"),
        )
        .await
        .unwrap_or_else(|_| {
            Err(ConnectionError {
                code: "timeout".into(),
                message: "La consulta Azure superó 90 segundos.".into(),
                action: "Comprueba la conectividad y el proxy.".into(),
                host: Some("prices.azure.com".into()),
                retryable: true,
            })
        })
    });
    match result {
        Ok(rates) => {
            let retrieved_at = chrono::Utc::now().to_rfc3339();
            if let Some(path) = output {
                let evidence = serde_json::json!({
                    "source": AZURE,
                    "retrievedAt": retrieved_at,
                    "sku": "Standard_D4s_v5",
                    "region": "westeurope",
                    "rates": rates,
                });
                if std::fs::write(&path, serde_json::to_vec_pretty(&evidence).unwrap()).is_err() {
                    eprintln!("No se pudo guardar la evidencia del catálogo");
                    std::process::exit(1);
                }
            }
            let matching = rates
                .iter()
                .filter(|rate| {
                    rate["armSkuName"] == "Standard_D4s_v5"
                        && rate["armRegionName"] == "westeurope"
                        && rate["currencyCode"] == "USD"
                        && rate["unitOfMeasure"] == "1 Hour"
                        && rate["retailPrice"]
                            .as_f64()
                            .is_some_and(|price| price.is_finite() && price >= 0.0)
                })
                .count();
            println!(
                "{}",
                serde_json::json!({"ok":matching>0,"source":AZURE,"retrievedAt":retrieved_at,"items":rates.len(),"matchingHourlyRates":matching,"scope":"Conectividad y formato. No verifica el coste completo de una infraestructura."})
            );
            if matching == 0 {
                std::process::exit(2);
            }
        }
        Err(error) => {
            eprintln!(
                "{}",
                serde_json::to_string(&error).expect("No se pudo serializar diagnóstico")
            );
            std::process::exit(1);
        }
    }
}
