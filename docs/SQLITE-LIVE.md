# Persistencia real de caché y presupuestos

> Esta comprobación es anterior a la cotización de capacidad de discos y salida,
> incorporada después en [AZURE-COMPONENTS.md](AZURE-COMPONENTS.md).

El 29 de octubre de 2026 a las 09:56 CET se ejecutó el recorrido
Azure → SQLite en disco → reapertura de caché → snapshot → reapertura del historial.
La [salida original](evidence/sqlite-2026-10-29.live.json) conserva la fuente,
fecha de consulta y el snapshot recuperado.

La primera consulta a Azure devolvió seis registros con `cached=false`. La segunda
abrió otra conexión SQLite y devolvió el mismo catálogo y fecha con `cached=true`.
Se guardó la tarifa Linux PAYG ya revisada de `Standard_D4s_v5`, `westeurope`,
0,23 USD/h, y se recuperó el snapshot normalizado con su configuración completa.
El diagnóstico terminó con salida 0 y `ok=true`.

## Implementación y pruebas

Los comandos Tauri delegan ahora en `storage`, el mismo servicio Rust que utiliza
el diagnóstico. La ruta sigue siendo `app_data_dir()/cloudcost.db` en escritorio.
Se conserva el esquema SQLite, las claves de caché, el plazo de 90 segundos de
Azure, la validación de snapshots y el formato de las respuestas IPC.

Se añadieron seis pruebas con archivos SQLite reales y reapertura de conexiones:

- Historial persistente, orden descendente, Unicode, normalización y rechazo de
  IDs duplicados sin sobrescribir el original.
- Rechazo de snapshots inválidos antes de crear la base.
- Caché fresca persistente sin llamada de red y aislamiento por región.
- Caché expirada, futura o con fecha inválida: intento de actualización y aviso
  conservado al recuperar datos después de un fallo de red.
- Reparación de JSON corrupto y sustitución de precios antiguos tras actualizar.
- Errores de red sin caché, filtros inválidos y caché corrupta irrecuperable.

Las pruebas de fallos usan una función de consulta controlada; SQLite es real.
El diagnóstico optativo utiliza Azure real y no requiere credenciales.

## Reproducir

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features --lib
cargo run --locked --manifest-path src-tauri/Cargo.toml --no-default-features --example sqlite_connection -- /tmp/cloudcost-diagnostic-new/cloudcost.db
```

Usa una ruta nueva: el diagnóstico rechaza una base existente y conserva el
archivo creado para inspección posterior. No debe apuntar a los datos de la
aplicación. El ejemplo comprueba expresamente el medidor Linux revisado y se
detiene si el catálogo cambia o resulta ambiguo. La selección de la interfaz
sigue requiriendo intervención del usuario.

Resultado local: **20 pruebas Rust aprobadas** (14 anteriores y seis nuevas),
formato Rust y compilación de ambos diagnósticos sin GUI aprobados.

## Alcance pendiente

Esta comprobación acredita los servicios reales de persistencia usados por los
comandos de escritorio. No ejecuta el WebView, el transporte IPC ni un instalador.
El entorno local no incluye WebKitGTK; las compilaciones de Windows/Linux se
verifican en GitHub Actions para cada revisión. El arranque e interacción manual
de los instaladores siguen pendientes. Almacenamiento/red y AWS/GCP de estimación
también siguen pendientes; véase [AZURE-LIVE.md](AZURE-LIVE.md).
