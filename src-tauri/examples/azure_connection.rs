use cloudcost_core::{
    http::ConnectionError,
    provider::{fetch_catalog, AZURE},
};
use std::time::Duration;
fn main() {
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
                serde_json::json!({"ok":matching>0,"source":AZURE,"retrievedAt":chrono::Utc::now().to_rfc3339(),"items":rates.len(),"matchingHourlyRates":matching,"scope":"Conectividad y formato. No verifica el coste completo de una infraestructura."})
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
