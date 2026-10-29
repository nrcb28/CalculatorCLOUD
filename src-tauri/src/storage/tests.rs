use super::*;
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

// Cada prueba usa un archivo real aislado y abre conexiones nuevas como los comandos IPC.
struct DiskDb(PathBuf);
impl DiskDb {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        Self(
            std::env::temp_dir()
                .join(format!(
                    "cloudcost-storage-{}-{}-{}",
                    std::process::id(),
                    chrono::Utc::now().timestamp_nanos_opt().unwrap(),
                    NEXT.fetch_add(1, Ordering::Relaxed),
                ))
                .join("cloudcost.db"),
        )
    }
}
impl Drop for DiskDb {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(self.0.parent().unwrap());
    }
}
fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
}
fn rate() -> Value {
    json!({"meterId":"test-only", "skuName":"D4s v5", "armSkuName":"Standard_D4s_v5",
        "productName":"Virtual Machines Dsv5 Series", "armRegionName":"westeurope",
        "unitOfMeasure":"1 Hour", "currencyCode":"USD", "type":"Consumption",
        "isPrimaryMeterRegion":true, "retailPrice":0.1,
        "effectiveStartDate":"2021-11-01T00:00:00Z"})
}
fn budget(id: &str) -> Value {
    json!({"id":id,"name":"Prueba SQLite — áéí", "created":"2026-01-01T00:00:00Z",
        "fetched":"2026-01-01T00:00:00Z", "config":{"sku":"Standard_D4s_v5",
        "region":"westeurope", "instances":1,"hours":730,"storage":100,"egress":0},
        "rates":[rate()]})
}
fn offline() -> ConnectionError {
    ConnectionError {
        code: "connection".into(),
        message: "Sin conexión".into(),
        action: "Comprueba la red.".into(),
        host: Some("prices.azure.com".into()),
        retryable: true,
    }
}
fn seed(path: &Path, data: &str, fetched: &str) {
    database(path)
        .unwrap()
        .execute(
            "INSERT OR REPLACE INTO cache(key,data,fetched) VALUES(?1,?2,?3)",
            params!["azure:USD:westeurope:Standard_D4s_v5", data, fetched],
        )
        .unwrap();
}

#[test]
fn budgets_survive_reopen_are_normalized_and_keep_newest_first() {
    let disk = DiskDb::new();
    assert!(list_budgets(&disk.0).unwrap().is_empty());
    let mut first = budget("first");
    first["unknown"] = json!("discard-me");
    first["config"]["token"] = json!("discard-me");
    save_budget(&disk.0, "first", &first.to_string()).unwrap();
    save_budget(&disk.0, "second", &budget("second").to_string()).unwrap();
    let rows = list_budgets(&disk.0).unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(
        serde_json::from_str::<Value>(&rows[0]).unwrap(),
        budget("second")
    );
    assert_eq!(
        serde_json::from_str::<Value>(&rows[1]).unwrap(),
        budget("first")
    );
    assert!(!rows[1].contains("discard-me"));
    // Un ID repetido nunca sustituye silenciosamente el escenario original.
    assert!(save_budget(&disk.0, "first", &first.to_string()).is_err());
    assert_eq!(list_budgets(&disk.0).unwrap(), rows);
}

#[test]
fn invalid_snapshot_never_reaches_sqlite() {
    let disk = DiskDb::new();
    assert!(save_budget(&disk.0, "other", &budget("first").to_string()).is_err());
    assert!(save_budget(&disk.0, "first", "not json").is_err());
    let mut invalid = budget("first");
    invalid["rates"][0]["currencyCode"] = json!("EUR");
    assert!(save_budget(&disk.0, "first", &invalid.to_string()).is_err());
    assert!(!disk.0.exists());
    assert!(list_budgets(&disk.0).unwrap().is_empty());
}

#[test]
fn fresh_cache_survives_reopen_and_avoids_network() {
    let disk = DiskDb::new();
    runtime().block_on(async {
        let first = cached_catalog(&disk.0, "Standard_D4s_v5", "westeurope", 24, || async {
            Ok(vec![rate()])
        })
        .await
        .unwrap();
        assert!(!first.cached);
        let second = cached_catalog(&disk.0, "Standard_D4s_v5", "westeurope", 24, || async {
            panic!("No debe consultar la red con caché fresca")
        })
        .await
        .unwrap();
        assert!(second.cached);
        assert!(second.warning.is_none());
        assert_eq!(second.fetched, first.fetched);
        assert_eq!(second.rates, first.rates);
        // La clave incluye SKU/región: nunca usa el catálogo de otra región.
        let other = cached_catalog(&disk.0, "Standard_D4s_v5", "eastus", 24, || async {
            Err(offline())
        })
        .await
        .unwrap_err();
        assert_eq!(other.code, "connection");
    });
}

#[test]
fn expired_and_future_cache_attempt_refresh_and_preserve_warning_on_failure() {
    let disk = DiskDb::new();
    for date in ["2020-01-01T00:00:00Z", "2999-01-01T00:00:00Z", "invalid"] {
        seed(&disk.0, &json!([rate()]).to_string(), date);
        runtime().block_on(async {
            let result = cached_catalog(&disk.0, "Standard_D4s_v5", "westeurope", 24, || async {
                Err(offline())
            })
            .await
            .unwrap();
            assert!(result.cached);
            assert_eq!(result.fetched, date);
            assert_eq!(result.rates, vec![rate()]);
            let warning = result.warning.unwrap();
            assert!(warning.contains("Sin conexión"));
            assert!(warning.contains("Comprueba la red."));
            assert!(warning.contains("sin actualizar"));
        });
    }
}

#[test]
fn corrupted_cache_is_repaired_by_refresh_and_expired_prices_are_replaced() {
    let disk = DiskDb::new();
    for (data, date) in [
        ("not json".to_owned(), chrono::Utc::now().to_rfc3339()),
        (json!([rate()]).to_string(), "2020-01-01T00:00:00Z".into()),
    ] {
        seed(&disk.0, &data, &date);
        runtime().block_on(async {
            let mut updated = rate();
            updated["retailPrice"] = json!(0.2);
            let result = cached_catalog(&disk.0, "Standard_D4s_v5", "westeurope", 24, || async {
                Ok(vec![updated.clone()])
            })
            .await
            .unwrap();
            assert!(!result.cached);
            assert!(result.warning.is_none());
            let reopened = cached_catalog(&disk.0, "Standard_D4s_v5", "westeurope", 24, || async {
                panic!("El catálogo actualizado debe persistir")
            })
            .await
            .unwrap();
            assert_eq!(reopened.rates, vec![updated]);
            assert_eq!(reopened.fetched, result.fetched);
        });
    }
}

#[test]
fn failures_without_cache_and_invalid_filters_remain_errors() {
    let disk = DiskDb::new();
    runtime().block_on(async {
        let invalid = cached_catalog(&disk.0, "bad'filter", "westeurope", 24, || async {
            panic!("Entrada inválida no debe consultar Azure")
        })
        .await;
        assert!(invalid.is_err());
        assert!(!disk.0.exists());
        let absent = cached_catalog(&disk.0, "Standard_D4s_v5", "westeurope", 24, || async {
            Err(offline())
        })
        .await
        .unwrap_err();
        assert_eq!(absent.code, "connection");
        seed(&disk.0, "not json", "2020-01-01T00:00:00Z");
        let corrupt = cached_catalog(&disk.0, "Standard_D4s_v5", "westeurope", 24, || async {
            Err(offline())
        })
        .await
        .unwrap_err();
        assert_eq!(corrupt.message, "Caché no válida");
    });
}
