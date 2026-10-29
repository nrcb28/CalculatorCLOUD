# Continuar la verificación de CloudCost Compare

> Verificación en vivo completada el 29 de octubre de 2026. Lee
> [AZURE-LIVE.md](AZURE-LIVE.md) para resultados, evidencia reproducible y
> pendientes. La persistencia SQLite se verificó después en
> [SQLITE-LIVE.md](SQLITE-LIVE.md). La guía siguiente conserva el contexto de la tarea original.

## Punto de partida

- Repositorio: https://github.com/nrcb28/CalculatorCLOUD, rama `main`.
- Última revisión de código funcional previa a esta guía: `601b17f`.
- Escritorio Tauri 2 + React/TypeScript + Rust, interfaz en español y SQLite.
- Motor, snapshots, importación/exportación y conector Azure inicial implementados.
- Verificación local anterior: 56 pruebas TypeScript, 14 Rust y 11 Chromium aprobadas; npm audit sin vulnerabilidades. La CI generó instaladores Windows y Linux.
- AWS/GCP tienen pruebas de acceso al catálogo, pero no conectores de estimación. No presentar el proyecto como un comparador multicloud terminado.

## Bloqueo que motivó la nueva tarea

El entorno de la conversación anterior devolvía `proxy_denied` para `prices.azure.com` y no incluía ese dominio en su política activa. El usuario editó la configuración de Internet de Codex Cloud. La documentación oficial indica que hay que guardar, republicar y empezar una tarea nueva para usar el setup actualizado; las tareas existentes conservan su estado. No asumir que volver a intentar en la conversación anterior aplicó la nueva configuración.

## Objetivo de la tarea nueva

1. Lee `README.md`, `docs/CONNECTIVITY.md` y el código antes de modificarlo. Inspecciona el checkout existente; recupera `main` si hace falta sin sobrescribir trabajo ajeno.
2. Consulta el estado actual del entorno y confirma que la política permite `prices.azure.com` o acceso público completo. Si sigue rechazado, identifica la configuración publicada utilizada; no intentes eludir el proxy ni alterar archivos locales para aparentar permisos.
3. Comprueba Rust/Node disponibles. Ejecuta, desde el repositorio:

   ```sh
   cargo run --locked --manifest-path src-tauri/Cargo.toml --no-default-features --example azure_connection
   ```

   Este diagnóstico usa el conector de producción para `Standard_D4s_v5`, `westeurope`, USD. La salida 0 y `ok: true` acreditan respuesta del catálogo con tarifas horarias del SKU/región solicitados, no una comparación completa ni el arranque del instalador.
4. Si responde Azure, examina las tarifas originales y valida una opción Linux de pago por uso, vigente y comparable con la configuración, excluyendo Windows, Spot, Low Priority, DevTest, reservas y tramos no soportados. Conserva fuente y fecha. No inventes precios ni uses el texto traducido y malformado que se pegó en la conversación anterior como fixture de producción.
5. Comprueba el subtotal de computación para 1 instancia y 730 horas con el motor decimal. Identifica almacenamiento y red como componentes sin cotizar; no declares un ganador multicloud.
6. Guarda evidencia reproducible y documenta con precisión lo verificado y lo pendiente. Corrige fallos reales, ejecuta las comprobaciones correspondientes y sube los cambios a este repositorio, según la autorización original del usuario.

La consulta pública de Azure no necesita credenciales. El cliente mantiene TLS validado, usa certificados/proxy del sistema y muestra errores estructurados sin secretos. La aplicación de escritorio y SQLite necesitan comprobaciones adicionales a las pruebas de navegador con IPC simulado; no afirmar que están verificadas solo porque el diagnóstico HTTP funcione.
