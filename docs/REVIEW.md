# Revisión de estabilidad e interfaz

## Fallos corregidos

- Un consumo inválido (cero instancias, decimales en instancias, campo vacío o infinito) podía lanzar una excepción durante el render de React. Ahora se valida antes de calcular y se muestra el error sin bloquear la interfaz.
- Los JSON importados admitían campos incompletos o tarifas incompatibles. Se valida la estructura y la concordancia de SKU/región, moneda, unidad, precio, modalidad, vigencia y tipo de medidor. El backend aplica también validación antes de SQLite. Se rechazan fechas imposibles, ambiguas o sin zona, y se descartan campos desconocidos tanto en la importación como al persistir.
- Una consulta Azure pendiente podía reemplazar un escenario recién abierto. Las respuestas de consultas anteriores se descartan cuando cambia la configuración o se importa un presupuesto.
- El identificador SQL de un presupuesto era diferente de su ID JSON. Ahora se genera y reutiliza un único ID.
- Una fila dañada bloqueaba todo el historial. Se omite y se informa del número de filas no válidas.
- El selector usaba solo meterId, que puede repetirse con distintos precios y fechas. Usa una clave compuesta, deduplica copias idénticas y muestra la fecha de vigencia.
- Se excluyen tarifas futuras y medidores con tramos detectados en el catálogo; no se extrapola su primer tramo.
- La gráfica anual usaba un mensual ya redondeado. Ahora parte del importe completo y aplica redondeo decimal coherente con el motor, incluso en medios céntimos.
- La caché con fecha futura se aceptaba como fresca. Se rechaza y se marcan como obsoletas las fechas inválidas, futuras o expiradas.
- Los errores de red desaparecían al recuperar una caché. Se conservan en un aviso visible.
- El límite HTTP solo comprobaba Content-Length. Ahora también se comprueba durante la lectura. Se añade un plazo total de 90 segundos para Azure.
- La prueba de proveedor solo miraba HTTP 200. Ahora comprueba JSON y la estructura del catálogo esperado.
- Se endurece la exportación CSV contra fórmulas precedidas por espacios y saltos.
- La API key GCP se elimina al salir de la pantalla y al iniciar la comprobación. No se persiste.
- Se actualiza Vitest y su árbol de dependencias para eliminar los avisos detectados por npm audit.

## Mejoras visuales

Dashboard de resumen, calculadora y comparador con pantallas diferenciadas; iconografía SVG; menú compacto; tarjetas con alcance real de costes; selector de proveedores por tarjetas; tema claro/oscuro y caducidad persistentes; búsqueda de presupuestos; estados vacíos, avisos y acciones de exportación; diseño adaptable, foco de teclado y respeto a movimiento reducido. Los gráficos se cargan bajo demanda: el JavaScript inicial baja de aproximadamente 648 kB a 299 kB sin comprimir.

## Verificación

- Pruebas TypeScript: cálculo decimal, importación, selección, caducidad y CSV.
- 11 pruebas Chromium: navegación/tema/menú, consumos inválidos, importaciones, fila corrupta/IDs, respuesta tardía, borrado de API key, preferencias, exportación y diagnósticos de proxy/TLS.
- 20 pruebas Rust del núcleo: HTTP, caché, restricciones de paginación, filtros, esquema de presupuestos y seis pruebas nuevas con SQLite en disco.
- Compilación frontend y revisión visual en Chromium.
- `npm audit`: cero vulnerabilidades al revisar el árbol actualizado.
- CI ampliada con navegador, auditoría, formato y núcleo Rust sin GUI, además de instaladores para Windows y Linux.

## Pendientes y límites

Azure se verificó en vivo el 29 de octubre de 2026; véase [AZURE-LIVE.md](AZURE-LIVE.md). La persistencia real de caché y snapshots se verificó en [SQLITE-LIVE.md](SQLITE-LIVE.md). Las pruebas de navegador con IPC simulado se limitan a verificar el comportamiento de la interfaz. Las importaciones JSON son datos aportados por el usuario: no prueban la autenticidad de una tarifa, aunque la estructura sea correcta. Siguen pendientes AWS/GCP de estimación, equivalencia técnica de instancias, almacenamiento/red, divisas, PDF nativo, firma y pruebas manuales de los instaladores. Los presupuestos de esta versión contienen una única tarifa de computación.
