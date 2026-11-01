import { useEffect, useRef, useState } from "react";
import { csv, parseSnapshot, snapshotRows, type Snapshot } from "./engine";
import { compareSnapshots, historyRows } from "./history";
import { money } from "./money";
import { errorMessage } from "./errors";
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const labels = {
  sku: "SKU",
  region: "Región",
  instances: "Instancias",
  hours: "Horas/mes",
  storage: "Disco GiB/instancia",
  egress: "Salida GB/mes",
  egressUsedGB: "Salida previa GB/mes",
};
export default function HistoryPanel({ history }: { history: Snapshot[] }) {
  const [base, setBase] = useState<Snapshot>(),
    [target, setTarget] = useState<Snapshot>(),
    [message, setMessage] = useState("");
  const requests = useRef({ base: 0, target: 0 });
  useEffect(
    () => () => {
      requests.current.base++;
      requests.current.target++;
    },
    [],
  );
  const report = base && target ? compareSnapshots(base, target) : undefined;
  async function importFile(side: "base" | "target", file: File) {
    const id = ++requests.current[side];
    try {
      if (file.size > 5000000)
        throw Error("Archivo demasiado grande (máximo 5 MB)");
      const value = parseSnapshot(JSON.parse(await file.text()));
      if (id !== requests.current[side]) return;
      (side === "base" ? setBase : setTarget)(value);
      setMessage("");
    } catch (e) {
      if (id === requests.current[side]) setMessage(errorMessage(e));
    }
  }
  return (
    <section className="history-comparison" data-testid="historical-comparison">
      <div className="section-title">
        <div>
          <h3>Comparación histórica</h3>
          <p>
            Dos copias de precios y consumos, sin volver a consultar los
            catálogos.
          </p>
        </div>
      </div>
      <div className="form">
        {(["base", "target"] as const).map((side) => {
          const current = side === "base" ? base : target,
            name = side === "base" ? "Base" : "Objetivo",
            index = current ? history.indexOf(current) : -1;
          return (
            <div key={side}>
              <label>
                {name}: presupuesto guardado
                <select
                  aria-label={`${name}: presupuesto guardado`}
                  value={
                    current ? (index >= 0 ? `saved-${index}` : "copy") : ""
                  }
                  onChange={(e) => {
                    requests.current[side]++;
                    (side === "base" ? setBase : setTarget)(
                      e.target.value.startsWith("saved-")
                        ? history[Number(e.target.value.slice(6))]
                        : undefined,
                    );
                    setMessage("");
                  }}
                >
                  <option value="">Seleccionar o importar JSON</option>
                  {current && index < 0 && (
                    <option value="copy">
                      Copia seleccionada: {current.name}
                    </option>
                  )}
                  {history.map((s, i) => (
                    <option key={s.id} value={`saved-${i}`}>
                      {s.name} · {new Date(s.created).toLocaleString("es-ES")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="file-button">
                {name}: importar presupuesto JSON
                <input
                  type="file"
                  accept=".json"
                  aria-label={`${name}: importar presupuesto JSON`}
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    if (file) void importFile(side, file);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
              {current && (
                <>
                  <p>
                    <strong>{current.name}</strong>
                    <br />
                    Guardado:{" "}
                    {new Date(current.created).toLocaleString("es-ES")}
                    <br />
                    Consulta Azure:{" "}
                    {new Date(current.fetched).toLocaleString("es-ES")}
                    {current.components && (
                      <>
                        <br />
                        Consulta discos/red:{" "}
                        {new Date(current.components.fetched).toLocaleString(
                          "es-ES",
                        )}
                      </>
                    )}
                    {current.comparisonQuotes?.map((q) => (
                      <span key={q.provider}>
                        <br />
                        {q.provider}: {q.instanceType} · {q.region} · {q.vcpu}{" "}
                        vCPU / {q.memoryGiB} GiB · consulta{" "}
                        {new Date(q.fetched).toLocaleString("es-ES")}
                      </span>
                    ))}
                  </p>
                  <details>
                    <summary>
                      Tarifas y condiciones de {name.toLowerCase()}
                    </summary>
                    {snapshotRows(current)
                      .slice(1)
                      .map((row, i) => (
                        <p key={i}>
                          <strong>
                            {row[0]} · {row[1]}
                          </strong>
                          <br />
                          {row[2]} · {row[3]}
                          <br />
                          <a href={row[6]} target="_blank" rel="noreferrer">
                            Fuente oficial
                          </a>{" "}
                          · consulta {row[7]} · vigencia{" "}
                          {row[8] || "ver cargos"}
                          <br />
                          {row[9]}
                        </p>
                      ))}
                  </details>
                </>
              )}
            </div>
          );
        })}
      </div>
      {message && <p role="status">{message}</p>}
      {!report ? (
        <p>
          Selecciona o importa dos presupuestos. Las importaciones de esta
          sección no sustituyen la calculadora ni guardan datos en SQLite.
        </p>
      ) : (
        <>
          <p>
            Variación = objetivo − base. Se usa el consumo de cada escenario. La
            variación se calcula antes de redondear a céntimos. Una diferencia
            no demuestra ahorro ni un cambio de precio del proveedor; las
            configuraciones y fechas pueden ser distintas.
          </p>
          {(report.baseline.usagePlan || report.target.usagePlan) && (
            <p role="status">
              Hay un plan mensual conservado. Las variaciones de esta tabla
              comparan el mes base, no los totales de los planes. Sus doce meses
              se incluyen en el CSV y JSON.
            </p>
          )}
          {report.coverageChanged && (
            <p role="status">
              <strong>Cambio de cobertura:</strong> un escenario incluye
              discos/red y el otro no. Solo se compara su computación Azure;
              falta una cotización para comparar subtotales.
            </p>
          )}
          <div className="table-wrap">
            <table>
              <caption>Configuración original de cada escenario</caption>
              <thead>
                <tr>
                  <th>Parámetro</th>
                  <th>Base</th>
                  <th>Objetivo</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(labels).map(([k, label]) => (
                  <tr key={k}>
                    <th>
                      {label}
                      {report.changed.includes(k as keyof typeof labels)
                        ? " · cambió"
                        : ""}
                    </th>
                    <td>
                      {report.baseline.config[k as keyof typeof labels] ?? 0}
                    </td>
                    <td>
                      {report.target.config[k as keyof typeof labels] ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-wrap">
            <table>
              <caption>Variación del coste mensual en USD</caption>
              <thead>
                <tr>
                  <th>Alcance</th>
                  <th>Base</th>
                  <th>Objetivo</th>
                  <th>Diferencia mensual</th>
                  <th>Variación</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.component}>
                    <th>{row.component}</th>
                    <td>{money(row.base)}</td>
                    <td>{money(row.target)}</td>
                    <td>{money(row.monthly)}</td>
                    <td>
                      {row.percent === null
                        ? "No definida: base cero"
                        : `${row.percent.replace(".", ",")}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Las alternativas AWS/GCP solo se comparan si constan en ambos
            presupuestos y no se suman a Azure. Las fuentes, fechas de vigencia
            y condiciones originales se conservan en los informes.
          </p>
          <button
            onClick={() =>
              download(
                "comparacion-historica.json",
                JSON.stringify(
                  { ...report, exportedAt: new Date().toISOString() },
                  null,
                  2,
                ),
                "application/json",
              )
            }
          >
            Exportar comparación JSON
          </button>{" "}
          <button
            onClick={() =>
              download(
                "comparacion-historica.csv",
                csv(historyRows(report.baseline, report.target)),
                "text/csv;charset=utf-8",
              )
            }
          >
            Exportar comparación CSV
          </button>
        </>
      )}
      <p>
        Solo USD. Anualización: doce meses con el mismo consumo. Importar valida
        la estructura, no la autenticidad de la tarifa. No se infiere
        equivalencia de hardware o regiones.
      </p>
    </section>
  );
}
