# Conectividad con las fuentes de precios

Azure Retail Prices es una API pública. Consultar sus tarifas no requiere una cuenta ni un login de Azure.

## Qué se ha corregido en el cliente

El cliente HTTPS utiliza el almacén de certificados de confianza del sistema y conserva las variables heredadas `SSL_CERT_FILE` y `SSL_CERT_DIR` cuando están configuradas. También activa la detección de proxy del sistema de reqwest, disponible en Windows/macOS, además del proxy configurado por variables de entorno. La validación TLS permanece activa y no se siguen redirecciones hacia otros dominios.

Los errores de proxy, certificados, autorización, tiempo de espera y conexión tienen códigos separados. El frontend muestra su mensaje, acción y dominio. No se muestran URLs con parámetros, cabeceras, claves ni causas internas completas. Solo se reintentan fallos transitorios; un rechazo del túnel o un certificado inválido se informa inmediatamente.

## Si el proxy rechaza la conexión

Permite acceso HTTPS al dominio `prices.azure.com` en la red donde se ejecuta la aplicación.

### Codex Cloud: publicar el cambio y usar una tarea nueva

La configuración de un entorno publicado se utiliza al crear tareas nuevas. Una tarea existente conserva su propio estado; continuar o reintentar en el mismo chat no demuestra que esté utilizando el setup publicado actualizado.

1. Abre **Ajustes > Codex Cloud > Entornos** y selecciona **… > Editar** en el entorno correspondiente.
2. Configura el acceso a Internet. **Permitir todo el acceso público a Internet** incluye los dominios de gestores de paquetes y los dominios adicionales; por eso esos controles más específicos quedan deshabilitados. Para una lista restringida, desactiva el acceso público completo y añade `prices.azure.com` a los dominios permitidos adicionales.
3. Guarda, prueba la configuración y selecciona **Publicar / Republicar**.
4. Crea una **tarea nueva** y selecciona ese entorno publicado. Recupera el código desde GitHub y ejecuta el diagnóstico indicado más abajo.

Las aprobaciones de sitios web de ChatGPT Work administran la navegación y no sustituyen esta configuración de Codex Cloud. Tampoco el permiso «Acceso completo» de una conversación añade por sí mismo una herramienta para editar o publicar el entorno.

Referencias oficiales: [Using Codex Cloud](https://help.openai.com/en/articles/20001545-using-codex-cloud), apartado «Continue your work and update the setup», y [Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments), apartados «Reuse and update saved state» y «Connect to services».

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

El diagnóstico anterior ejecutado en el entorno de creación produjo `code=proxy_denied`, `host=prices.azure.com` y `retryable=false`. La consulta de estado del entorno seguía sin incluir ese dominio entre los autorizados. El 29 de octubre de 2026, una tarea nueva con política pública `unrestricted`, estado `enforced` y observaciones actuales permitió la consulta en vivo. El conector de producción devolvió seis tarifas horarias y el motor seleccionó una opción Linux de pago por uso. Consulta [AZURE-LIVE.md](AZURE-LIVE.md) para la evidencia, el subtotal y los límites de esta comprobación. El bloqueo anterior se conserva aquí como antecedente.
