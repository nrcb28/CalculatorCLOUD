# Consumo variable por mes de referencia

En **Calculadora → Plan de consumo mensual**, pulsa «Crear plan de doce meses».
El plan empieza copiando instancias y horas del mes base a los doce periodos.
Edita esas dos cantidades por mes; «Reiniciar con consumo base» reemplaza todas
las filas y «Quitar plan mensual» elimina solo el plan. Si falta una tarifa
Azure seleccionada, puedes preparar el consumo y consultar precios después.

El plan conserva el SKU, región, tipo/tamaño de disco, salida total y uso previo
del mes base. Admite de 1 a 100.000 instancias enteras y de 0 a 744 horas por
instancia y mes. Son **doce meses de referencia**, sin año o calendario civil:
no se deducen días de febrero, horarios de arranque, cambios de tarifa ni descuentos.

Cada fila se calcula desde las tarifas conservadas, sin nuevas consultas. La
computación Azure y las alternativas AWS/GCP usan las instancias y horas de esa
fila. Cuando existe la cotización de componentes, el disco Premium SSD LRS se
cobra por mes de referencia completo y por instancia, incluso con cero horas.
El tráfico total y el uso previo son iguales en todos los meses; se recalculan
los tramos de cada periodo de forma independiente, sin acumular tráfico anual.
Cero horas no significa eliminar discos ni anular la salida de la cuenta.

El total suma importes decimales exactos antes de redondear a céntimos; puede
no coincidir con la suma de los importes visibles redondeados. Las alternativas
se mantienen separadas de Azure. Las condiciones y exclusiones originales de
[Azure](AZURE-COMPONENTS.md) y [AWS/GCP](MULTICLOUD.md) siguen aplicándose.

El resumen, la anualización y los gráficos existentes muestran el consumo
constante del **mes base**. El plan tiene su propia tabla y total de doce meses;
no reemplaza ese resumen. La comparación histórica compara el mes base y
muestra un aviso si uno de los presupuestos contiene plan. Sus periodos quedan
conservados en los informes, pero aún no se compara la variación entre totales
de dos planes.

## Guardado y compatibilidad

Guardar/exportar el presupuesto incluye el campo opcional `usagePlan`, modelo
`monthly-usage-v1`, con exactamente doce objetos `{instances, hours}`. TypeScript
y Rust validan límites y descartan campos desconocidos antes de persistir.
Los presupuestos antiguos siguen funcionando sin migración; abrir uno elimina
el plan que estuviera activo en la calculadora. JSON y SQLite conservan sus
filas; el CSV añade costes de cada periodo y totales por proveedor, además de
las tarifas, fechas y condiciones originales.

Un plan inválido impide guardar/exportar hasta corregirlo, reiniciarlo con un
consumo base válido o quitarlo. Prepararlo no introduce credenciales, caché de
precios nueva ni consultas a los proveedores.

## Evidencia y límites

La [simulación JSON](evidence/usage-plan-2026-11-01.snapshot.json) parte del
presupuesto real capturado en octubre: mes 1 con una instancia y cero horas;
meses 2–6 con una instancia y 730 horas; meses 7–12 con dos y 730 horas. Mantiene
100 GiB solicitados por disco, 1.000 GB de salida y cero GB previos por mes.
Son hipótesis de consumo con precios constantes, no una nueva consulta ni una
predicción de facturación.

Los [cálculos](evidence/usage-plan-2026-11-01.computed.json) dan **4.184,14 USD**
para Azure (computación + capacidad de discos + salida) y **2.655,74 USD** para
la alternativa AWS (solo computación). El primer mes Azure conserva 99,98 USD
de disco y salida con cero horas de máquina. No se acredita equivalencia ni
se declara ganador. El [CSV](evidence/usage-plan-2026-11-01.csv) se reproduce con
`snapshotRows` y `csv` de `src/engine.ts`; `computePlan` reproduce el cálculo.

La [reapertura SQLite](evidence/usage-plan-2026-11-01.sqlite.json) se comprueba
mediante `budget_roundtrip`, que normaliza, guarda y vuelve a abrir la base:

```sh
cargo run --locked --manifest-path src-tauri/Cargo.toml --no-default-features --example budget_roundtrip -- docs/evidence/usage-plan-2026-11-01.snapshot.json /tmp/cloudcost-plan-new.sqlite
```

Usa una ruta de base nueva. Pasan 110 pruebas TypeScript, 45 Rust y 22 Chromium,
formato, compilación frontend y auditoría npm. El recorrido nativo Linux se
amplía para recuperar el plan después de guardar y reiniciar la aplicación;
su resultado e instaladores se comprueban en GitHub Actions.

Quedan proyectos con recursos distintos, meses de calendario, variación de
disco/red por periodo, descuentos, comparación entre planes y PDF nativo.
