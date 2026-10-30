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

pub(crate) fn text(v: &Value, max: usize) -> bool {
    v.as_str()
        .is_some_and(|s| !s.trim().is_empty() && s.encode_utf16().count() <= max)
}
pub(crate) fn timestamp(s: &str) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    if s.len() > 40 {
        return None;
    }
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .filter(|d| d.timestamp_subsec_nanos() < 1_000_000_000)
}
pub(crate) fn date(v: &Value) -> bool {
    v.as_str().is_some_and(|s| timestamp(s).is_some())
}
pub(crate) fn number(v: &Value, max: f64) -> bool {
    v.as_f64()
        .is_some_and(|n| n.is_finite() && n >= 0.0 && n <= max)
}
pub fn validate_budget(id: &str, data: &str) -> Result<(), String> {
    if id.trim().is_empty() || id.encode_utf16().count() > 100 || data.len() > 5_000_000 {
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
        || (c.get("egressUsedGB").is_some() && !number(&c["egressUsedGB"], 1e9))
    {
        return Err("Consumos no válidos".into());
    }
    let r = &rates[0];
    let start = r["effectiveStartDate"].as_str().and_then(|s| {
        timestamp(s).map(|t| t.timestamp()).or_else(|| {
            if s.len() != 10 {
                return None;
            }
            chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
                .ok()
                .and_then(|d| d.and_hms_opt(0, 0, 0))
                .map(|d| d.and_utc().timestamp())
        })
    });
    let labels = format!(
        "{} {} {}",
        r["productName"].as_str().unwrap_or(""),
        r["skuName"].as_str().unwrap_or(""),
        r["meterName"].as_str().unwrap_or("")
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
        || r.get("reservationTerm").is_some()
        || (r.get("meterName").is_some() && !text(&r["meterName"], 500))
        || ["windows", "spot", "low priority", "devtest"]
            .iter()
            .any(|w| labels.contains(w))
        || (r.get("tierMinimumUnits").is_some() && r["tierMinimumUnits"].as_f64() != Some(0.0))
    {
        return Err("Tarifa incompatible con el presupuesto".into());
    }
    if let Some(components) = v.get("components") {
        crate::components::normalize(components, c)?;
    }
    Ok(())
}
// Persistir solo el esquema permitido, también cuando el comando se invoca sin el frontend.
pub fn normalize_budget(id: &str, data: &str) -> Result<String, String> {
    validate_budget(id, data)?;
    let input: Value = serde_json::from_str(data).map_err(|_| "JSON no válido")?;
    fn select(input: &Value, keys: &[&str]) -> Value {
        let mut output = serde_json::Map::new();
        for key in keys {
            if let Some(value) = input.get(*key) {
                output.insert((*key).to_string(), value.clone());
            }
        }
        Value::Object(output)
    }
    let mut output = select(&input, &["id", "name", "created", "fetched"]);
    output["config"] = select(
        &input["config"],
        &[
            "sku",
            "region",
            "instances",
            "hours",
            "storage",
            "egress",
            "egressUsedGB",
        ],
    );
    output["rates"] = Value::Array(vec![select(
        &input["rates"][0],
        &[
            "meterId",
            "meterName",
            "skuName",
            "armSkuName",
            "productName",
            "armRegionName",
            "unitOfMeasure",
            "retailPrice",
            "currencyCode",
            "effectiveStartDate",
            "type",
            "isPrimaryMeterRegion",
            "tierMinimumUnits",
        ],
    )]);
    if let Some(components) = input.get("components") {
        if input["config"].get("egressUsedGB").is_none() {
            output["config"]["egressUsedGB"] = serde_json::json!(0);
        }
        output["components"] = crate::components::normalize(components, &input["config"])?;
    }
    serde_json::to_string(&output).map_err(|_| "No se pudo serializar el presupuesto".into())
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
    fn requires_real_rfc3339_timestamps() {
        for invalid in [
            "1",
            "2025-01-01",
            "2025-02-30T00:00:00Z",
            "2025-02-29T00:00:00Z",
            "2025-04-31T00:00:00Z",
            "2025-01-01T24:00:00Z",
            "2025-01-01T00:00:00",
            "2025-01-01T00:00:00+24:00",
            "2025-01-01T23:59:60Z",
        ] {
            for field in ["created", "fetched"] {
                let mut v = budget();
                v[field] = serde_json::json!(invalid);
                assert!(
                    validate_budget("test", &v.to_string()).is_err(),
                    "{}: {}",
                    field,
                    invalid
                );
            }
        }
    }
    #[test]
    fn accepts_fractional_offsets_and_date_only_rate_effectivity() {
        let mut v = budget();
        v["created"] = serde_json::json!("2024-02-29T23:59:59.1234567+01:30");
        v["fetched"] = serde_json::json!("2025-01-01T00:00:00-00:00");
        v["rates"][0]["effectiveStartDate"] = serde_json::json!("2024-02-29");
        assert!(validate_budget("test", &v.to_string()).is_ok());
    }
    #[test]
    fn removes_unknown_fields_before_persistence() {
        let mut v = budget();
        v["config"]["token"] = serde_json::json!("test-only");
        v["rates"][0]["extra"] = serde_json::json!({"nested":"test-only"});
        v["unknown"] = serde_json::json!("test-only");
        let clean = normalize_budget("test", &v.to_string()).unwrap();
        assert!(!clean.contains("test-only"));
        assert!(validate_budget("test", &clean).is_ok());
    }
    #[test]
    fn rejects_mismatched_rates() {
        for (field, value) in [
            ("productName", serde_json::json!("Virtual Machines DevTest")),
            ("meterName", serde_json::json!("D4s v5 Spot")),
            ("reservationTerm", serde_json::json!("1 Year")),
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
