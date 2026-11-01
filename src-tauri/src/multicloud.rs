//! Catálogos oficiales: EC2 Bulk CSV en streaming y Cloud Billing paginado.
use crate::{
    http::{self, ConnectionError},
    provider::bounded_json,
    validation::{date, number, text, timestamp},
};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    io::{self, Read},
    time::Duration,
};
pub const MODEL: &str = "compute-retail-v1";
pub const GCP_SOURCE: &str = "https://cloudbilling.googleapis.com/v1/services/6F81-5844-456A/skus";
pub const AWS_TYPES: &[&str] = &["m6i.xlarge", "m6a.xlarge", "c6i.xlarge", "r6i.xlarge"];
pub const AWS_REGIONS: &[&str] = &["eu-west-1", "eu-central-1", "us-east-1"];
pub const GCP_REGIONS: &[&str] = &["europe-west4", "europe-west1", "us-central1"];
pub fn aws_source(region: &str) -> String {
    format!("https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/{region}/index.csv")
}
fn invalid() -> ConnectionError {
    "Tarifa de computación multicloud incompleta, ambigua o incompatible".into()
}
fn decimal(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        !s.is_empty()
            && s.len() <= 40
            && s.as_bytes().first().is_some_and(u8::is_ascii_digit)
            && s.as_bytes().last().is_some_and(u8::is_ascii_digit)
            && s.bytes().all(|b| b.is_ascii_digit() || b == b'.')
            && s.bytes().filter(|b| *b == b'.').count() <= 1
            && s.parse::<f64>()
                .is_ok_and(|p| p.is_finite() && (0.0..=1e12).contains(&p))
    })
}
pub fn n2_spec(instance: &str) -> Option<(u32, u32)> {
    let cpu = instance.strip_prefix("n2-standard-")?.parse::<u32>().ok()?;
    ([2, 4, 8, 16, 32].contains(&cpu) && instance == format!("n2-standard-{cpu}"))
        .then_some((cpu, cpu * 4))
}
/// Validar y conservar solo campos públicos. Nunca hay credenciales en el esquema.
pub fn normalize_quote(q: &Value) -> Result<Value, String> {
    let fail = || "Tarifa de computación multicloud incompleta, ambigua o incompatible".to_string();
    if q["model"] != MODEL
        || !date(&q["fetched"])
        || !text(&q["instanceType"], 100)
        || !text(&q["region"], 40)
        || !number(&q["vcpu"], 1024.)
        || q["vcpu"].as_f64().unwrap_or(0.) < 1.
        || q["vcpu"].as_f64().unwrap_or(0.).fract() != 0.
        || !number(&q["memoryGiB"], 100000.)
        || q["memoryGiB"].as_f64().unwrap_or(0.) <= 0.
    {
        return Err(fail());
    }
    let fetched = timestamp(q["fetched"].as_str().ok_or_else(fail)?).ok_or_else(fail)?;
    if fetched > chrono::Utc::now() {
        return Err(fail());
    }
    let instance = q["instanceType"].as_str().ok_or_else(fail)?;
    let region = q["region"].as_str().ok_or_else(fail)?;
    let charges = q["charges"].as_array().ok_or_else(fail)?;
    match q["provider"].as_str() {
        Some("AWS") if AWS_TYPES.contains(&instance) && AWS_REGIONS.contains(&region) => {
            if q["source"] != aws_source(region)
                || charges.len() != 1
                || (!q["catalogVersion"]
                    .as_str()
                    .is_some_and(|s| s.len() == 14 && s.bytes().all(|b| b.is_ascii_digit())))
                || !date(&q["published"])
                || q["published"]
                    .as_str()
                    .and_then(timestamp)
                    .is_none_or(|d| d > fetched)
                || charges[0]["unit"] != "instance-hour"
                || charges[0]["quantity"].as_f64() != Some(1.)
                || !charges[0]["id"]
                    .as_str()
                    .is_some_and(|s| s.contains(".JRTCKXETXF."))
                || !charges[0]["description"].as_str().is_some_and(|s| {
                    s.to_ascii_lowercase().contains("linux") && s.contains(instance)
                })
            {
                return Err(fail());
            }
        }
        Some("GCP") if GCP_REGIONS.contains(&region) => {
            let (cpu, mem) = n2_spec(instance).ok_or_else(fail)?;
            if q["source"] != GCP_SOURCE
                || charges.len() != 2
                || q["vcpu"].as_f64() != Some(cpu as f64)
                || q["memoryGiB"].as_f64() != Some(mem as f64)
                || charges[0]["unit"] != "vcpu-hour"
                || charges[1]["unit"] != "gib-hour"
                || charges[0]["quantity"].as_f64() != Some(cpu as f64)
                || charges[1]["quantity"].as_f64() != Some(mem as f64)
                || !charges[0]["description"].as_str().is_some_and(|s| {
                    s.to_ascii_lowercase()
                        .starts_with("n2 instance core running in ")
                })
                || !charges[1]["description"].as_str().is_some_and(|s| {
                    s.to_ascii_lowercase()
                        .starts_with("n2 instance ram running in ")
                })
            {
                return Err(fail());
            }
        }
        _ => return Err(fail()),
    }
    let mut ids = HashSet::new();
    let mut clean = Vec::new();
    for charge in charges {
        let effective = charge["effective"].as_str().and_then(|s| {
            timestamp(s).map(|d| d.timestamp()).or_else(|| {
                chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
                    .ok()
                    .and_then(|d| d.and_hms_opt(0, 0, 0))
                    .map(|d| d.and_utc().timestamp())
            })
        });
        if !text(&charge["id"], 250)
            || !text(&charge["description"], 1000)
            || !decimal(&charge["unitPriceUSD"])
            || effective.is_none_or(|d| d > fetched.timestamp())
            || !ids.insert(charge["id"].clone().to_string())
        {
            return Err(fail());
        }
        let mut row = serde_json::Map::new();
        for k in [
            "id",
            "description",
            "unit",
            "quantity",
            "unitPriceUSD",
            "effective",
        ] {
            row.insert(k.into(), charge[k].clone());
        }
        clean.push(Value::Object(row));
    }
    let mut out = serde_json::Map::new();
    for k in [
        "model",
        "provider",
        "instanceType",
        "region",
        "vcpu",
        "memoryGiB",
        "source",
        "fetched",
    ] {
        out.insert(k.into(), q[k].clone());
    }
    if q["provider"] == "AWS" {
        for k in ["catalogVersion", "published"] {
            out.insert(k.into(), q[k].clone());
        }
    }
    out.insert("charges".into(), json!(clean));
    Ok(Value::Object(out))
}

