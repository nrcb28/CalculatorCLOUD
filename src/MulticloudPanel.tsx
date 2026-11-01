import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  AWS_TYPES,
  AWS_REGIONS,
  GCP_REGIONS,
  parseQuote,
  quoteCost,
  type ComputeQuote,
} from "./comparison";
import { errorMessage } from "./errors";
import { money } from "./money";
export default function MulticloudPanel({
  quotes,
  onChange,
  instances,
  hours,
  azure,
  page,
}: {
  quotes: ComputeQuote[];
  onChange: (q: ComputeQuote[]) => void;
  instances: number;
  hours: number;
  azure: string;
  page: string;
}) {
  const [provider, setProvider] = useState<"AWS" | "GCP">("AWS"),
    [instance, setInstance] = useState("m6i.xlarge"),
    [region, setRegion] = useState("eu-west-1"),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const request = useRef(0),
    latest = useRef(quotes);
  latest.current = quotes;
  useEffect(() => {
    request.current++;
    setBusy(false);
    setKey("");
    return () => {
      request.current++;
    };
  }, [page, quotes]);
  async function fetchQuote() {
    const id = ++request.current;
    const apiKey = key;
    setKey("");
    setBusy(true);
    setMessage("");
    try {
      if (!isTauri())
        throw Error("La consulta requiere la aplicación de escritorio");
      const result = parseQuote(
        await invoke("compute_quote", {
          provider,
          instanceType: instance,
          region,
          apiKey: provider === "GCP" ? apiKey : null,
        }),
      );
      if (id !== request.current) return;
      if (
        result.provider !== provider ||
        result.instanceType !== instance ||
        result.region !== region
      )
        throw Error("La cotización no corresponde a la selección solicitada");
      onChange([
        ...latest.current.filter((q) => q.provider !== provider),
        result,
      ]);
      setMessage(
        "Tarifa consultada. Se incluirá al guardar o exportar el presupuesto Azure.",
      );
    } catch (e) {
      if (id === request.current) setMessage(errorMessage(e));
    } finally {
      if (id === request.current) setBusy(false);
    }
  }
  return (
    <section className="comparison">
      <div className="section-title">
        <div>
          <h3>Comparación de computación</h3>
          <p>
            Selección manual de tipos y regiones. Linux, pago por uso, USD; sin
            discos ni red.
          </p>
        </div>
      </div>
      <p>
        Azure: {azure}. Consumo compartido: {instances} instancias × {hours}{" "}
        horas/mes. Igualar vCPU y RAM no garantiza igual rendimiento.
      </p>
      <div className="form">
        <label>
          Proveedor
          <select
            aria-label="Proveedor"
            disabled={busy}
            value={provider}
            onChange={(e) => {
              const p = e.target.value as "AWS" | "GCP";
              setProvider(p);
              setInstance(p === "AWS" ? AWS_TYPES[0] : "n2-standard-4");
              setRegion(p === "AWS" ? AWS_REGIONS[0] : GCP_REGIONS[0]);
              setKey("");
              setMessage("");
            }}
          >
            <option>AWS</option>
            <option>GCP</option>
          </select>
        </label>
        <label>
          Tipo de instancia
          <select
            aria-label="Tipo de instancia"
            disabled={busy}
            value={instance}
            onChange={(e) => setInstance(e.target.value)}
          >
            {(provider === "AWS"
              ? AWS_TYPES
              : [2, 4, 8, 16, 32].map((n) => `n2-standard-${n}`)
            ).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Región efectiva
          <select
            aria-label="Región efectiva"
            disabled={busy}
            value={region}
            onChange={(e) => setRegion(e.target.value)}
          >
            {(provider === "AWS" ? AWS_REGIONS : GCP_REGIONS).map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        {provider === "GCP" && (
          <label>
            Clave API efímera de Cloud Billing
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              disabled={busy}
            />
          </label>
        )}
      </div>
      <p>
        {provider === "AWS"
          ? "EC2 público: descarga regional grande procesada en flujo; puede tardar hasta cuatro minutos. Linux compartido, sin software adicional ni reservas."
          : "Cloud Billing requiere clave API. Se borra del campo al consultar y al salir; no se guarda ni exporta. La verificación en vivo de GCP está pendiente hasta disponer de una clave válida. N2: CPU y memoria bajo demanda, sin descuentos."}
      </p>
      <button
        disabled={busy || (provider === "GCP" && !key.trim())}
        onClick={fetchQuote}
      >
        {busy ? "Consultando catálogo…" : "Consultar computación"}
      </button>
      {message && <p role="status">{message}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Proveedor / tipo</th>
              <th>Región / recursos</th>
              <th>Computación mensual</th>
              <th>Fuente y fecha</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => {
              let monthly = "Consumo inválido";
              try {
                monthly = money(quoteCost(q, instances, hours).monthly);
              } catch {}
              return (
                <tr key={q.provider}>
                  <td>
                    {q.provider}
                    <small>{q.instanceType}</small>
                    <button
                      onClick={() =>
                        onChange(
                          quotes.filter((x) => x.provider !== q.provider),
                        )
                      }
                    >
                      Quitar {q.provider}
                    </button>
                  </td>
                  <td>
                    {q.region}
                    <small>
                      {q.vcpu} vCPU · {q.memoryGiB} GiB
                    </small>
                  </td>
                  <td>
                    {monthly}
                    <small>USD · alternativa, no sumada a Azure</small>
                  </td>
                  <td>
                    <a href={q.source} target="_blank" rel="noreferrer">
                      Catálogo oficial
                    </a>
                    <small>{new Date(q.fetched).toLocaleString("es-ES")}</small>
                    {q.charges.map((c) => (
                      <small key={c.id}>
                        {c.quantity} × {c.unitPriceUSD} USD/{c.unit} · vigente{" "}
                        {c.effective}
                      </small>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!quotes.length && (
        <p>
          Sin cotizaciones alternativas. Cada proveedor conserva su selección y
          su fecha original.
        </p>
      )}
      <p>
        Las cotizaciones históricas pueden estar desactualizadas. Consulta de
        nuevo antes de decidir. Guardar y exportar requiere seleccionar una
        tarifa Azure en la calculadora.
      </p>
    </section>
  );
}
