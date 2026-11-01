import { computePlan, type Config, type Rate, type Snapshot } from "./engine";
import { type UsagePlan, PLAN_MODEL } from "./usage-plan";
import { type Components } from "./components";
import { type ComputeQuote } from "./comparison";
import { money } from "./money";
import { errorMessage } from "./errors";
export default function UsagePlanPanel({
  config,
  rate,
  fetched,
  components,
  quotes,
  plan,
  onChange,
  disabled,
}: {
  config: Config;
  rate?: Rate;
  fetched: string;
  components?: Components;
  quotes: ComputeQuote[];
  plan?: UsagePlan;
  onChange: (plan: UsagePlan | undefined) => void;
  disabled: boolean;
}) {
  function reset() {
    onChange({
      model: PLAN_MODEL,
      months: Array.from({ length: 12 }, () => ({
        instances: config.instances,
        hours: config.hours,
      })),
    });
  }
  let result: ReturnType<typeof computePlan> | undefined,
    error = "";
  if (plan && rate) {
    try {
      result = computePlan({
        id: "preview",
        name: "Plan mensual",
        created: new Date().toISOString(),
        fetched,
        config,
        rates: [rate],
        components,
        comparisonQuotes: quotes,
        usagePlan: plan,
      } satisfies Snapshot);
    } catch (e) {
      error = errorMessage(e);
    }
  }
  function edit(index: number, key: "instances" | "hours", value: number) {
    onChange({
      ...plan!,
      months: plan!.months.map((m, i) =>
        i === index ? { ...m, [key]: value } : m,
      ),
    });
  }
  return (
    <section className="usage-plan" data-testid="usage-plan">
      <div className="section-title">
        <div>
          <h3>Plan de consumo mensual</h3>
          <p>
            Doce meses de referencia con las tarifas conservadas. Sin nuevas
            consultas ni previsión de precios.
          </p>
        </div>
      </div>
      {!plan ? (
        <button disabled={disabled} onClick={reset}>
          Crear plan de doce meses
        </button>
      ) : (
        <>
          <p>
            Varía instancias y horas por mes. SKU, región, disco por instancia,
            salida total y uso previo se toman del mes base. El disco se cobra
            por mes completo incluso con cero horas; la salida se repite cada
            mes y no se acumula entre periodos.
          </p>
          <button disabled={disabled} onClick={reset}>
            Reiniciar con consumo base
          </button>{" "}
          <button onClick={() => onChange(undefined)}>
            Quitar plan mensual
          </button>
          {!rate && <p>Selecciona una tarifa Azure para calcular el plan.</p>}
          {error && <p role="status">{error}</p>}
          <div className="table-wrap">
            <table>
              <caption>Costes por mes de referencia · USD</caption>
              <thead>
                <tr>
                  <th>Mes</th>
                  <th>Instancias</th>
                  <th>Horas / instancia</th>
                  <th>Azure {components ? "cotizado" : "computación"}</th>
                  {quotes.map((q) => (
                    <th key={q.provider}>
                      {q.provider} computación alternativa
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plan.months.map((m, i) => (
                  <tr key={i}>
                    <th>Mes {i + 1}</th>
                    <td>
                      <input
                        type="number"
                        min="1"
                        max="100000"
                        step="1"
                        aria-label={`Mes ${i + 1}: instancias`}
                        value={Number.isNaN(m.instances) ? "" : m.instances}
                        onChange={(e) =>
                          edit(i, "instances", e.currentTarget.valueAsNumber)
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        max="744"
                        step="any"
                        aria-label={`Mes ${i + 1}: horas`}
                        value={Number.isNaN(m.hours) ? "" : m.hours}
                        onChange={(e) =>
                          edit(i, "hours", e.currentTarget.valueAsNumber)
                        }
                      />
                    </td>
                    {["Azure", ...quotes.map((q) => q.provider)].map((p) => (
                      <td key={p}>
                        {result
                          ? money(
                              result.months[i].costs.find(
                                (c) => c.provider === p,
                              )!.monthly,
                            )
                          : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={3}>Total de doce meses</th>
                  {["Azure", ...quotes.map((q) => q.provider)].map((p) => (
                    <td key={p} data-testid={`plan-total-${p}`}>
                      {result
                        ? money(
                            result.totals.find((t) => t.provider === p)!.amount,
                          )
                        : "—"}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          <p>
            El total suma importes exactos antes de redondear; puede diferir de
            la suma de céntimos visibles. Cada alternativa se mantiene separada
            de Azure. Las fuentes, fechas y condiciones son las de las tarifas
            del presupuesto.
          </p>
          <p>
            Guardar y exportar el presupuesto conserva este plan en SQLite, JSON
            y CSV. El resumen y los gráficos siguen mostrando el consumo
            constante del mes base; este plan tiene su propio total. Un plan
            inválido impide guardar o exportar hasta corregirlo o quitarlo.
          </p>
        </>
      )}
    </section>
  );
}
