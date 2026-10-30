# Verificación Azure en vivo — 29 de octubre de 2026

> Esta comprobación es anterior a la cotización de capacidad de discos y salida,
> incorporada después en [AZURE-COMPONENTS.md](AZURE-COMPONENTS.md).

El conector de producción respondió correctamente: salida 0, `ok: true`, seis
tarifas horarias USD para `Standard_D4s_v5` en `westeurope`. Consulta realizada a
las 09:52:19 CET (08:52:19 UTC). TLS y proxy heredados, sin credenciales Azure.

## Evidencia original y selección

- [Catálogo sin normalizar](evidence/azure-2026-10-29.catalog.json), obtenido por
  `fetch_catalog` mediante el ejemplo Rust, con fuente y fecha de recuperación.
- [Salida del diagnóstico](evidence/azure-2026-10-29.connection.json).
- [Selección y cálculo del motor decimal](evidence/azure-2026-10-29.subtotal.json).

La tarifa seleccionada corresponde a `Virtual Machines Dsv5 Series`, medidor
`D4s v5`, ID `1ab41620-5ffa-51b3-ac16-6416f9f747a9`: `Consumption`, USD,
`1 Hour`, región primaria, tramo mínimo cero y vigencia desde
`2021-11-01T00:00:00Z`. La fecha indica inicio de vigencia, no fecha de consulta.
Es la opción Linux de pago por uso de esta familia: la otra tarifa regular
identifica expresamente Windows. Las otras cuatro son Spot o Low Priority
(con y sin Windows). No se utilizan reservas, DevTest ni los importes anidados
de `savingsPlan`. No hay tramos superiores para el medidor seleccionado.

El motor `candidates` admite exactamente una opción y `compute`, con decimal.js,
calcula **0,23 USD/h × 1 instancia × 730 horas = 167,90 USD**. El valor exacto
es `167.9`; anualizar multiplicando por 12 produce 2014,80 USD, una proyección
que presupone tarifa y consumo constantes. La [documentación oficial de Dsv5](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/dsv5-series)
consultada en esta revisión identifica `Standard_D4s_v5` con 4 vCPU y 16 GiB.
Esto no demuestra equivalencia de rendimiento entre proveedores.

## Reproducir

Con Rust estable y Node 22.18+ (para cargar TypeScript directamente):

```sh
npm ci
cargo run --locked --manifest-path src-tauri/Cargo.toml --no-default-features --example azure_connection -- docs/evidence/azure-new.catalog.json
node scripts/verify-azure-evidence.mjs docs/evidence/azure-new.catalog.json
```

El argumento de salida es opcional; sin él se conserva el diagnóstico original.
El script usa el motor de producción, verifica la fuente, fecha, SKU, región y
la única opción Linux esperada. Se detiene ante ambigüedad para exigir revisión
expresa. Un catálogo nuevo puede cambiar. La evidencia guardada es histórica,
no un fixture de producción ni garantía de precios futuros.

## Entorno y comprobaciones

La tarea utilizó política `unrestricted` en estado `enforced`, observaciones
actuales y sin identidades ni secretos configurados. Configuración publicada:
`f162dbb3-9d0e-4f7a-95ad-16cb4230af58~cecfg_6adc8ef67684819e80411434733dd218`,
versión `f162dbb3-9d0e-4f7a-95ad-16cb4230af58~cecfgver_6ae30552ceb0819eb8af85caab929ef7`.
No se alteró la política local ni se eludió el proxy.

Node 24.19.0 y Rust 1.99.1. Resultado local: 56 pruebas TypeScript, 14 Rust sin
GUI y 11 Chromium aprobadas; compilación frontend y formato aprobados;
`npm audit` sin vulnerabilidades. Los tests de navegador utilizan IPC simulado.

## Pendiente

Los 100 GB de almacenamiento del escenario y el tráfico (configurado a cero)
permanecen **sin cotizar**. Tampoco se incluyen licencias adicionales, soporte,
descuentos, impuestos ni otros servicios. AWS/GCP carecen de conectores de
estimación; no hay ganador multicloud. Esta ejecución no comprueba el arranque
de instaladores ni el WebView/IPC de Tauri. La persistencia real de caché y
snapshots se verificó después en [SQLITE-LIVE.md](SQLITE-LIVE.md). Las
compilaciones de instaladores requieren su propia CI.
