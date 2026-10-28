# Conectividad con las fuentes de precios

Azure Retail Prices es una API pública. Consultar sus tarifas no requiere una cuenta ni un login de Azure.

## Qué se ha corregido en el cliente

El cliente HTTPS utiliza el almacén de certificados de confianza del sistema y conserva las variables heredadas `SSL_CERT_FILE` y `SSL_CERT_DIR` cuando están configuradas. También activa la detección de proxy del sistema de reqwest, disponible en Windows/macOS, además del proxy configurado por variables de entorno. La validación TLS permanece activa y no se siguen redirecciones hacia otros dominios.

Los errores de proxy, certificados, autorización, tiempo de espera y conexión tienen códigos separados. El frontend muestra su mensaje, acción y dominio. No se muestran URLs con parámetros, cabeceras, claves ni causas internas completas. Solo se reintentan fallos transitorios; un rechazo del túnel o un certificado inválido se informa inmediatamente.

## Si el proxy rechaza la conexión

Permite acceso HTTPS al dominio `prices.azure.com` en la red donde se ejecuta la aplicación. En un entorno administrado de Codex, la regla debe estar aplicada a ese entorno en ejecución; guardar una configuración sin aplicarla no acredita que el proceso tenga acceso. Puede ser necesario reaplicar o reiniciar el entorno.

La aplicación no puede modificar las reglas del proxy del entorno. Un login de Azure no resuelve un rechazo del túnel HTTPS. No se implementan rutas alternativas para eludir esa restricción.

## Si falla el certificado

Comprueba la fecha del sistema y sus certificados de confianza. Si la organización inspecciona HTTPS, solicita a su administrador la CA de confianza del proxy. El cliente utiliza el almacén del sistema; no hay una opción para desactivar la verificación TLS.

## Diagnóstico reproducible sin interfaz gráfica

Desde un checkout con Rust instalado:

```sh
cargo run --locked --manifest-path src-tauri/Cargo.toml --no-default-features --example azure_connection
```

El comando conserva la configuración de red del proceso. Consulta un SKU y una región fijos de Azure mediante el mismo conector de producción y devuelve JSON seguro:

- Salida 0: se recibió el catálogo y hay al menos una tarifa horaria USD del SKU/región solicitados.
- Salida 1: fallo de conexión, HTTP, respuesta o plazo máximo. El JSON contiene `code`, `message`, `action`, `host` y `retryable`.
- Salida 2: se recibió el catálogo, pero no se encontró una tarifa horaria compatible con los criterios del diagnóstico.

Esta comprobación no acredita el coste completo de una infraestructura ni compara rendimiento entre proveedores. No consulta AWS/GCP ni necesita sus credenciales.

## Evidencia de esta revisión

El diagnóstico ejecutado en el entorno de creación produjo `code=proxy_denied`, `host=prices.azure.com` y `retryable=false`. La consulta de estado del entorno seguía sin incluir ese dominio entre los autorizados. La corrección del cliente está comprobada; la obtención de precios en vivo sigue pendiente de que la regla de red se aplique realmente.
