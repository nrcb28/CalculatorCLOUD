# Plan incremental

- [x] Fase 1: React, TypeScript, Tailwind, Tauri 2, navegación, temas y configuración de CI.
- [x] Fase 2 inicial: consumo por SKU explícito, cálculo decimal USD, pruebas y validación.
- [x] Fase 3 inicial: código del conector Azure, paginación, reintentos y caché SQLite.
- [x] Verificar Azure contra el servicio real para un SKU/región y conservar evidencia reproducible; véase [AZURE-LIVE.md](AZURE-LIVE.md).
- [x] Verificar caché y snapshots con SQLite en disco, reapertura y fallos de red; véase [SQLITE-LIVE.md](SQLITE-LIVE.md).
- [x] Integración HTTP local: paginación, ciclos, límite de páginas, 429, errores permanentes, redirecciones y cuerpos inválidos o sobredimensionados.
- [x] Verificar WebView/IPC/SQLite con prueba nativa automatizada en Linux; véase [NATIVE-SMOKE.md](NATIVE-SMOKE.md).
- [ ] Pruebas manuales de instaladores Windows/Linux.
- [ ] Integrar catálogos AWS Bulk / Query y GCP Billing; custodia mediante almacén de credenciales del SO cuando se incorporen secretos.
- [x] Cotización opcional de capacidad Premium SSD LRS y salida MGN por tramos, con uso previo, fuentes, snapshots/CSV/SQLite y evidencia en [AZURE-COMPONENTS.md](AZURE-COMPONENTS.md).
- [ ] Fase 4: catálogo de especificaciones técnicas, equivalencias y precios completos de discos y red.
- [x] Fase 5 inicial: proyección de computación, snapshots JSON/SQLite, importación y CSV; impresión del sistema.
- [ ] Proyectos con múltiples recursos, escenarios variables, comparación histórica y generador PDF nativo con fuentes y gráficos.
- [ ] EUR con fuente de cambio verificable, unidades GB/GiB normalizadas, tramos, descuentos y localización inglesa.
- [ ] Fase 6: confirmar builds CI y pruebas manuales Windows/Linux; firma de instaladores y distribución pública.

No presentar los elementos pendientes como terminados. No hay un comparador multicloud completo en v0.1.

## Orden de las siguientes fases

1. **Fiabilidad y escritorio:** corregir fallos, ampliar pruebas HTTP y verificar
   WebView/IPC/SQLite mediante tauri-driver. El control nativo Linux pasó en CI el 29 de octubre de 2026 y
   queda como comprobación obligatoria en cada revisión.
2. **Costes Azure:** cotización de disco con tamaño/tipo/replicación explícitos y
   salida a Internet por tramos, con uso previo de cuenta y límites de cobertura.
   Capacidad Premium SSD LRS y salida MGN completadas con persistencia compatible.
   Quedan otros discos, rutas y cargos excluidos en [AZURE-COMPONENTS.md](AZURE-COMPONENTS.md).
3. **Multicloud:** catálogo AWS público, GCP Billing con credenciales disponibles,
   especificaciones oficiales y comparación por condiciones equivalentes.
4. **Escenarios e informes:** múltiples recursos, variación de consumo, histórico,
   PDF nativo; preservar precisión y trazabilidad en cada formato.
5. **Divisas e idiomas:** conversión EUR con fuente/fecha verificables, unidades
   normalizadas y localización inglesa.
6. **Distribución:** pruebas manuales Windows/Linux, firma con certificados del
   propietario y publicación de una versión verificada.

Cada fase se sube con sus comprobaciones. Las credenciales de GCP, certificados
para firma y la validación manual de Windows requieren recursos que no están
configurados en este entorno; no se simulan ni se marcan como completados.
