import {
  computeComponents,
  diskSize,
  DISK_SPEC_SOURCE,
  NETWORK_SPEC_SOURCE,
  type Components,
} from "./components";
import type { Config } from "./engine";
import { money } from "./money";
export default function ComponentsPanel({
  config,
  components,
  computeMonthly,
  busy,
  onQuote,
  onRemove,
  onUsedChange,
}: {
  config: Config;
  components?: Components;
  computeMonthly?: string;
  busy: boolean;
  onQuote: () => void;
  onRemove: () => void;
  onUsedChange: (amount: number) => void;
}) {
  let error = "",
    result: ReturnType<typeof computeComponents> | undefined;
  let size: ReturnType<typeof diskSize> | undefined;
  try {
    size = diskSize(config.storage);
    if (components)
      result = computeComponents(config, components, computeMonthly);
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <section aria-label="Cotización de discos y red">
      <div className="section-title">
        <div>
          <h3>Discos y salida a Internet</h3>
          <p>Premium SSD · LRS · red Microsoft (MGN) · USD</p>
        </div>
      </div>
      <p>
        Un disco por instancia durante un mes de referencia. No se prorratea con
        las horas de la VM.
        {size
          ? ` Para ${config.storage} GiB se provisiona ${size[0]} de ${size[1]} GiB.`
          : " Cero GiB: sin disco cotizado."}{" "}
        Comprueba que la VM admite Premium SSD. No incluye operaciones de
        bursting, snapshots, discos adicionales, IP, NAT ni transferencias entre
        zonas/regiones.
      </p>
      <div className="form">
        <label>
          Salida previa de la cuenta (GB / mes)
          <input
            type="number"
            min="0"
            max="1000000000"
            step="any"
            value={
              Number.isFinite(config.egressUsedGB ?? 0)
                ? (config.egressUsedGB ?? 0)
                : ""
            }
            onChange={(e) =>
              onUsedChange(e.target.value === "" ? NaN : Number(e.target.value))
            }
          />
          <small>
            Tráfico ya consumido por otros recursos. Cero supone que este
            escenario dispone de toda la franquicia de la cuenta.
          </small>
        </label>
      </div>
      <div className="actions">
        <button
          onClick={onQuote}
          disabled={busy || (!size && config.storage !== 0)}
        >
          {busy ? "Cotizando componentes…" : "Cotizar discos y red"}
        </button>
        {components && (
          <button onClick={onRemove} disabled={busy}>
            Quitar cotización adicional
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {result && (
        <>
          <div className="estimate-facts">
            <div>
              <span>Capacidad de discos / mes</span>
              <strong>{money(result.disk)}</strong>
              <small>
                {config.instances} × {result.diskSizeGiB} GiB · mes de referencia
              </small>
            </div>
            <div>
              <span>Salida incremental / mes</span>
              <strong>{money(result.network)}</strong>
              <small>
                {config.egress} GB sobre {config.egressUsedGB ?? 0} GB previos
              </small>
            </div>
            <div>
              <span>
                {computeMonthly === undefined
                  ? "Discos + salida / mes"
                  : "Computación + discos + salida / mes"}
              </span>
              <strong data-testid="components-total">
                {money(result.monthly)}
              </strong>
              <small>Subtotal de los recursos cotizados · sin impuestos</small>
              <small>
                Anual: {money(result.annual)} con idéntico consumo y uso previo
                cada mes
              </small>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tramo GB de la cuenta</th>
                  <th>GB del escenario</th>
                  <th>USD / GB</th>
                  <th>USD</th>
                </tr>
              </thead>
              <tbody>
                {result.bands.map((b) => (
                  <tr key={b.from}>
                    <td>
                      {b.from}–{b.to}
                    </td>
                    <td>{b.quantity}</td>
                    <td>{b.price}</td>
                    <td>{money(b.cost)}</td>
                  </tr>
                ))}
                {!result.bands.length && (
                  <tr>
                    <td colSpan={4}>Sin tráfico de salida solicitado</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p>
            Fuente: {components!.source} · Consulta:{" "}
            {new Date(components!.fetched).toLocaleString("es-ES")}.
          </p>
          <p>
            Medidor de disco: {components!.disk?.meterId ?? "No solicitado"}.
            Medidor de red: {components!.network[0].meterId}.
          </p>
        </>
      )}
      {!components && (
        <p>
          Discos y red sin cotizar. Los importes de computación y sus gráficos
          permanecen separados.
        </p>
      )}
      <small>
        Estimación según tramos API hasta 500.000 GB acumulados. Sus límites
        difieren de la tabla web de Azure; comprueba las condiciones antes de
        contratar. Tamaños:{" "}
        <a href={DISK_SPEC_SOURCE} target="_blank" rel="noreferrer">
          especificaciones oficiales
        </a>
        .{" "}
        <a href={NETWORK_SPEC_SOURCE} target="_blank" rel="noreferrer">
          Tarifas y condiciones de red
        </a>
        .
      </small>
    </section>
  );
}
