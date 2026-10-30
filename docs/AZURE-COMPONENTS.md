# Cotización Azure: capacidad de discos y salida a Internet

Se incorpora una cotización opcional junto a la computación: **un disco Premium
SSD LRS por instancia** y salida estándar a Internet por la red Microsoft (MGN).
La interfaz, JSON, CSV y SQLite conservan las tarifas seleccionadas, fechas,
región, versión del modelo y el tráfico previo declarado. Los snapshots antiguos siguen funcionando
sin añadirles una tarifa ni un coste de almacenamiento/red.

## Verificación en vivo del 29 de octubre de 2026

La validación del snapshot y su reapertura en SQLite se repitieron el 30 de octubre.

- [Catálogo original de componentes](evidence/azure-components-2026-10-29.catalog.json):
  64 registros de Premium SSD y los seis tramos MGN, recuperados a las 17:31 CET.
- [Catálogo original de computación](evidence/azure-components-2026-10-29.compute-catalog.json):
  nueva consulta a las 17:39 CET. Las fuentes no se consultan atómicamente;
  cada catálogo conserva su fecha.
- [Snapshot normalizado](evidence/azure-components-2026-10-29.snapshot.json),
  [cálculo decimal](evidence/azure-components-2026-10-29.subtotal.json),
  [CSV](evidence/azure-components-2026-10-29.csv) y
  [reapertura real de SQLite](evidence/azure-components-2026-10-29.sqlite.json).

Para `Standard_D4s_v5`, `westeurope`, una instancia y 730 horas, con 100 GiB
solicitados por disco, 1.000 GB de salida y cero GB previos de cuenta:

| Recurso | Condición | Mensual USD |
| --- | --- | ---: |
| Computación | Linux PAYG, 0,23 USD/h | 167,90 |
| Capacidad de disco | P10 LRS de 128 GiB, 1 mes de catálogo | 21,68 |
| Salida MGN | 100 GB a 0 + 900 GB a 0,087 USD/GB | 78,30 |
| Subtotal cotizado | Sin impuestos ni otros servicios | **267,88** |

Anual de referencia: **3.214,56 USD**, si se repiten cada mes tanto el consumo
como el uso previo declarado. Se anualiza desde el importe decimal completo,
no desde subtotales ya redondeados.

## Condiciones y cobertura

Los tamaños se verificaron en la [documentación oficial de discos](https://learn.microsoft.com/en-us/azure/virtual-machines/disks-types#premium-ssds):
P1 4 GiB, P2 8, P3 16, P4 32, P6 64, P10 128, P15 256, P20 512,
P30 1024, P40 2048, P50 4096, P60 8192, P70 16384 y P80 32767 GiB.
Se elige el siguiente tamaño que cubre la solicitud; 128,1 GiB requiere P15.
Cero GiB implica cero discos cotizados. Se debe comprobar que la VM admite
Premium SSD; no se acredita compatibilidad ni equivalencia de rendimiento.

Se utiliza una unidad mensual `1/Month` por disco e instancia, aunque las horas
de VM sean cero. Es un mes de referencia del catálogo; no se prorratea la
capacidad según las horas de VM ni se reproduce una factura de un mes natural.
Se excluyen bursting de pago, snapshots, discos extra, replicación ZRS y otros
tipos de almacenamiento. Esta fase cotiza capacidad, no todos los cargos de un disco.

Para red se usan literalmente los GB y límites publicados por la API:
0, 100, 10335, 51295, 153695 y 512095. No se convierten GB a GiB. Se suma
el tráfico del escenario al tráfico previo declarado para la misma escala MGN,
y se cobra únicamente el intervalo incremental. Así no se aplica la franquicia
otra vez por instancia o recurso. Cero uso previo supone disponer de la
franquicia completa; el usuario debe reflejar el resto de su cuenta y comprobar
sus condiciones de facturación. Consumos de otras escalas o regiones con
condiciones distintas requieren revisión específica.

La [tabla web oficial de ancho de banda](https://azure.microsoft.com/en-us/pricing/details/bandwidth/),
consultada el 29 de octubre, indica 1 TB = 1000 GB y contacto comercial por encima
de 500 TB. Sus límites no coinciden con los `tierMinimumUnits` de la API (por
ejemplo, el siguiente tramo API comienza en 10335 GB). Se conserva el modelo
literal de la API, con advertencia visible, sin sustituir silenciosamente sus
límites por los de la tabla web. El ejemplo de 1000 GB queda por debajo de esa
diferencia. Para una contratación o factura se deben confirmar las condiciones
con Azure, especialmente cerca de cambios de tramo.

La cobertura se limita de forma conservadora a 500000 GB acumulados: no se
extrapola el último tramo ni el rango que la web remite a contacto comercial.
Si faltan tramos, aparecen duplicados incompatibles o Azure cambia esta escala,
la cotización se rechaza para revisión. No se usan tarifas de routing preference
Internet, China, tráfico de entrada, transferencias entre regiones/zonas, NAT,
IP pública ni servicios adicionales. Sin catálogo válido no se muestra un precio.

## Uso y conservación

1. En Calculadora, define GiB **por instancia** y GB de salida del escenario.
2. Introduce la salida previa de la cuenta y pulsa **Cotizar discos y red**.
3. Revisa el tamaño provisionado, tramos, exclusiones y fuente. El resumen
   mensual/anual suma computación y componentes; los gráficos siguen indicando
   computación. La comparación de proveedores conserva su alcance de computación.
4. Guarda o exporta: `components` contiene disco y escala completos; el CSV
   incluye filas por componente y subtotal, con fechas y condiciones.

La consulta adicional siempre usa la red con un plazo total de 90 segundos.
No usa la caché VM ni las preferencias de caducidad para omitir solicitudes.
Las tarifas guardadas en snapshots son históricas y se identifican como
obsoletas con la caducidad configurada. Cambiar región o tamaño solicitado
elimina la selección adicional; cambiar instancias o tráfico recalcula con
las tarifas conservadas. Una respuesta tardía no reemplaza un escenario importado.
Los JSON importados no acreditan autenticidad de tarifas.

## Reproducir

Con Rust estable y Node 22.18+:

```sh
npm ci
cargo run --locked --manifest-path src-tauri/Cargo.toml --no-default-features --example azure_components -- westeurope > /tmp/components.json
cargo run --locked --manifest-path src-tauri/Cargo.toml --no-default-features --example azure_connection -- /tmp/compute.json
node scripts/verify-components-evidence.mjs /tmp/components.json /tmp/compute.json /tmp/azure-quote
cargo run --locked --manifest-path src-tauri/Cargo.toml --no-default-features --example budget_roundtrip -- /tmp/azure-quote.snapshot.json /tmp/azure-quote-new.db
```

La base debe ser nueva. El archivo `.db` es solo para diagnóstico y no se sube.
La evidencia guardada no se carga desde producción como precio por defecto.

## Comprobaciones

78 pruebas TypeScript, 36 Rust, 14 Chromium, compilación frontend y formato.
Incluyen capacidad mínima, cero disco, fracciones de GB, cambio de tramo, uso
previo, límites, cotizaciones parciales/ambiguas, normalización y compatibilidad
de snapshots. El recorrido nativo Linux se amplía para guardar tanto el formato
antiguo como el nuevo y recuperar el subtotal de componentes tras reiniciar.
La ejecución CI de cada revisión acredita su compilación e instaladores; no
sustituye las pruebas manuales de Windows.

AWS/GCP de estimación, otros discos/rutas/servicios, proyectos con múltiples
recursos, EUR, PDF nativo y firma siguen en [PLAN.md](PLAN.md).
