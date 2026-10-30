//! Validación de los componentes opcionales del snapshot, también sin frontend.
use crate::validation::{date, number, text, timestamp};
use serde_json::{json, Value};
pub const DISK_SIZES: &[(&str, f64)] = &[
    ("P1", 4.),
    ("P2", 8.),
    ("P3", 16.),
    ("P4", 32.),
    ("P6", 64.),
    ("P10", 128.),
    ("P15", 256.),
    ("P20", 512.),
    ("P30", 1024.),
    ("P40", 2048.),
    ("P50", 4096.),
    ("P60", 8192.),
    ("P70", 16384.),
    ("P80", 32767.),
];
const STARTS: &[f64] = &[0., 100., 10335., 51295., 153695., 512095.];
const ERROR: &str = "Cotización de discos o red incompleta, incompatible o no soportada";
fn clean_rate(r: &Value, region: &Value, fetched: &str) -> Result<Value, String> {
    let keys = [
        "meterId",
        "meterName",
        "skuName",
        "productName",
        "armRegionName",
        "unitOfMeasure",
        "currencyCode",
        "type",
    ];
    let effective = r["effectiveStartDate"].as_str().and_then(|s| {
        timestamp(s).map(|d| d.timestamp()).or_else(|| {
            if s.len() != 10 {
                return None;
            }
            chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
                .ok()
                .and_then(|d| d.and_hms_opt(0, 0, 0))
                .map(|d| d.and_utc().timestamp())
        })
    });
    let retrieved = timestamp(fetched).ok_or(ERROR)?.timestamp();
    if !keys.iter().all(|k| text(&r[*k], 500))
        || r["armRegionName"] != *region
        || r["currencyCode"] != "USD"
        || r["type"] != "Consumption"
        || !number(&r["retailPrice"], 1e12)
        || !number(&r["tierMinimumUnits"], 1e9)
        || !r["isPrimaryMeterRegion"].is_boolean()
        || r.get("reservationTerm").is_some()
        || effective.is_none_or(|d| d > retrieved || d > chrono::Utc::now().timestamp())
    {
        return Err(ERROR.into());
    }
    let mut clean = serde_json::Map::new();
    for key in keys.iter().copied().chain([
        "effectiveStartDate",
        "retailPrice",
        "tierMinimumUnits",
        "isPrimaryMeterRegion",
    ]) {
        clean.insert(key.into(), r[key].clone());
    }
    Ok(Value::Object(clean))
}
pub fn normalize(value: &Value, config: &Value) -> Result<Value, String> {
    if value["model"] != "premium-lrs-mgn-api-v1"
        || value["source"] != crate::provider::AZURE
        || value["region"] != config["region"]
        || !date(&value["fetched"])
        || !number(&config["storage"], 32767.)
    {
        return Err(ERROR.into());
    }
    let fetched = value["fetched"].as_str().ok_or(ERROR)?;
    if timestamp(fetched).ok_or(ERROR)? > chrono::Utc::now() {
        return Err(ERROR.into());
    }
    let storage = config["storage"].as_f64().ok_or(ERROR)?;
    let size = if storage == 0. {
        None
    } else {
        DISK_SIZES.iter().find(|(_, n)| *n >= storage)
    };
    let disk = match size {
        Some((sku, _)) => {
            let r = clean_rate(&value["disk"], &config["region"], fetched)?;
            if r["productName"] != "Premium SSD Managed Disks"
                || r["skuName"] != format!("{sku} LRS")
                || r["meterName"] != format!("{sku} LRS Disk")
                || r["unitOfMeasure"] != "1/Month"
                || r["tierMinimumUnits"].as_f64() != Some(0.)
                || r["isPrimaryMeterRegion"] != true
            {
                return Err(ERROR.into());
            }
            r
        }
        None => {
            if value.get("disk") != Some(&Value::Null) {
                return Err(ERROR.into());
            }
            Value::Null
        }
    };
    let rows = value["network"]
        .as_array()
        .filter(|a| a.len() == STARTS.len())
        .ok_or(ERROR)?;
    let mut network = rows
        .iter()
        .map(|r| clean_rate(r, &config["region"], fetched))
        .collect::<Result<Vec<_>, _>>()?;
    network.sort_by(|a, b| {
        a["tierMinimumUnits"]
            .as_f64()
            .unwrap()
            .total_cmp(&b["tierMinimumUnits"].as_f64().unwrap())
    });
    for (i, r) in network.iter().enumerate() {
        if r["productName"] != "Rtn Preference: MGN"
            || r["skuName"] != "Standard"
            || r["meterName"] != "Standard Data Transfer Out"
            || r["unitOfMeasure"] != "1 GB"
            || r["tierMinimumUnits"].as_f64() != Some(STARTS[i])
            || r["meterId"] != network[0]["meterId"]
            || r["effectiveStartDate"] != network[0]["effectiveStartDate"]
        {
            return Err(ERROR.into());
        }
    }
    let prior = config
        .get("egressUsedGB")
        .map_or(Some(0.), Value::as_f64)
        .ok_or(ERROR)?;
    if !prior.is_finite() || prior < 0. || prior + config["egress"].as_f64().ok_or(ERROR)? > 500000.
    {
        return Err(ERROR.into());
    }
    Ok(
        json!({"model":"premium-lrs-mgn-api-v1","source":crate::provider::AZURE,"fetched":fetched,"region":config["region"],"disk":disk,"network":network}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn quote() -> Value {
        serde_json::from_str(include_str!("../../tests/components-fixture.json")).unwrap()
    }
    fn config() -> Value {
        json!({"region":"westeurope","storage":100,"egress":1000,"egressUsedGB":100})
    }
    #[test]
    fn normalizes_component_quotes_without_keeping_unknown_fields() {
        let mut value = quote();
        value["disk"]["unknown"] = json!("discard-me");
        value["network"][0]["unknown"] = json!("discard-me");
        value["network"].as_array_mut().unwrap().reverse();
        assert_eq!(normalize(&value, &config()).unwrap(), quote());
    }
    #[test]
    fn refuses_partial_or_mixed_network_scales() {
        let mut value = quote();
        value["network"].as_array_mut().unwrap().pop();
        assert!(normalize(&value, &config()).is_err());
        let mut value = quote();
        value["network"][1]["tierMinimumUnits"] = json!(0);
        assert!(normalize(&value, &config()).is_err());
        let mut value = quote();
        value["network"][1]["meterId"] = json!("other");
        assert!(normalize(&value, &config()).is_err());
    }
    #[test]
    fn refuses_wrong_storage_units_products_dates_and_modalities() {
        for (field, value) in [
            ("unitOfMeasure", json!("1 GB")),
            ("skuName", json!("P15 LRS")),
            ("meterName", json!("P10 LRS Disk Mount")),
            ("type", json!("Reservation")),
            ("currencyCode", json!("EUR")),
            ("reservationTerm", json!("1 Year")),
            ("effectiveStartDate", json!("2999-01-01")),
        ] {
            let mut q = quote();
            q["disk"][field] = value;
            assert!(normalize(&q, &config()).is_err(), "{field}");
        }
        let mut c = config();
        c["egressUsedGB"] = json!(-1);
        assert!(normalize(&quote(), &c).is_err());
        c["egressUsedGB"] = json!(512095);
        assert!(normalize(&quote(), &c).is_err());
        c = config();
        c["storage"] = json!(32768);
        assert!(normalize(&quote(), &c).is_err());
    }
    #[test]
    fn permits_zero_storage_only_without_a_disk_rate() {
        let mut c = config();
        c["storage"] = json!(0);
        assert!(normalize(&quote(), &c).is_err());
        let mut q = quote();
        q["disk"] = Value::Null;
        assert!(normalize(&q, &c).is_ok());
    }
}
