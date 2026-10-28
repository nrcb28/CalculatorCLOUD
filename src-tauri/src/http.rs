use serde::Serialize;
use std::error::Error as StdError;
use std::fmt;
use std::time::Duration;

/// Error de conexión apto para IPC: no contiene URLs, cabeceras ni causas sin filtrar.
#[derive(Clone, Debug, Serialize)]
pub struct ConnectionError {
    pub code: String,
    pub message: String,
    pub action: String,
    pub host: Option<String>,
    pub retryable: bool,
}

impl fmt::Display for ConnectionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}
impl StdError for ConnectionError {}
impl From<String> for ConnectionError {
    fn from(message: String) -> Self {
        Self {
            code: "application".into(),
            message,
            action: String::new(),
            host: None,
            retryable: false,
        }
    }
}
impl From<&str> for ConnectionError {
    fn from(message: &str) -> Self {
        Self::from(message.to_owned())
    }
}

/// Conserva los proxies heredados y la validación TLS con las raíces del sistema.
pub fn client(timeout: Duration) -> Result<reqwest::Client, ConnectionError> {
    reqwest::Client::builder()
        .timeout(timeout)
        .connect_timeout(timeout.min(Duration::from_secs(10)))
        .redirect(reqwest::redirect::Policy::none())
        .https_only(true)
        .build()
        .map_err(|error| from_transport(&error, ""))
}

fn safe_host(host: &str) -> Option<String> {
    if host.is_empty() || host.len() > 253 {
        return None;
    }
    let valid = host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    });
    valid.then(|| host.to_owned())
}

fn error(code: &str, message: &str, action: &str, host: &str, retryable: bool) -> ConnectionError {
    ConnectionError {
        code: code.into(),
        message: message.into(),
        action: action.into(),
        host: safe_host(host),
        retryable,
    }
}

/// Usa la cadena de causas solo para clasificar; nunca la devuelve ni la registra.
pub fn from_transport(cause: &reqwest::Error, host: &str) -> ConnectionError {
    let mut source = cause.source();
    let mut details = String::new();
    // La causa superior de reqwest puede incluir la URL; no se necesita para clasificar.
    for _ in 0..12 {
        let Some(current) = source else { break };
        if details.len() >= 8000 {
            break;
        }
        details.extend(current.to_string().chars().take(1000));
        details.push('\n');
        source = current.source();
    }
    from_details(
        cause.is_timeout(),
        cause.is_builder(),
        cause.is_connect(),
        &details,
        host,
    )
}

fn from_details(
    timeout: bool,
    builder: bool,
    connect: bool,
    details: &str,
    host: &str,
) -> ConnectionError {
    if builder {
        return error(
            "client_config",
            "No se pudo configurar el cliente HTTPS.",
            "Comprueba la configuración del proxy y que el almacén de certificados del sistema sea accesible.",
            host,
            false,
        );
    }
    if timeout {
        return error(
            "timeout",
            "La conexión superó el tiempo máximo de espera.",
            "Comprueba la conexión y el proxy. Inténtalo de nuevo cuando se restablezca el acceso.",
            host,
            true,
        );
    }
    let details = details.to_ascii_lowercase();
    if [
        "proxy authorization required",
        "proxy authentication required",
        "proxyauthrequired",
        "http/1.1 407",
        "http/1.0 407",
    ]
    .iter()
    .any(|needle| details.contains(needle))
    {
        return status_error(407, host);
    }
    if [
        "tunnel error: unsuccessful",
        "tunnel unsuccessful",
        "proxy tunnel rejected",
        "unsuccessful tunnel",
    ]
    .iter()
    .any(|needle| details.contains(needle))
    {
        return error(
            "proxy_denied",
            "El proxy rechazó el túnel HTTPS hacia la fuente de precios.",
            "Permite el dominio indicado en la configuración de red del entorno o solicita su acceso al administrador. Iniciar sesión en el proveedor no elimina este bloqueo.",
            host,
            false,
        );
    }
    if [
        "invalid peer certificate",
        "invalid certificate",
        "certificate verify failed",
        "unknownissuer",
        "unknown issuer",
        "tls handshake",
        "certificate has expired",
    ]
    .iter()
    .any(|needle| details.contains(needle))
    {
        return error(
            "tls",
            "No se pudo verificar el certificado HTTPS de la conexión.",
            "Comprueba la fecha del sistema y el almacén de certificados de confianza. Si utilizas un proxy corporativo, solicita su certificado al administrador; mantén activa la validación TLS.",
            host,
            false,
        );
    }
    error(
        "connection",
        if connect {
            "No se pudo establecer la conexión con la fuente de precios."
        } else {
            "La petición no pudo completarse por un error de transporte."
        },
        "Comprueba Internet, la resolución DNS y las reglas del proxy o firewall para el dominio indicado.",
        host,
        true,
    )
}

