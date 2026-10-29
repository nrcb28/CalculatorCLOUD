use super::*;
use serde_json::json;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
};

struct Server {
    url: url::Url,
    requests: Arc<Mutex<Vec<String>>>,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}
impl Server {
    fn new(reply: impl Fn(usize, &str) -> String + Send + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = url::Url::parse(&format!(
            "http://{}/api/retail/prices",
            listener.local_addr().unwrap()
        ))
        .unwrap();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let log = requests.clone();
        let flag = stop.clone();
        let worker = thread::spawn(move || {
            while !flag.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        stream
                            .set_read_timeout(Some(Duration::from_secs(2)))
                            .unwrap();
                        let mut request = Vec::new();
                        let mut chunk = [0; 1024];
                        while !request.ends_with(b"\r\n\r\n") && request.len() < 16384 {
                            match stream.read(&mut chunk) {
                                Ok(0) | Err(_) => break,
                                Ok(n) => request.extend_from_slice(&chunk[..n]),
                            }
                        }
                        let request = String::from_utf8_lossy(&request).into_owned();
                        let index = {
                            let mut log = log.lock().unwrap();
                            let index = log.len();
                            log.push(request.clone());
                            index
                        };
                        let _ = stream.write_all(reply(index, &request).as_bytes());
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                    }
                    Err(error) => panic!("Servidor local: {error}"),
                }
            }
        });
        Self {
            url,
            requests,
            stop,
            worker: Some(worker),
        }
    }
    fn count(&self) -> usize {
        self.requests.lock().unwrap().len()
    }
    fn run(&self) -> Result<Vec<serde_json::Value>, ConnectionError> {
        let client = reqwest::Client::builder()
            .no_proxy()
            // El servidor es HTTP local: no cargar el almacén TLS de Windows
            // en paralelo para estas pruebas. Producción conserva sus raíces.
            .tls_built_in_root_certs(false)
            .timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let origin = self.url.origin();
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(fetch_pages(&client, self.url.clone(), |url| {
                url.origin() == origin && url.path() == "/api/retail/prices"
            }))
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        self.worker.take().unwrap().join().unwrap();
    }
}
fn response(status: u16, headers: &str, body: &str) -> String {
    format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}", body.len())
}
fn page(items: serde_json::Value, next: serde_json::Value) -> String {
    response(
        200,
        "",
        &json!({"Items":items,"NextPageLink":next}).to_string(),
    )
}
fn host(request: &str) -> &str {
    request
        .lines()
        .find_map(|line| line.strip_prefix("host: "))
        .unwrap()
        .trim()
}

#[test]
fn collects_all_http_pages_without_using_partial_catalogs() {
    let server = Server::new(|index, request| match index {
        0 => page(
            json!([{"meterId":"first"}]),
            json!(format!(
                "http://{}/api/retail/prices?$skip=1",
                host(request)
            )),
        ),
        _ => page(json!([{"meterId":"second"}]), json!(null)),
    });
    let result = server.run().unwrap();
    assert_eq!(
        result,
        vec![json!({"meterId":"first"}), json!({"meterId":"second"})]
    );
    assert_eq!(server.count(), 2);
    assert!(server.requests.lock().unwrap()[1].contains("$skip=1"));
}

#[test]
fn rejects_pagination_cycles_and_external_destinations_before_requesting_them() {
    for next in ["https://external.invalid/api/retail/prices", "cycle"] {
        let server = Server::new(move |_, request| {
            let link = if next == "cycle" {
                format!("http://{}/api/retail/prices", host(request))
            } else {
                next.into()
            };
            page(json!([{"meterId":"partial"}]), json!(link))
        });
        assert!(server.run().is_err());
        assert_eq!(server.count(), 1);
    }
}

#[test]
fn rate_limit_retries_then_returns_the_complete_response() {
    let server = Server::new(|index, _| {
        if index == 0 {
            response(429, "Retry-After: 0\r\n", "{}")
        } else {
            page(json!([{"meterId":"retried"}]), json!(null))
        }
    });
    assert_eq!(server.run().unwrap().len(), 1);
    assert_eq!(server.count(), 2);
}

#[test]
fn persistent_rate_limit_stops_after_three_attempts() {
    let server = Server::new(|_, _| response(429, "Retry-After: 0\r\n", "{}"));
    let error = server.run().unwrap_err();
    assert!(error.retryable);
    assert_eq!(server.count(), 3);
}

#[test]
fn permanent_http_failures_and_redirects_are_not_retried_or_followed() {
    for status in [400, 401, 403, 404, 302] {
        let server = Server::new(move |_, _| {
            response(status, "Location: https://external.invalid/\r\n", "{}")
        });
        assert!(server.run().is_err());
        assert_eq!(server.count(), 1);
    }
}

#[test]
fn rejects_invalid_json_schema_and_oversized_http_bodies() {
    for body in ["not JSON", "{}", "{\"Items\":{}}", "{\"Items\":[]}"] {
        let server = Server::new(move |_, _| response(200, "", body));
        assert!(server.run().is_err());
    }
    let server = Server::new(|_, _| {
        "HTTP/1.1 200 OK\r\nContent-Length: 20000001\r\nConnection: close\r\n\r\n".into()
    });
    assert_eq!(
        server.run().unwrap_err().message,
        "Respuesta demasiado grande"
    );
}

#[test]
fn enforces_streamed_body_limit_without_content_length() {
    let server = Server::new(|_, _| {
        let body = "x".repeat(MAX_RESPONSE_BYTES + 1);
        format!("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n{}\r\n0\r\n\r\n", body.len(), body)
    });
    assert_eq!(
        server.run().unwrap_err().message,
        "Respuesta demasiado grande"
    );
}

#[test]
fn page_limit_never_returns_a_partial_catalog() {
    let server = Server::new(|index, request| {
        page(
            json!([{"meterId":index}]),
            json!(format!(
                "http://{}/api/retail/prices?$skip={}",
                host(request),
                index + 1
            )),
        )
    });
    assert!(server
        .run()
        .unwrap_err()
        .message
        .contains("límite de páginas"));
    assert_eq!(server.count(), 100);
}

#[test]
fn rejects_a_failure_on_a_later_page_instead_of_returning_partial_prices() {
    let server = Server::new(|index, request| {
        if index == 0 {
            page(
                json!([{"meterId":"partial"}]),
                json!(format!(
                    "http://{}/api/retail/prices?$skip=1",
                    host(request)
                )),
            )
        } else {
            response(403, "", "{}")
        }
    });
    assert!(server.run().is_err());
    assert_eq!(server.count(), 2);
}