struct ChunkReader {
    rx: tokio::sync::mpsc::Receiver<Vec<u8>>,
    chunk: io::Cursor<Vec<u8>>,
}
impl Read for ChunkReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        loop {
            let n = self.chunk.read(buf)?;
            if n > 0 {
                return Ok(n);
            }
            match self.rx.blocking_recv() {
                Some(bytes) => self.chunk = io::Cursor::new(bytes),
                None => return Ok(0),
            }
        }
    }
}
/// CSV con cabeceras citadas/multilínea y metadatos. Solo conserva filas relevantes.
// Budget reset between CSV records; bounded even for an unterminated quoted field.
struct RecordReader<R> {
    reader: R,
    budget: std::rc::Rc<std::cell::Cell<usize>>,
}
impl<R: Read> Read for RecordReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let left = self.budget.get();
        if left == 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Registro CSV demasiado grande",
            ));
        }
        let cap = buf.len().min(left);
        let read = self.reader.read(&mut buf[..cap])?;
        self.budget.set(left - read);
        Ok(read)
    }
}
fn parse_aws(reader: impl Read, instance: &str, region: &str) -> Result<Value, ConnectionError> {
    let budget = std::rc::Rc::new(std::cell::Cell::new(1_010_000));
    let reader = RecordReader {
        reader,
        budget: budget.clone(),
    };
    let mut csv = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(reader);
    let mut header: Option<HashMap<String, usize>> = None;
    let mut version = String::new();
    let mut published = String::new();
    let mut offer = false;
    let mut matches = Vec::new();
    let mut record = csv::StringRecord::new();
    let mut rows = 0;
    loop {
        budget.set(1_010_000);
        if !csv.read_record(&mut record).map_err(|_| invalid())? {
            break;
        }
        rows += 1;
        if rows > 1_000_000 || record.as_slice().len() > 1_000_000 {
            return Err("Catálogo EC2 fuera de los límites admitidos".into());
        }
        if header.is_none() {
            match record.get(0) {
                Some("Version") => version = record.get(1).unwrap_or("").into(),
                Some("Publication Date") => published = record.get(1).unwrap_or("").into(),
                Some("OfferCode") => offer = record.get(1) == Some("AmazonEC2"),
                Some("SKU") => {
                    let h: HashMap<_, _> = record
                        .iter()
                        .enumerate()
                        .map(|(i, s)| (s.to_string(), i))
                        .collect();
                    for k in [
                        "SKU",
                        "RateCode",
                        "TermType",
                        "OfferTermCode",
                        "PriceDescription",
                        "EffectiveDate",
                        "StartingRange",
                        "EndingRange",
                        "Unit",
                        "PricePerUnit",
                        "Currency",
                        "Product Family",
                        "Instance Type",
                        "Region Code",
                        "Operating System",
                        "Tenancy",
                        "Pre Installed S/W",
                        "License Model",
                        "MarketOption",
                        "CapacityStatus",
                        "operation",
                        "vCPU",
                        "Memory",
                    ] {
                        if !h.contains_key(k) {
                            return Err(invalid());
                        }
                    }
                    header = Some(h);
                }
                _ => {}
            }
            continue;
        }
        let h = header.as_ref().unwrap();
        if record.len() != h.len() {
            return Err(invalid());
        }
        let get = |k: &str| record.get(*h.get(k).unwrap()).unwrap_or("");
        if get("Instance Type") != instance
            || get("Region Code") != region
            || get("Product Family") != "Compute Instance"
            || get("Operating System") != "Linux"
            || get("Tenancy") != "Shared"
            || get("Pre Installed S/W") != "NA"
            || get("License Model") != "No License required"
            || get("MarketOption") != "OnDemand"
            || get("CapacityStatus") != "Used"
            || get("operation") != "RunInstances"
            || get("TermType") != "OnDemand"
        {
            continue;
        }
        if get("OfferTermCode") != "JRTCKXETXF"
            || get("Unit") != "Hrs"
            || get("Currency") != "USD"
            || get("StartingRange") != "0"
            || get("EndingRange") != "Inf"
        {
            return Err(invalid());
        }
        let cpu = get("vCPU").parse::<u32>().map_err(|_| invalid())?;
        let memory = get("Memory")
            .strip_suffix(" GiB")
            .ok_or_else(invalid)?
            .replace(',', "")
            .parse::<f64>()
            .map_err(|_| invalid())?;
        matches.push(json!({"vcpu":cpu,"memoryGiB":memory,"charge":{"id":get("RateCode"),"description":get("PriceDescription"),"unit":"instance-hour","quantity":1,"unitPriceUSD":get("PricePerUnit"),"effective":get("EffectiveDate")}}));
        if matches.len() > 20 {
            return Err(invalid());
        }
    }
    if header.is_none()
        || !offer
        || version.len() != 14
        || !version.bytes().all(|b| b.is_ascii_digit())
        || matches.len() != 1
    {
        return Err(invalid());
    }
    let q = json!({"model":MODEL,"provider":"AWS","instanceType":instance,"region":region,"vcpu":matches[0]["vcpu"],"memoryGiB":matches[0]["memoryGiB"],"source":aws_source(region),"fetched":chrono::Utc::now().to_rfc3339(),"catalogVersion":version,"published":published,"charges":[matches[0]["charge"]]});
    normalize_quote(&q).map_err(Into::into)
}
pub async fn fetch_aws(instance: &str, region: &str) -> Result<Value, ConnectionError> {
    if !AWS_TYPES.contains(&instance) || !AWS_REGIONS.contains(&region) {
        return Err("Tipo o región EC2 no admitidos".into());
    }
    static GATE: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
    let _permit = GATE.try_acquire().map_err(|_| ConnectionError {
        code: "busy".into(),
        message: "Ya hay una consulta EC2 regional en curso.".into(),
        action: "Espera a que termine antes de volver a consultar.".into(),
        host: Some("pricing.us-east-1.amazonaws.com".into()),
        retryable: true,
    })?;
    tokio::time::timeout(Duration::from_secs(240), async {
        let client = http::client(Duration::from_secs(220))?;
        let host = "pricing.us-east-1.amazonaws.com";
        let mut response = client
            .get(aws_source(region))
            .send()
            .await
            .map_err(|e| http::from_transport(&e, host))?;
        if !response.status().is_success() {
            return Err(http::status_error(response.status().as_u16(), host));
        }
        const MAX: u64 = 512_000_000;
        if response.content_length().is_some_and(|n| n > MAX) {
            return Err("El catálogo EC2 supera 512 MB".into());
        }
        let (tx, rx) = tokio::sync::mpsc::channel(2);
        let inst = instance.to_string();
        let reg = region.to_string();
        let parser = tokio::task::spawn_blocking(move || {
            parse_aws(
                ChunkReader {
                    rx,
                    chunk: io::Cursor::new(Vec::new()),
                },
                &inst,
                &reg,
            )
        });
        let mut total = 0u64;
        let mut failure = None;
        loop {
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    total += chunk.len() as u64;
                    if total > MAX {
                        failure = Some("El catálogo EC2 supera 512 MB".into());
                        break;
                    }
                    if tx.send(chunk.to_vec()).await.is_err() {
                        break;
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    failure = Some(http::from_transport(&e, host));
                    break;
                }
            }
        }
        drop(tx);
        let parsed = parser
            .await
            .map_err(|_| ConnectionError::from("No se pudo procesar el catálogo EC2"))?;
        if let Some(error) = failure {
            return Err(error);
        }
        parsed
    })
    .await
    .unwrap_or_else(|_| {
        Err(timeout(
            "pricing.us-east-1.amazonaws.com",
            "La consulta regional EC2 superó cuatro minutos.",
        ))
    })
}
fn timeout(host: &str, message: &str) -> ConnectionError {
    ConnectionError {
        code: "timeout".into(),
        message: message.into(),
        action: "Comprueba la red e inténtalo de nuevo.".into(),
        host: Some(host.into()),
        retryable: true,
    }
}

