# Plan incremental

- [x] Fase 1: React, TypeScript, Tailwind, Tauri 2, navegación, temas y configuración de CI.
- [x] Fase 2 inicial: consumo por SKU explícito, cálculo decimal USD, pruebas y validación.
- [x] Fase 3 inicial: código del conector Azure, paginación, reintentos y caché SQLite.
- [x] Verificar Azure contra el servicio real para un SKU/región y conservar evidencia reproducible; véase [AZURE-LIVE.md](AZURE-LIVE.md).
- [x] Verificar caché y snapshots con SQLite en disco, reapertura y fallos de red; véase [SQLITE-LIVE.md](SQLITE-LIVE.md).
- [ ] Ampliar integración HTTP con paginación y errores del servicio; verificar WebView/IPC e instaladores manualmente.
- [ ] Integrar catálogos AWS Bulk / Query y GCP Billing; custodia mediante almacén de credenciales del SO cuando se incorporen secretos.
- [ ] Fase 4: catálogo de especificaciones técnicas, equivalencias y precios completos de discos y red.
- [x] Fase 5 inicial: proyección de computación, snapshots JSON/SQLite, importación y CSV; impresión del sistema.
- [ ] Proyectos con múltiples recursos, escenarios variables, comparación histórica y generador PDF nativo con fuentes y gráficos.
- [ ] EUR con fuente de cambio verificable, unidades GB/GiB normalizadas, tramos, descuentos y localización inglesa.
- [ ] Fase 6: confirmar builds CI y pruebas manuales Windows/Linux; firma de instaladores y distribución pública.

No presentar los elementos pendientes como terminados. No hay un comparador multicloud completo en v0.1.
