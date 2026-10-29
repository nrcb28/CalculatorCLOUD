use crate::http::{self, ConnectionError};
use serde::Deserialize;
use std::time::Duration;
pub const AZURE: &str = "https://prices.azure.com/api/retail/prices";
#[derive(Deserialize)]
struct Page {
    #[serde(rename = "Items")]
    items: Vec<serde_json::Value>,
    #[serde(rename = "NextPageLink", deserialize_with = "required_next")]
    next: Option<String>,
}
// La propiedad ausente no acredita el final del catálogo. Solo null o "".
fn required_next<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}
fn valid_url(url: &url::Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("prices.azure.com")
        && url.port_or_known_default() == Some(443)
        && url.path() == "/api/retail/prices"
        && url.username().is_empty()
        && url.password().is_none()
}
const MAX_RESPONSE_BYTES: usize = 20_000_000;
pub async fn bounded_json(
    mut response: reqwest::Response,
) -> Result<serde_json::Value, ConnectionError> {
    if response.content_length().unwrap_or(0) > MAX_RESPONSE_BYTES as u64 {
        return Err("Respuesta demasiado grande".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "No se pudo leer la respuesta del proveedor")?
    {
        if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err("Respuesta demasiado grande".into());
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| "El proveedor no devolvió JSON válido".into())
}
pub fn fresh(fetched: &str, ttl: u32, now: chrono::DateTime<chrono::Utc>) -> bool {
    chrono::DateTime::parse_from_rfc3339(fetched)
        .map(|date| {
            let age = now.signed_duration_since(date).num_milliseconds();
            age >= 0 && age < i64::from(ttl) * 3_600_000
        })
        .unwrap_or(false)
}
pub async fn fetch_catalog(
    sku: &str,
    region: &str,
) -> Result<Vec<serde_json::Value>, ConnectionError> {
    if !crate::validation::valid_input(sku, region, 24) {
        return Err("SKU o región no válidos".into());
    }
    let client = http::client(Duration::from_secs(30))?;
    let mut next = url::Url::parse(AZURE).map_err(|_| "URL no válida")?;
    next.query_pairs_mut().append_pair("api-version", "2023-01-01-preview").append_pair("currencyCode", "'USD'").append_pair("$filter", &format!("serviceName eq 'Virtual Machines' and armRegionName eq '{}' and armSkuName eq '{}' and priceType eq 'Consumption'", region, sku));
    fetch_pages(&client, next, valid_url).await
}

// La política de destinos de producción sigue siendo valid_url; las pruebas usan
// un servidor HTTP de loopback para ejercer el mismo transporte y paginación.
async fn fetch_pages(
    client: &reqwest::Client,
    mut next: url::Url,
    allowed: impl Fn(&url::Url) -> bool,
) -> Result<Vec<serde_json::Value>, ConnectionError> {
    let mut all = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for _ in 0..100 {
        if !allowed(&next) || !seen.insert(next.to_string()) {
            return Err("Paginación Azure no válida".into());
        }
        let host = next.host_str().ok_or("URL no válida")?;
        let mut response = None;
        for attempt in 0..3 {
            match client.get(next.clone()).send().await {
                Ok(r) if r.status().is_success() => {
                    response = Some(r);
                    break;
                }
                Ok(r) => {
                    let failure = http::status_error(r.status().as_u16(), host);
                    if !failure.retryable || attempt == 2 {
                        return Err(failure);
                    }
                    let delay = r
                        .headers()
                        .get("retry-after")
                        .and_then(|x| x.to_str().ok())
                        .and_then(|x| x.parse::<u64>().ok())
                        .unwrap_or(1 << attempt)
                        .min(30);
                    tokio::time::sleep(Duration::from_secs(delay)).await;
                }
                Err(error) => {
                    let failure = http::from_transport(&error, host);
                    if !failure.retryable || attempt == 2 {
                        return Err(failure);
                    }
                    tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
                }
            }
        }
        let r = response.ok_or("Azure no disponible tras tres intentos")?;
        let page: Page = serde_json::from_value(bounded_json(r).await?)
            .map_err(|_| "Respuesta Azure no válida")?;
        all.extend(page.items);
        if all.len() > 100_000 {
            return Err("Catálogo demasiado grande".into());
        }
        match page.next.filter(|s| !s.is_empty()) {
            Some(link) => next = url::Url::parse(&link).map_err(|_| "Enlace Azure no válido")?,
            None => return Ok(all),
        }
    }
    Err("Se alcanzó el límite de páginas; no se usa un catálogo parcial".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_rejects_future_and_expiry() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-01-02T00:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        assert!(!fresh("2026-01-03T00:00:00Z", 24, now));
        assert!(!fresh("2026-01-01T00:00:00Z", 24, now));
        assert!(fresh("2026-01-01T12:00:00Z", 24, now));
        assert!(!fresh("invalid", 24, now));
    }
    #[test]
    fn restricts_pagination() {
        assert!(valid_url(&url::Url::parse(AZURE).unwrap()));
        for bad in [
            "http://prices.azure.com/api/retail/prices",
            "https://evil.example/api/retail/prices",
            "https://prices.azure.com:8443/api/retail/prices",
            "https://prices.azure.com/other",
        ] {
            assert!(!valid_url(&url::Url::parse(bad).unwrap()));
        }
    }
}

#[cfg(test)]
mod integration_tests;