fn gcp_charge(
    rows: &[Value],
    region: &str,
    kind: &str,
    quantity: u32,
    fetched: &str,
) -> Result<Value, ConnectionError> {
    let mut matches = Vec::new();
    for sku in rows {
        let description = sku["description"].as_str().unwrap_or("");
        let lower = description.to_ascii_lowercase();
        let prefix = if kind == "vcpu-hour" {
            "n2 instance core running in "
        } else {
            "n2 instance ram running in "
        };
        if !lower.starts_with(prefix)
            || sku["category"]["usageType"] != "OnDemand"
            || sku["category"]["resourceFamily"] != "Compute"
            || !sku["serviceRegions"]
                .as_array()
                .is_some_and(|a| a.iter().any(|r| r == region))
        {
            continue;
        }
        let prices = sku["pricingInfo"].as_array().ok_or_else(invalid)?;
        let mut valid: Vec<_> = prices
            .iter()
            .filter(|p| {
                p["effectiveTime"]
                    .as_str()
                    .and_then(timestamp)
                    .is_some_and(|d| d <= timestamp(fetched).unwrap())
            })
            .collect();
        valid.sort_by_key(|p| p["effectiveTime"].as_str().and_then(timestamp));
        let price = *valid.last().ok_or_else(invalid)?;
        if valid
            .iter()
            .filter(|p| p["effectiveTime"] == price["effectiveTime"])
            .count()
            != 1
        {
            return Err(invalid());
        }
        let expr = &price["pricingExpression"];
        let rates = expr["tieredRates"].as_array().ok_or_else(invalid)?;
        let unit = if kind == "vcpu-hour" { "h" } else { "GiBy.h" };
        if expr["usageUnit"] != unit
            || price
                .get("currencyConversionRate")
                .is_some_and(|v| v.as_f64() != Some(1.))
            || rates.len() != 1
            || rates[0]
                .get("startUsageAmount")
                .map_or(Some(0.), Value::as_f64)
                != Some(0.)
        {
            return Err(invalid());
        }
        let money = &rates[0]["unitPrice"];
        let units = money
            .get("units")
            .map_or(Some(0), |v| v.as_str().and_then(|s| s.parse::<u64>().ok()))
            .ok_or_else(invalid)?;
        let nanos = money
            .get("nanos")
            .map_or(Some(0), Value::as_i64)
            .ok_or_else(invalid)?;
        if money["currencyCode"] != "USD"
            || !(0..1_000_000_000).contains(&nanos)
            || units > 1_000_000_000_000
        {
            return Err(invalid());
        }
        let exact = format!("{units}.{nanos:09}");
        matches.push(json!({"id":sku["name"],"description":description,"unit":kind,"quantity":quantity,"unitPriceUSD":exact,"effective":price["effectiveTime"]}));
    }
    if matches.len() != 1 {
        return Err(invalid());
    }
    Ok(matches.remove(0))
}
fn parse_gcp(
    rows: &[Value],
    instance: &str,
    region: &str,
    fetched: &str,
) -> Result<Value, ConnectionError> {
    let (cpu, memory) = n2_spec(instance).ok_or_else(invalid)?;
    normalize_quote(&json!({"model":MODEL,"provider":"GCP","instanceType":instance,"region":region,"vcpu":cpu,"memoryGiB":memory,"source":GCP_SOURCE,"fetched":fetched,"charges":[gcp_charge(rows,region,"vcpu-hour",cpu,fetched)?,gcp_charge(rows,region,"gib-hour",memory,fetched)?]})).map_err(Into::into)
}
#[derive(Default)]
struct GcpCatalog {
    rows: Vec<Value>,
    bytes: usize,
    count: usize,
    seen: HashSet<String>,
}
impl GcpCatalog {
    fn push(&mut self, body: Value, region: &str) -> Result<Option<String>, ConnectionError> {
        self.bytes += body.to_string().len();
        let rows = body["skus"].as_array().ok_or_else(invalid)?;
        self.count += rows.len();
        if self.bytes > 128_000_000 || self.count > 100000 {
            return Err("Catálogo GCP demasiado grande".into());
        }
        self.rows.extend(
            rows.iter()
                .filter(|sku| {
                    sku["description"]
                        .as_str()
                        .is_some_and(|s| s.to_ascii_lowercase().starts_with("n2 instance "))
                        && sku["serviceRegions"]
                            .as_array()
                            .is_some_and(|a| a.iter().any(|r| r == region))
                })
                .cloned(),
        );
        let token = match body.get("nextPageToken") {
            None => String::new(),
            Some(Value::String(s)) if s.len() <= 2000 => s.clone(),
            _ => return Err(invalid()),
        };
        if token.is_empty() {
            return Ok(None);
        }
        if !self.seen.insert(token.clone()) {
            return Err("Paginación GCP cíclica".into());
        }
        Ok(Some(token))
    }
}
pub async fn fetch_gcp(instance: &str, region: &str, key: &str) -> Result<Value, ConnectionError> {
    if n2_spec(instance).is_none() || !GCP_REGIONS.contains(&region) {
        return Err("Tipo o región N2 no admitidos".into());
    }
    if key.is_empty()
        || key.len() > 499
        || !key.is_ascii()
        || key.bytes().any(|b| b.is_ascii_control())
    {
        return Err(ConnectionError{code:"credentials_required".into(),message:"GCP requiere una API key válida de Cloud Billing.".into(),action:"Introduce la clave efímera de un proyecto con Cloud Billing API habilitada. No se guardará.".into(),host:Some("cloudbilling.googleapis.com".into()),retryable:false});
    }
    tokio::time::timeout(Duration::from_secs(120), async {
        let client = http::client(Duration::from_secs(25))?;
        let mut token = String::new();
        let mut catalog = GcpCatalog::default();
        for _ in 0..100 {
            let mut url = url::Url::parse(GCP_SOURCE).map_err(|_| invalid())?;
            url.query_pairs_mut()
                .append_pair("currencyCode", "USD")
                .append_pair("pageSize", "5000");
            if !token.is_empty() {
                url.query_pairs_mut().append_pair("pageToken", &token);
            }
            let response = client
                .get(url)
                .header("X-Goog-Api-Key", key)
                .send()
                .await
                .map_err(|e| http::from_transport(&e, "cloudbilling.googleapis.com"))?;
            if !response.status().is_success() {
                return Err(http::status_error(
                    response.status().as_u16(),
                    "cloudbilling.googleapis.com",
                ));
            }
            let body = bounded_json(response).await?;
            match catalog.push(body, region)? {
                Some(next) => token = next,
                None => {
                    return parse_gcp(
                        &catalog.rows,
                        instance,
                        region,
                        &chrono::Utc::now().to_rfc3339(),
                    )
                }
            }
        }
        Err("Se alcanzó el límite de páginas GCP; no se usa un catálogo parcial".into())
    })
    .await
    .unwrap_or_else(|_| {
        Err(timeout(
            "cloudbilling.googleapis.com",
            "La consulta GCP superó dos minutos.",
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn quote() -> Value {
        serde_json::from_str(include_str!("../../tests/aws-quote-fixture.json")).unwrap()
    }
    fn catalog(rows: usize, field: Option<(&str, &str)>) -> Vec<u8> {
        let fields = [
            ("SKU", "test"),
            ("RateCode", "test.JRTCKXETXF.hour"),
            ("TermType", "OnDemand"),
            ("OfferTermCode", "JRTCKXETXF"),
            ("PriceDescription", "Linux m6i.xlarge, on demand"),
            ("EffectiveDate", "2026-10-01"),
            ("StartingRange", "0"),
            ("EndingRange", "Inf"),
            ("Unit", "Hrs"),
            ("PricePerUnit", "0.2140000000"),
            ("Currency", "USD"),
            ("Product Family", "Compute Instance"),
            ("Instance Type", "m6i.xlarge"),
            ("Region Code", "eu-west-1"),
            ("Operating System", "Linux"),
            ("Tenancy", "Shared"),
            ("Pre Installed S/W", "NA"),
            ("License Model", "No License required"),
            ("MarketOption", "OnDemand"),
            ("CapacityStatus", "Used"),
            ("operation", "RunInstances"),
            ("vCPU", "4"),
            ("Memory", "16 GiB"),
        ];
        let mut csv = csv::WriterBuilder::new()
            .flexible(true)
            .from_writer(Vec::new());
        for row in [
            ["Version", "20261029175634"],
            ["Publication Date", "2026-10-29T17:56:34Z"],
            ["OfferCode", "AmazonEC2"],
        ] {
            csv.write_record(row).unwrap();
        }
        csv.write_record(fields.iter().map(|(k, _)| k)).unwrap();
        for _ in 0..rows {
            csv.write_record(
                fields
                    .iter()
                    .map(|(k, v)| field.filter(|(f, _)| f == k).map_or(*v, |(_, v)| v)),
            )
            .unwrap();
        }
        csv.into_inner().unwrap()
    }
    #[test]
    fn streams_csv_with_quoted_commas_and_exact_prices() {
        let q = parse_aws(catalog(1, None).as_slice(), "m6i.xlarge", "eu-west-1").unwrap();
        assert_eq!(q["charges"][0]["unitPriceUSD"], "0.2140000000");
        assert_eq!(q["vcpu"], 4);
    }
    #[test]
    fn refuses_ambiguous_absent_reserved_and_incompatible_rates() {
        for rows in [0, 2] {
            assert!(parse_aws(catalog(rows, None).as_slice(), "m6i.xlarge", "eu-west-1").is_err());
        }
        for field in [
            ("Operating System", "Windows"),
            ("Tenancy", "Dedicated"),
            ("TermType", "Reserved"),
            ("MarketOption", "Spot"),
            ("Pre Installed S/W", "SQL Std"),
            ("Region Code", "us-east-1"),
            ("Currency", "EUR"),
            ("Unit", "seconds"),
            ("StartingRange", "1"),
        ] {
            assert!(
                parse_aws(
                    catalog(1, Some(field)).as_slice(),
                    "m6i.xlarge",
                    "eu-west-1"
                )
                .is_err(),
                "{field:?}"
            );
        }
    }
    #[test]
    fn refuses_truncated_stream_and_limits_single_malformed_record() {
        let mut bytes = catalog(1, None);
        bytes.extend_from_slice(b"partial,row\n");
        assert!(parse_aws(bytes.as_slice(), "m6i.xlarge", "eu-west-1").is_err());
        let bytes = std::iter::once(b'"')
            .chain(std::iter::repeat_n(b'a', 1_100_000))
            .collect::<Vec<_>>();
        assert!(parse_aws(bytes.as_slice(), "m6i.xlarge", "eu-west-1").is_err());
    }
    fn gcp() -> Vec<Value> {
        [("Core","h",31000000),("Ram","GiBy.h",4000000)].iter().map(|(kind,unit,nanos)|json!({"name":format!("services/compute/skus/{kind}"),"description":format!("N2 Instance {kind} running in Netherlands"),"category":{"resourceFamily":"Compute","usageType":"OnDemand"},"serviceRegions":["europe-west4"],"pricingInfo":[{"effectiveTime":"2025-01-01T00:00:00Z","pricingExpression":{"usageUnit":unit,"tieredRates":[{"unitPrice":{"currencyCode":"USD","nanos":nanos}}]}}]})).collect()
    }
    #[test]
    fn composes_n2_cpu_memory_and_protobuf_defaults() {
        let q = parse_gcp(
            &gcp(),
            "n2-standard-4",
            "europe-west4",
            "2026-01-01T00:00:00Z",
        )
        .unwrap();
        assert_eq!(q["charges"][0]["unitPriceUSD"], "0.031000000");
        assert_eq!(q["charges"][1]["quantity"], 16);
        assert_eq!(q["memoryGiB"], 16);
    }
    #[test]
    fn rejects_gcp_ambiguity_regions_units_tiers_and_invalid_money() {
        let mut rows = gcp();
        rows.push(rows[0].clone());
        assert!(parse_gcp(
            &rows,
            "n2-standard-4",
            "europe-west4",
            "2026-01-01T00:00:00Z"
        )
        .is_err());
        for (pointer, value) in [
            ("/serviceRegions", json!(["us-central1"])),
            ("/pricingInfo/0/pricingExpression/usageUnit", json!("s")),
            (
                "/pricingInfo/0/pricingExpression/tieredRates/0/startUsageAmount",
                json!(1),
            ),
            (
                "/pricingInfo/0/pricingExpression/tieredRates/0/unitPrice/nanos",
                json!(-1),
            ),
            (
                "/pricingInfo/0/pricingExpression/tieredRates/0/unitPrice/currencyCode",
                json!("EUR"),
            ),
            (
                "/pricingInfo/0/effectiveTime",
                json!("2999-01-01T00:00:00Z"),
            ),
        ] {
            let mut rows = gcp();
            let target = rows[0].pointer_mut(pointer);
            if let Some(target) = target {
                *target = value;
            } else {
                rows[0]["pricingInfo"][0]["pricingExpression"]["tieredRates"][0]
                    ["startUsageAmount"] = value;
            }
            assert!(
                parse_gcp(
                    &rows,
                    "n2-standard-4",
                    "europe-west4",
                    "2026-01-01T00:00:00Z"
                )
                .is_err(),
                "{pointer}"
            );
        }
    }
    #[test]
    fn normalizes_only_public_fields_and_rejects_forged_sources() {
        let mut q = quote();
        q["apiKey"] = json!("secret");
        q["charges"][0]["secret"] = json!("secret");
        assert!(!normalize_quote(&q).unwrap().to_string().contains("secret"));
        q["source"] = json!("https://example.com");
        assert!(normalize_quote(&q).is_err());
    }
    #[test]
    fn sqlite_budget_normalization_keeps_alternatives_without_credentials() {
        let mut budget: Value = serde_json::from_str(include_str!(
            "../../docs/evidence/azure-components-2026-10-29.snapshot.json"
        ))
        .unwrap();
        budget["comparisonQuotes"] = json!([quote()]);
        let normalized = crate::validation::normalize_budget(
            budget["id"].as_str().unwrap(),
            &budget.to_string(),
        )
        .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&normalized).unwrap()["comparisonQuotes"][0],
            quote()
        );
        budget["comparisonQuotes"] = json!([quote(), quote()]);
        assert!(crate::validation::normalize_budget(
            budget["id"].as_str().unwrap(),
            &budget.to_string()
        )
        .is_err());
    }
    #[test]
    fn collects_gcp_pages_and_rejects_cycles_and_malformed_tokens() {
        let rows = gcp();
        let mut c = GcpCatalog::default();
        assert_eq!(
            c.push(
                json!({"skus":[rows[0]],"nextPageToken":"next"}),
                "europe-west4"
            )
            .unwrap(),
            Some("next".into())
        );
        assert!(parse_gcp(
            &c.rows,
            "n2-standard-4",
            "europe-west4",
            "2026-01-01T00:00:00Z"
        )
        .is_err());
        assert_eq!(
            c.push(json!({"skus":[rows[1]]}), "europe-west4").unwrap(),
            None
        );
        assert!(parse_gcp(
            &c.rows,
            "n2-standard-4",
            "europe-west4",
            "2026-01-01T00:00:00Z"
        )
        .is_ok());
        assert!(c
            .push(json!({"skus":[],"nextPageToken":"next"}), "europe-west4")
            .is_err());
        assert!(GcpCatalog::default()
            .push(json!({"skus":[],"nextPageToken":123}), "europe-west4")
            .is_err());
        assert!(GcpCatalog::default()
            .push(json!({}), "europe-west4")
            .is_err());
    }
}
