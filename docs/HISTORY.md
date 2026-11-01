# Comparación histórica de presupuestos

En **Presupuestos → Comparación histórica**, selecciona una base y un objetivo
de SQLite o importa un presupuesto JSON en cada lado. La comparación mantiene
sus configuraciones, tarifas y fechas originales, sin consultar los catálogos ni
sustituir el escenario de la calculadora. Las selecciones son temporales y se
limpian al salir de la página; las copias guardadas en SQLite permanecen intactas.

La tabla muestra las diferencias de SKU, región, instancias, horas, disco,
salida y uso previo. Los detalles de cada lado permiten revisar fuentes,
vigencias y condiciones; AWS/GCP incluyen tipo, región, vCPU y RAM de su copia.
Las fechas de guardado y consulta se presentan por separado. «Base» y «objetivo»
son elecciones del usuario: no se impone un orden cronológico.

La variación es **objetivo − base**, calculada con importes decimales sin redondear.
Se redondea a céntimos al mostrar. Por ejemplo, 0,0073 y 0,0146 USD se muestran
ambos como 0,01 USD, pero su diferencia exacta de 0,0073 se muestra como 0,01 USD,
y el porcentaje es 100 %. La base cero no tiene porcentaje definido, incluso
cuando ambos importes son cero. La anualización multiplica por doce con idéntico
consumo y las mismas condiciones; no pronostica precios futuros.

Siempre se compara computación Azure. El subtotal que incluye capacidad de
discos Premium SSD LRS y salida MGN solo se compara si ambos presupuestos
incluyen esos componentes. Si solo uno los tiene, aparece «Cambio de cobertura»
y se omite esa variación de subtotal. Una alternativa AWS/GCP solo se compara
cuando existe en ambos lados, con el consumo propio de cada escenario; no se
suma a Azure. Las selecciones no acreditan equivalencia técnica o geográfica.

Una variación no demuestra ahorro ni un cambio de precio del proveedor: también
pueden haber cambiado el consumo, hardware, región, producto o fecha. Los
importes solo cubren lo cotizado en cada presupuesto y están expresados en USD.
No se usan ni se necesitan credenciales para esta comparación.

**Exportar comparación JSON** produce un informe `historical-comparison-v1` con
ambos presupuestos normalizados, las diferencias calculadas y la fecha de
exportación. El CSV incluye filas originales de cada lado con sus fuentes,
fechas, condiciones y versión AWS, seguidas de las variaciones y avisos. El CSV
mantiene la protección contra fórmulas y conserva los decimales negativos
canónicos como cifras; las expresiones se protegen con apóstrofo. El informe
JSON conserva también los valores decimales exactos.

Este informe no es un presupuesto individual y no se importa desde «Importar
JSON». Para volver a comparar, selecciona los presupuestos originales o importa
las propiedades `baseline` y `target` como archivos de presupuesto separados.
La validación de una importación no acredita su autenticidad contra el proveedor.

Esta fase añade comparación histórica de dos presupuestos. La fase posterior
incorpora [planes mensuales](USAGE-PLAN.md); las variaciones históricas siguen
comparando el mes base, con aviso visible si hay planes. Proyectos con varios
recursos, comparación entre planes y PDF nativo siguen pendientes.

## Ejemplo reproducible y comprobaciones

[Informe JSON](evidence/history-2026-11-01.json) y
[CSV](evidence/history-2026-11-01.csv): parten del presupuesto multicloud con
precios reales capturados en octubre y simulan dos instancias en el objetivo,
con el resto del consumo y los precios conservados. Es una simulación de uso,
no una nueva consulta ni evidencia de cambio de tarifas.

El subtotal Azure pasa de 267,88 a 457,46 USD/mes (+189,58); computación y disco
se duplican, mientras la salida compartida de la cuenta permanece igual.
La alternativa AWS pasa de 156,22 a 312,44 USD/mes, sin sumarse a Azure.
Para reproducir se usan `compareSnapshots` y `historyRows` de `src/history.ts`
con las propiedades `baseline` y `target` del informe.

La comprobación local aprueba 89 pruebas TypeScript y 20 Chromium, además de
formato, compilación y auditoría npm. El recorrido nativo se amplía para
seleccionar dos copias recuperadas de SQLite y comprobar el aviso de cobertura.
Los instaladores y ese recorrido se validan en GitHub Actions.
