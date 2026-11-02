# Proyectos de recursos e informes PDF

En **Proyectos** agrupa entre 1 y 40 recursos. Cada recurso contiene una copia
completa de su presupuesto, con configuración, tarifas, fuentes, fechas y plan
mensual opcional. Puedes añadir el escenario de la calculadora, un presupuesto
JSON o una copia guardada en SQLite. El borrador permanece al navegar entre
páginas; pulsa **Guardar proyecto** para conservarlo al cerrar la aplicación.

Pon un nombre a cada recurso y elige su proveedor. Azure usa su tarifa de
computación y, si existen, sus cotizaciones de disco/red. AWS/GCP solo permiten
seleccionarse cuando la copia incluye esa cotización; su alcance es computación.
El proyecto **solo suma el proveedor elegido** de cada recurso. Las otras tarifas
conservadas son información del presupuesto y no se añaden al total.

Los presupuestos individuales mantienen el formato existente, cuyo escenario
base es Azure. Las cotizaciones AWS/GCP conservadas permiten elegir esos
proveedores en el proyecto sin sumar el escenario Azure de la misma copia.
La presencia de una tarifa importada no acredita autenticidad contra el proveedor.
GCP en vivo sigue pendiente de una clave válida en este entorno.

**Abrir recurso en calculadora** permite editar su configuración y consultar
otras tarifas. El proyecto conserva su copia hasta pulsar **Reemplazar con
calculadora** en esa fila. Si la copia nueva no contiene el proveedor anterior,
el selector vuelve a Azure de forma visible. Añadir dos veces un presupuesto
crea dos recursos distintos y suma ambos; revisa nombres y cantidades.

## Totales y red compartida

El subtotal del mes base usa el consumo base de cada recurso. El de doce meses
aplica su plan mensual cuando existe; sin plan repite el mes base doce veces.
Las sumas usan importes decimales antes de redondear. No se presupone equivalencia
entre hardware o regiones y no se interpreta una diferencia como ahorro.
El total conserva la cobertura parcial de los recursos: impuestos, soporte,
descuentos y servicios sin cotizar no se convierten en cero ni en coste incluido.

Para no aplicar varias veces los tramos y la franquicia de salida de una cuenta,
**solo un recurso elegido como Azure puede tener salida mayor que cero**.
Consolida la salida de la cuenta en ese recurso y ajusta los otros a cero desde
la calculadora antes de reemplazarlos. Usa la región/tarifa aplicable y su uso
previo; no sumes tráfico de rutas o cuentas distintas como si fuera equivalente.
Para varias cuentas o regiones de salida usa proyectos separados. El programa
rechaza guardar/exportar un proyecto que incumpla esta regla. No incorpora un
modelo de cuentas o rutas de red ni reparto automático entre recursos.

## Persistencia y exportación

El formato `resource-project-v1` tiene `id`, `name`, `created` y `resources`.
Cada recurso contiene `id`, `name`, `provider` y `snapshot`. Identidades repetidas,
proveedores sin cotización, presupuestos inválidos o más de 40 recursos se
rechazan. La importación de proyecto admite un máximo de 10 MB. TypeScript y
Rust normalizan campos públicos; no conservan credenciales ni campos desconocidos.

SQLite incorpora una tabla `projects` independiente de `budgets` y `cache`.
Guardar actualiza el proyecto activo por ID; un proyecto nuevo recibe otro ID.
Un guardado inválido no reemplaza la copia válida anterior. Los presupuestos y
la caché existentes no necesitan migración destructiva. Las bibliotecas omiten
entradas corruptas e informan sin ocultar las demás.

**Proyecto JSON** permite reabrir el conjunto. **Proyecto CSV** distingue los
subtotales elegidos de las copias de precios conservadas; esas copias no deben
sumarse otra vez. Incluye fuentes, fechas, condiciones, meses y subtotal de doce
meses. Los proyectos no se importan como presupuestos individuales.

## PDF generado en la aplicación

**Generar PDF del proyecto** ejecuta el motor Rust, vuelve a validar el proyecto,
calcula los totales y abre el diálogo nativo para elegir el archivo. La escritura
usa un archivo temporal en la carpeta elegida y lo sustituye al completarse.
Cancelar el diálogo no cambia el proyecto ni escribe un PDF. Antes de guardar
se contrastan los importes Rust con los de la interfaz; una discrepancia impide
la exportación. Las ediciones posteriores requieren generar otro informe.

El PDF incluye:

- Subtotal del mes base, total de doce meses y costes de cada mes.
- Gráficos vectoriales mensuales y distribución por recurso, con escala desde cero.
- Recurso, proveedor elegido, alcance, configuración y plan de consumo.
- URL de catálogo, fecha de consulta, vigencia, medidores/cargos, cantidades y precios originales.
- Versión/publicación EC2 y condiciones de disco, salida, exclusiones y autenticidad.

No utiliza la impresión del sistema, un navegador externo ni consultas de red.
Incluye la tipografía Open Sans con caracteres españoles; las licencias Apache
2.0 se distribuyen con la aplicación. Si un carácter no tiene glifo, se sustituye
por `?` y se avisa en el informe; el JSON conserva el texto original. Los cálculos
usan decimales; solo los tamaños de las barras se convierten a números de gráfico.
El informe no certifica facturación ni equivalencia de rendimiento.

Para un presupuesto individual, crea un proyecto con un solo recurso y genera
su PDF. Guardar en SQLite y el diálogo PDF requieren Tauri; JSON/CSV y el borrador
pueden utilizarse desde la vista de navegador.

## Evidencia reproducible

El [proyecto JSON](evidence/project-2026-11-02.json) usa los precios capturados en
octubre y el plan de crecimiento ya documentado: un recurso Azure con disco/red
y otro AWS de computación. Es una simulación de recursos y consumo, no una nueva
consulta de precios ni evidencia de equivalencia. El subtotal del mes base es
**424,10 USD** y el de doce meses **6.839,88 USD** (4.184,14 + 2.655,74).

Consulta el [PDF real de tres páginas](evidence/project-2026-11-02.pdf),
[CSV](evidence/project-2026-11-02.csv),
[cálculos de la interfaz](evidence/project-2026-11-02.computed.json) y
[resultado SQLite/PDF de Rust](evidence/project-2026-11-02.sqlite-pdf.json).
El diagnóstico guarda, reabre y normaliza el proyecto antes de generar el PDF:

```sh
cargo run --locked --manifest-path src-tauri/Cargo.toml --no-default-features --example project_report -- docs/evidence/project-2026-11-02.json /tmp/cloudcost-project-new.sqlite /tmp/cloudcost-project-new.pdf
```

Usa rutas nuevas. Se comprueba lectura del PDF, número de páginas, fuente
incrustada, operaciones vectoriales, texto Unicode extraíble, importes, fuentes
y versión AWS. Las pruebas cubren elección de proveedor, doble red, copia pública,
reapertura y protección del guardado ante datos inválidos. Las pruebas de navegador
simulan IPC para verificar el guardado, la petición/cancelación del diálogo y los
estados tardíos; no acreditan por sí mismas un diálogo del sistema real.

El recorrido nativo Linux añade dos recursos, elige AWS en uno, guarda el proyecto,
reinicia, lo recupera y llama al generador PDF Rust por IPC real. Conserva
`native-project.pdf` en el artefacto `native-smoke-Linux`. La interacción manual con
el selector de archivos y los instaladores sigue pendiente de prueba manual.

Quedan calendario civil, variación de disco/red por periodo, comparación entre
planes/proyectos, modelo de cuentas/rutas de red, divisas y otras coberturas del plan.
