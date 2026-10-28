use serde_json::Value;
pub fn valid_input(sku: &str, region: &str, ttl: u32) -> bool {
    !sku.trim().is_empty()
        && sku.len() <= 100
        && sku
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == ' ')
        && !region.is_empty()
        && region.len() <= 40
        && region
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && (1..=720).contains(&ttl)
}

fn text(v: &Value, max: usize) -> bool {
    v.as_str()
        .is_some_and(|s| !s.trim().is_empty() && s.chars().count() <= max)
}
fn date(v: &Value) -> bool {
    v.as_str()
        .is_some_and(|s| chrono::DateTime::parse_from_rfc3339(s).is_ok())
}
fn number(v: &Value, max: f64) -> bool {
    v.as_f64()
        .is_some_and(|n| n.is_finite() && n >= 0.0 && n <= max)
}
pub fn validate_budget(id: &str, data: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 100 || data.len() > 5_000_000 {
        return Err("Tamaño de presupuesto no válido".into());
    }
    let v: Value = serde_json::from_str(data).map_err(|_| "JSON no válido")?;
    let c = &v["config"];
    let rates = v["rates"].as_array().ok_or("Faltan tarifas")?;
    if v["id"].as_str() != Some(id)
        || !text(&v["name"], 200)
        || !date(&v["created"])
        || !date(&v["fetched"])
        || rates.len() != 1
    {
        return Err("Presupuesto no válido".into());
    }
    let sku = c["sku"].as_str().ok_or("Falta SKU")?;
    let region = c["region"].as_str().ok_or("Falta región")?;
    if !valid_input(sku, region, 24)
        || !number(&c["instances"], 100000.0)
        || c["instances"].as_f64().unwrap_or(0.0) < 1.0
        || c["instances"].as_f64().unwrap_or(0.0).fract() != 0.0
        || !number(&c["hours"], 744.0)
        || !number(&c["storage"], 1e9)
        || !number(&c["egress"], 1e9)
    {
        return Err("Consumos no válidos".into());
    }
    let r = &rates[0];
    let start = r["effectiveStartDate"].as_str().and_then(|s| {
        chrono::DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|t| t.timestamp())
            .or_else(|| {
                chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
                    .ok()
                    .and_then(|d| d.and_hms_opt(0, 0, 0))
                    .map(|d| d.and_utc().timestamp())
            })
    });
    let labels = format!(
        "{} {}",
        r["productName"].as_str().unwrap_or(""),
        r["skuName"].as_str().unwrap_or("")
    )
    .to_lowercase();
    if ![
        "meterId",
        "skuName",
        "armSkuName",
        "productName",
        "armRegionName",
        "unitOfMeasure",
        "currencyCode",
        "type",
    ]
    .iter()
    .all(|k| text(&r[*k], 500))
        || r["armSkuName"] != c["sku"]
        || r["armRegionName"] != c["region"]
        || r["unitOfMeasure"] != "1 Hour"
        || r["currencyCode"] != "USD"
        || r["type"] != "Consumption"
        || r["isPrimaryMeterRegion"] != true
        || !number(&r["retailPrice"], 1e12)
        || start.is_none_or(|t| t > chrono::Utc::now().timestamp())
        || ["windows", "spot", "low priority"]
            .iter()
            .any(|w| labels.contains(w))
        || (r.get("tierMinimumUnits").is_some() && r["tierMinimumUnits"].as_f64() != Some(0.0))
    {
        return Err("Tarifa incompatible con el presupuesto".into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn budget() -> Value {
        serde_json::json!({"id":"test","name":"Escenario","created":"2026-01-01T00:00:00Z","fetched":"2026-01-01T00:00:00Z","config":{"sku":"Standard_D4s_v5","region":"westeurope","instances":1,"hours":730,"storage":100,"egress":0},"rates":[{"meterId":"test","skuName":"D4s v5","armSkuName":"Standard_D4s_v5","productName":"Virtual Machines","armRegionName":"westeurope","unitOfMeasure":"1 Hour","currencyCode":"USD","type":"Consumption","isPrimaryMeterRegion":true,"retailPrice":0.1,"effectiveStartDate":"2026-01-01T00:00:00Z"}]})
    }
    #[test]
    fn validates_filters() {
        assert!(valid_input("Standard_D4s_v5", "westeurope", 24));
        assert!(!valid_input("x' or true", "westeurope", 24));
        assert!(!valid_input("x", "../", 24));
        assert!(!valid_input("x", "eastus", 0));
    }
    #[test]
    fn accepts_snapshot() {
        assert!(validate_budget("test", &budget().to_string()).is_ok());
    }
    #[test]
    fn rejects_identity_and_consumption() {
        assert!(validate_budget("other", &budget().to_string()).is_err());
        let mut v = budget();
        v["config"]["instances"] = serde_json::json!(1.5);
        assert!(validate_budget("test", &v.to_string()).is_err());
    }
    #[test]
    fn rejects_mismatched_rates() {
        for (field, value) in [
            ("currencyCode", serde_json::json!("EUR")),
            ("armRegionName", serde_json::json!("eastus")),
            ("retailPrice", serde_json::json!(-1)),
            ("tierMinimumUnits", serde_json::json!(100)),
            (
                "effectiveStartDate",
                serde_json::json!("2999-01-01T00:00:00Z"),
            ),
        ] {
            let mut v = budget();
            v["rates"][0][field] = value;
            assert!(validate_budget("test", &v.to_string()).is_err());
        }
    }
}