pub fn status_error(status: u16, host: &str) -> ConnectionError {
    let (code, message, action, retryable) = match status {
        401 => (
            "unauthorized",
            "La fuente de precios rechazó la autorización (HTTP 401).".into(),
            "Revisa las condiciones de acceso de la API y la configuración del proxy. No introduzcas credenciales si la fuente es pública.",
            false,
        ),
        403 => (
            "forbidden",
            "El acceso a la fuente de precios fue rechazado (HTTP 403).".into(),
            "Revisa los permisos de la API y las reglas de acceso del proxy o firewall. Las tarifas públicas de Azure no requieren iniciar sesión.",
            false,
        ),
        407 => (
            "proxy_auth",
            "El proxy exige autenticación para permitir la conexión.".into(),
            "Configura el acceso al proxy mediante los ajustes del sistema o las variables de entorno autorizadas. No introduzcas credenciales del proveedor cloud para resolverlo.",
            false,
        ),
        429 => (
            "rate_limit",
            "La fuente de precios ha limitado las solicitudes (HTTP 429).".into(),
            "Espera el plazo indicado por la fuente antes de volver a intentarlo.",
            true,
        ),
        500..=599 => (
            "server",
            format!("La fuente de precios tiene un error temporal (HTTP {}).", status),
            "Inténtalo de nuevo más tarde o utiliza las tarifas de caché indicando su fecha.",
            true,
        ),
        _ => (
            "http_status",
            format!("La fuente de precios respondió HTTP {}.", status),
            "Revisa la disponibilidad del endpoint y la configuración de acceso.",
            false,
        ),
    };
    error(code, &message, action, host, retryable)
}

#[cfg(test)]
mod tests {
    use super::*;
    const HOST: &str = "prices.azure.com";

    #[test]
    fn classifies_proxy_auth_and_tunnel_denial_without_inventing_status() {
        let auth = from_details(
            false,
            false,
            true,
            "tunnel error: proxy authorization required",
            HOST,
        );
        assert_eq!(auth.code, "proxy_auth");
        assert!(!auth.retryable);
        let denied = from_details(false, false, true, "tunnel error: unsuccessful", HOST);
        assert_eq!(denied.code, "proxy_denied");
        assert!(!denied.message.contains("403"));
        assert!(!denied.retryable);
    }
    #[test]
    fn classifies_tls_timeout_and_invalid_configuration() {
        let tls = from_details(
            false,
            false,
            true,
            "invalid peer certificate: UnknownIssuer",
            HOST,
        );
        assert_eq!(tls.code, "tls");
        assert!(!tls.retryable);
        assert_eq!(from_details(true, false, true, "", HOST).code, "timeout");
        assert!(from_details(true, false, true, "", HOST).retryable);
        let config = from_details(false, true, false, "proxy builder details", HOST);
        assert_eq!(config.code, "client_config");
        assert!(!config.retryable);
    }
    #[test]
    fn exposes_only_safe_messages_and_hostnames() {
        let detail = "invalid peer certificate: UnknownIssuer; https://user:secret@example.test/path?token=example-token; Authorization: Bearer example-token";
        let classified = from_details(false, false, true, detail, HOST);
        let json = serde_json::to_string(&classified).unwrap();
        assert!(!json.contains("secret"));
        assert!(!json.contains("example-token"));
        assert!(!json.contains("Authorization"));
        assert_eq!(classified.host.as_deref(), Some(HOST));
        let hostile = from_details(
            false,
            false,
            true,
            "",
            "https://user:secret@example.test/?token=example-token",
        );
        assert!(hostile.host.is_none());
        assert!(!serde_json::to_string(&hostile)
            .unwrap()
            .contains("example-token"));
    }
    #[test]
    fn retries_only_rate_limits_and_server_http_failures() {
        for code in [401, 403, 407, 400, 404, 302] {
            assert!(!status_error(code, HOST).retryable);
        }
        for code in [429, 500, 502, 503, 599] {
            assert!(status_error(code, HOST).retryable);
        }
        assert_eq!(status_error(403, HOST).code, "forbidden");
        assert!(status_error(403, HOST)
            .action
            .contains("no requieren iniciar sesión"));
    }
    #[test]
    fn supports_internal_errors_without_transport_details() {
        let from_owned = ConnectionError::from("Caché no válida".to_string());
        assert_eq!(from_owned.code, "application");
        assert_eq!(from_owned.to_string(), "Caché no válida");
        assert!(!from_owned.retryable);
        assert!(ConnectionError::from("Falta configuración").host.is_none());
    }
}
