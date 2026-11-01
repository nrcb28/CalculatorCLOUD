# Computación AWS y GCP: alcance y verificación

El 30 de octubre de 2026 el conector de producción leyó el catálogo regional EC2
completo de `eu-west-1` (281.745.381 bytes en esa publicación). Encontró una única
combinación admitida para `m6i.xlarge`: Linux compartido, sin software adicional,
OnDemand, capacidad Used, operación RunInstances, USD/h sin tramos.

- 4 vCPU y 16 GiB, obtenidos de ese producto del catálogo.
- Precio original: `0.2140000000` USD/h; una instancia × 730 horas = **156,22 USD**.
- Publicación `2026-10-29T17:56:34Z`, versión `20261029175634`.
- Cotización y fecha de consulta: [evidencia JSON](evidence/aws-compute-2026-10-30.json).
- [Snapshot combinado](evidence/multicloud-2026-10-30.snapshot.json): conserva las tarifas Azure de su consulta anterior y esta alternativa AWS. Son selecciones independientes; no acredita equivalencia técnica ni geográfica.

Reproducción desde la raíz:

```sh
cargo run --locked --manifest-path src-tauri/Cargo.toml --no-default-features --example aws_connection -- m6i.xlarge eu-west-1
```

La URL `current` cambia con el proveedor; repetir la consulta puede producir otra
versión o precio. La cotización conserva versión, fuente, fecha y cargo original.
La descarga se procesa en flujo con contrapresión, un único catálogo EC2 en curso,
límite de 512 MB/1 millón de filas, presupuesto por registro y cuatro minutos.
No se devuelve una tarifa si falla el resto del catálogo o hay dos coincidencias.
Los errores de red se muestran y permiten una nueva consulta explícita.

## Uso en la aplicación

En Comparador elige proveedor, tipo y región explícitos. EC2 admite inicialmente
`m6i.xlarge`, `m6a.xlarge`, `c6i.xlarge`, `r6i.xlarge`; regiones `eu-west-1`,
`eu-central-1`, `us-east-1`. La comprobación real anterior cubre una combinación;
las restantes se resuelven mediante el mismo filtro estricto, sin precios precargados.

GCP admite N2 standard de 2, 4, 8, 16 y 32 vCPU (4 GiB/vCPU), regiones
`europe-west4`, `europe-west1`, `us-central1`. Usa el servicio Compute Engine
`6F81-5844-456A` de Cloud Billing, paginado, en USD. Compone cargos OnDemand Core
(`h`) y Ram (`GiBy.h`), con una sola tarifa sin tramos y fecha vigente. No aplica
descuentos sostenidos ni compromisos. La API key se envía en `X-Goog-Api-Key`,
no en la URL. Se elimina del formulario al consultar/salir y no se guarda,
exporta ni incluye en diagnósticos. No pegar claves en documentación ni chats.

**GCP en vivo sigue pendiente:** la consulta real sin clave devolvió HTTP 403
`PERMISSION_DENIED`. El entorno no contiene una clave configurada. Las pruebas
con respuestas sintéticas verifican interpretación y cálculo, no precios GCP
reales. Introducir una clave válida en la aplicación permitirá la comprobación.

Instancias y horas se toman de la calculadora. Cada alternativa conserva sus
recursos, región, cargos, fuente y fecha. No se infiere equivalencia, rendimiento
ni proveedor ganador. Solo computación: no incluye discos/red AWS o GCP,
impuestos, soporte, licencias adicionales, descuentos ni otros servicios.

Para guardar o exportar selecciona una tarifa Azure y usa sus controles JSON,
CSV o SQLite. El campo opcional `comparisonQuotes` admite una alternativa por
proveedor y preserva snapshots antiguos. Las alternativas se recalculan con el
consumo compartido y **no se suman al subtotal Azure**. Importar JSON valida
estructura y condiciones; no prueba autenticidad contra el proveedor.

La aplicación conserva cotizaciones históricas hasta consultar otra vez o
quitarlas; sus fechas están visibles. No reutiliza silenciosamente una tarifa
histórica como si acabara de obtenerla de la red.

Fuentes de formato y alcance:
[AWS Bulk](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/using-the-aws-price-list-bulk-api.html),
[GCP SKUs](https://cloud.google.com/billing/docs/reference/rest/v1/services.skus/list),
[N2](https://cloud.google.com/compute/docs/general-purpose-machines#n2_machine_types).

## Comprobaciones de esta fase

Pasan 82 pruebas TypeScript, 44 Rust y 17 Chromium, formato y compilación frontend.
La auditoría npm no detectó vulnerabilidades. El 1 de noviembre se comprobó
además guardar y reabrir el snapshot real combinado en una base SQLite nueva:
[evidencia de reapertura](evidence/multicloud-sqlite-2026-10-30.json).
El [CSV reproducido con el motor](evidence/multicloud-2026-10-30.csv) incluye la
versión AWS y distingue las alternativas del subtotal Azure. El recorrido de
WebView/IPC real y los instaladores se comprueban en GitHub Actions.
