//! Proyectos con copias independientes de presupuestos y proveedor elegido.
use crate::validation;
use bigdecimal::{BigDecimal, RoundingMode, Zero};
use serde_json::{json, Value};
use std::str::FromStr;
pub const MODEL: &str = "resource-project-v1";
pub fn normalize(data: &str) -> Result<Value, String> {
    if data.len() > 10_000_000 {
        return Err("Proyecto demasiado grande (máximo 10 MB)".into());
    }
    let p: Value = serde_json::from_str(data).map_err(|_| "JSON de proyecto no válido")?;
    if p["model"] != MODEL
        || !validation::text(&p["id"], 100)
        || !validation::text(&p["name"], 200)
        || !validation::date(&p["created"])
    {
        return Err("Proyecto no válido".into());
    }
    let rows = p["resources"]
        .as_array()
        .filter(|r| !r.is_empty() && r.len() <= 40)
        .ok_or("Proyecto: entre 1 y 40 recursos")?;
    let mut ids = std::collections::HashSet::new();
    let mut resources = Vec::new();
    let mut network = 0;
    for r in rows {
        if !validation::text(&r["id"], 100)
            || !validation::text(&r["name"], 200)
            || !ids.insert(r["id"].clone().to_string())
        {
            return Err("Identidad de recurso no válida o repetida".into());
        }
        let id = r["snapshot"]["id"]
            .as_str()
            .ok_or("Falta ID de presupuesto")?;
        let snapshot: Value = serde_json::from_str(&validation::normalize_budget(
            id,
            &r["snapshot"].to_string(),
        )?)
        .map_err(|_| "Presupuesto no válido")?;
        let provider = r["provider"].as_str().ok_or("Falta proveedor")?;
        if provider != "Azure"
            && (!["AWS", "GCP"].contains(&provider)
                || !snapshot["comparisonQuotes"]
                    .as_array()
                    .is_some_and(|a| a.iter().any(|q| q["provider"] == provider)))
        {
            return Err("Falta tarifa del proveedor elegido".into());
        }
        if provider == "Azure" && snapshot["config"]["egress"].as_f64().unwrap_or(0.) > 0. {
            network += 1;
        }
        resources
            .push(json!({"id":r["id"],"name":r["name"],"provider":provider,"snapshot":snapshot}));
    }
    if network > 1 {
        return Err(
            "Consolida la salida Azure en un único recurso para no repetir los tramos de la cuenta"
                .into(),
        );
    }
    Ok(
        json!({"model":MODEL,"id":p["id"],"name":p["name"],"created":p["created"],"resources":resources}),
    )
}
fn d(v: &Value) -> Result<BigDecimal, String> {
    BigDecimal::from_str(
        &v.as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| v.to_string()),
    )
    .map_err(|_| "Decimal no válido".into())
}
pub fn money(v: &BigDecimal) -> String {
    format!("{:.2}", v.with_scale_round(2, RoundingMode::HalfUp))
}
fn cost(s: &Value, provider: &str, instances: &Value, hours: &Value) -> Result<BigDecimal, String> {
    let count = d(instances)?;
    let hours = d(hours)?;
    if provider != "Azure" {
        let q = s["comparisonQuotes"]
            .as_array()
            .and_then(|a| a.iter().find(|q| q["provider"] == provider))
            .ok_or("Falta tarifa elegida")?;
        let mut hourly = BigDecimal::zero();
        for c in q["charges"].as_array().ok_or("Faltan cargos")? {
            hourly += d(&c["quantity"])? * d(&c["unitPriceUSD"])?;
        }
        return Ok(hourly * count * hours);
    }
    let mut sum = d(&s["rates"][0]["retailPrice"])? * &count * hours;
    if let Some(q) = s.get("components") {
        if !q["disk"].is_null() {
            sum += d(&q["disk"]["retailPrice"])? * &count;
        }
        let zero = BigDecimal::zero();
        let used = d(s["config"].get("egressUsedGB").unwrap_or(&Value::from(0)))?;
        let end = &used + d(&s["config"]["egress"])?;
        let rows = q["network"].as_array().ok_or("Faltan tramos")?;
        for pair in rows.windows(2) {
            let from = d(&pair[0]["tierMinimumUnits"])?;
            let to = d(&pair[1]["tierMinimumUnits"])?;
            let qty = end.clone().min(to) - used.clone().max(from);
            sum += qty.max(zero.clone()) * d(&pair[0]["retailPrice"])?;
        }
    }
    Ok(sum)
}
#[derive(Debug)]
pub struct ResourceCost {
    pub monthly: BigDecimal,
    pub months: Vec<BigDecimal>,
    pub total: BigDecimal,
}
pub fn resource_cost(r: &Value) -> Result<ResourceCost, String> {
    let s = &r["snapshot"];
    let provider = r["provider"].as_str().ok_or("Falta proveedor")?;
    let c = &s["config"];
    let monthly = cost(s, provider, &c["instances"], &c["hours"])?;
    let months = if let Some(plan) = s.get("usagePlan") {
        plan["months"]
            .as_array()
            .ok_or("Plan no válido")?
            .iter()
            .map(|m| cost(s, provider, &m["instances"], &m["hours"]))
            .collect::<Result<Vec<_>, _>>()?
    } else {
        vec![monthly.clone(); 12]
    };
    let total = months.iter().cloned().sum();
    Ok(ResourceCost {
        monthly,
        months,
        total,
    })
}
pub fn totals(p: &Value) -> Result<(BigDecimal, Vec<BigDecimal>), String> {
    let mut monthly = BigDecimal::zero();
    let mut months = vec![BigDecimal::zero(); 12];
    for r in p["resources"].as_array().ok_or("Faltan recursos")? {
        let cost = resource_cost(r)?;
        monthly += cost.monthly;
        for (i, amount) in cost.months.into_iter().enumerate() {
            months[i] += amount;
        }
    }
    Ok((monthly, months))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> Value {
        serde_json::from_str(include_str!("../../tests/project-fixture.json")).unwrap()
    }
    #[test]
    fn selected_provider_and_month_plans_match_the_decimal_frontend() {
        let p = normalize(&sample().to_string()).unwrap();
        let (monthly, months) = totals(&p).unwrap();
        assert_eq!(money(&monthly), "578.44");
        assert_eq!(money(&months.iter().cloned().sum()), "6482.84");
        assert_eq!(money(&months[0]), "120.00");
    }
    #[test]
    fn only_valid_public_resource_copies_are_kept() {
        let mut p = sample();
        p["secret"] = json!("test-secret");
        p["resources"][0]["secret"] = json!("test-secret");
        p["resources"][0]["snapshot"]["config"]["secret"] = json!("test-secret");
        assert!(!normalize(&p.to_string())
            .unwrap()
            .to_string()
            .contains("test-secret"));
        p["resources"][1]["provider"] = json!("Azure");
        assert!(normalize(&p.to_string()).is_err());
        p["resources"][1]["snapshot"]["config"]["egress"] = json!(0);
        assert!(normalize(&p.to_string()).is_ok());
        p["resources"][1]["provider"] = json!("GCP");
        assert!(normalize(&p.to_string()).is_err());
    }
    #[test]
    fn rejects_empty_oversized_and_malformed_projects() {
        let mut p = sample();
        p["resources"] = json!([]);
        assert!(normalize(&p.to_string()).is_err());
        p["resources"] = json!(vec![sample()["resources"][0].clone(); 41]);
        assert!(normalize(&p.to_string()).is_err());
        for invalid in [Value::Null, json!({}), json!({"model":MODEL})] {
            assert!(normalize(&invalid.to_string()).is_err());
        }
    }
    #[test]
    fn resource_ids_must_be_distinct() {
        let mut p = sample();
        p["resources"][1]["id"] = p["resources"][0]["id"].clone();
        assert!(normalize(&p.to_string()).is_err());
    }
}
