import ComponentsPanel from "./ComponentsPanel";
import {
  selectComponents,
  computeComponents,
  type Components,
} from "./components";
import React, { lazy, Suspense, useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  LayoutDashboard,
  Calculator,
  ArrowLeftRight,
  FolderOpen,
  Plug,
  Settings,
  Cloud,
  Sun,
  Moon,
  ChevronRight,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Server,
  HardDrive,
  Network,
  ShieldCheck,
  Clock3,
  Info,
  AlertTriangle,
  Check,
  RefreshCw,
  Download,
  Save,
  FileText,
  Upload,
  Copy,
  X,
  Menu,
  ChartNoAxesCombined,
  Search,
} from "lucide-react";
import {
  compute,
  candidates,
  rateKey,
  isStale,
  validate,
  parseSnapshot,
  csv,
  snapshotRows,
  type Config,
  type Rate,
  type Snapshot,
} from "./engine";
import { errorMessage } from "./errors";
import { money } from "./money";
import "./style.css";
const CostCharts = lazy(() => import("./CostCharts"));
const initial: Config = {
  sku: "Standard_D4s_v5",
  region: "westeurope",
  instances: 1,
  hours: 730,
  storage: 100,
  egress: 0,
};
const pages = [
  { name: "Dashboard", icon: LayoutDashboard },
  { name: "Calculadora", icon: Calculator },
  { name: "Comparador", icon: ArrowLeftRight },
  { name: "Presupuestos", icon: FolderOpen },
  { name: "Acceso a proveedores", icon: Plug },
  { name: "Preferencias", icon: Settings },
];
const descriptions: Record<string, string> = {
  Dashboard: "Una visión clara de tus costes de infraestructura.",
  Calculadora: "Construye tu escenario y consulta tarifas desde su fuente.",
  Comparador: "Compara con contexto. Decide con información completa.",
  Presupuestos: "Escenarios guardados, con sus precios y fechas originales.",
  "Acceso a proveedores":
    "Comprueba el acceso a las fuentes oficiales de precios.",
  Preferencias: "Un espacio de trabajo a tu medida.",
};
const dateLabel = (value: string) =>
  Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString("es-ES")
    : "Sin consulta";
function preference(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function download(name: string, data: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function App() {
  const [page, setPage] = useState("Dashboard"),
    [dark, setDark] = useState(
      () => preference("cloudcost.theme", "dark") === "dark",
    ),
    [collapsed, setCollapsed] = useState(false);
  const [config, setConfig] = useState(initial),
    [rates, setRates] = useState<Rate[]>([]),
    [fetched, setFetched] = useState(""),
    [selected, setSelected] = useState("");
  const [components, setComponents] = useState<Components>();
  const [quotingComponents, setQuotingComponents] = useState(false);
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<Snapshot[]>([]),
    [loadingHistory, setLoadingHistory] = useState(false);
  const [ttl, setTtl] = useState(() => {
    const n = Number(preference("cloudcost.ttl", "24"));
    return Number.isInteger(n) && n >= 1 && n <= 720 ? n : 24;
  });
  const [provider, setProvider] = useState("Azure"),
    [apiKey, setApiKey] = useState(""),
    [checking, setChecking] = useState(false),
    [saving, setSaving] = useState(false),
    [now, setNow] = useState(Date.now()),
    [search, setSearch] = useState("");
  const requestId = useRef(0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("cloudcost.theme", dark ? "dark" : "light");
      localStorage.setItem("cloudcost.ttl", String(ttl));
    } catch {
      /* Preferencias opcionales si no hay almacenamiento disponible. */
    }
  }, [dark, ttl]);
  const options = candidates(rates, config, now),
    rate = options.find((r) => rateKey(r) === selected);
  let inputError = "";
  try {
    validate(config);
    if (components) computeComponents(config, components);
  } catch (e) {
    inputError = (e as Error).message;
  }
  const cost = rate && !inputError ? compute(config, rate) : null,
    stale =
      (!!fetched && isStale(fetched, ttl, now)) ||
      (!!components && isStale(components.fetched, ttl, now));
  const summary =
    cost && components
      ? computeComponents(config, components, cost.monthlyExact)
      : cost;
  function changeConfig(next: Config) {
    requestId.current++;
    setBusy(false);
    setQuotingComponents(false);
    if (next.region !== config.region || next.storage !== config.storage)
      setComponents(undefined);
    if (next.sku !== config.sku || next.region !== config.region) {
      setSelected("");
      setRates([]);
      setFetched("");
    }
    setConfig(next);
  }
  async function refresh(forceRefresh = false) {
    const id = ++requestId.current;
    setBusy(true);
    setQuotingComponents(false);
    setMessage("");
    try {
      validate(config);
      if (!isTauri())
        throw Error(
          "Abre la aplicación de escritorio para consultar Azure. La vista del navegador permite revisar la interfaz e importar escenarios.",
        );
      const result = await invoke<{
        rates: Rate[];
        fetched: string;
        cached: boolean;
        warning?: string;
      }>("azure_prices", {
        sku: config.sku,
        region: config.region,
        ttlHours: ttl,
        forceRefresh,
      });
      if (id !== requestId.current) return;
      if (
        !Array.isArray(result.rates) ||
        !Number.isFinite(Date.parse(result.fetched))
      )
        throw Error("Catálogo no válido");
      setRates(result.rates);
      setFetched(result.fetched);
      setSelected("");
      setNow(Date.now());
      const count = candidates(result.rates, config).length;
      setMessage(
        [
          result.warning,
          count
            ? `${count} tarifa(s) compatible(s). Selecciona y revisa una tarifa antes de calcular.`
            : "No hay tarifas compatibles para este SKU y región. Prueba otro SKU o región.",
          result.cached ? "Origen: caché local." : "Origen: Azure.",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (e) {
      if (id === requestId.current) setMessage(errorMessage(e));
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }
  async function quoteComponents() {
    const id = ++requestId.current;
    setBusy(false);
    setQuotingComponents(true);
    setMessage("");
    try {
      validate(config);
      if (!isTauri())
        throw Error(
          "Cotizar discos y red requiere la aplicación de escritorio",
        );
      const raw = await invoke<unknown>("azure_components", {
        region: config.region,
      });
      if (id !== requestId.current) return;
      const next = selectComponents(raw, config);
      computeComponents(config, next);
      setComponents(next);
      setNow(Date.now());
      setMessage(
        "Capacidad Premium SSD LRS y salida MGN cotizadas desde Azure. Revisa las condiciones y los tramos.",
      );
    } catch (e) {
      if (id === requestId.current) setMessage(errorMessage(e));
    } finally {
      if (id === requestId.current) setQuotingComponents(false);
    }
  }
  async function loadHistory() {
    setLoadingHistory(true);
    try {
      if (!isTauri())
        throw Error(
          "El historial SQLite requiere la aplicación de escritorio. Puedes importar un presupuesto JSON para revisarlo aquí.",
        );
      const entries = await invoke<string[]>("list_budgets");
      const valid: Snapshot[] = [];
      let invalid = 0;
      for (const entry of entries) {
        try {
          valid.push(parseSnapshot(JSON.parse(entry)));
        } catch {
          invalid++;
        }
      }
      setHistory(valid);
      if (invalid)
        setMessage(
          `${invalid} presupuesto(s) no válido(s) omitido(s). Los demás siguen disponibles.`,
        );
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setLoadingHistory(false);
    }
  }
  function snapshot(): Snapshot {
    if (!rate || !cost)
      throw Error(
        "Selecciona una tarifa y corrige los consumos antes de exportar",
      );
    return parseSnapshot({
      id: crypto.randomUUID(),
      name: "Presupuesto " + new Date().toLocaleString("es-ES"),
      created: new Date().toISOString(),
      config,
      rates: [rate],
      fetched,
      ...(components === undefined ? {} : { components }),
    });
  }
  async function save() {
    setSaving(true);
    try {
      if (!isTauri())
        throw Error("Guardar en SQLite requiere la aplicación de escritorio");
      const data = snapshot();
      await invoke("save_budget", { id: data.id, data: JSON.stringify(data) });
      setMessage("Presupuesto guardado con una copia de la tarifa y su fecha.");
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  function restore(s: Snapshot) {
    requestId.current++;
    setBusy(false);
    setQuotingComponents(false);
    setComponents(s.components);
    setConfig(s.config);
    setRates(s.rates);
    setFetched(s.fetched);
    setSelected(rateKey(s.rates[0]));
    setNow(Date.now());
    setMessage(
      "Escenario abierto con su tarifa histórica. Una importación JSON no verifica su autenticidad contra Azure.",
    );
    setPage("Calculadora");
  }
  async function checkProvider() {
    setChecking(true);
    setMessage("");
    const key = apiKey;
    setApiKey("");
    try {
      if (!isTauri())
        throw Error(
          "La comprobación de proveedores requiere abrir la aplicación de escritorio",
        );
      const result = await invoke<{ provider: string; message: string }>(
        "check_provider",
        { provider, apiKey: provider === "GCP" ? key : null },
      );
      setMessage(result.provider + ": " + result.message);
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setChecking(false);
    }
  }
  function navigate(next: string) {
    setApiKey("");
    setPage(next);
    setMessage("");
    if (next === "Presupuestos") void loadHistory();
  }
  function exportData(kind: "json" | "csv") {
    try {
      const s = snapshot();
      if (kind === "json")
        download(
          "presupuesto.json",
          JSON.stringify(s, null, 2),
          "application/json",
        );
      else download("costes.csv", csv(snapshotRows(s)), "text/csv");
    } catch (e) {
      setMessage(errorMessage(e));
    }
  }
  const chart = (kind: "projection" | "breakdown" = "projection") =>
    cost ? (
      <Suspense
        fallback={<div className="empty small-empty">Cargando gráfico…</div>}
      >
        <CostCharts monthly={cost.monthlyExact} kind={kind} />
      </Suspense>
    ) : (
      <div className="empty">
        <div className="empty-icon">
          <ChartNoAxesCombined size={28} />
        </div>
        <h3>Tu próxima decisión, con datos</h3>
        <p>
          Selecciona una tarifa oficial para visualizar los costes de tu
          escenario.
        </p>
        <button className="text-button" onClick={() => navigate("Calculadora")}>
          Configurar infraestructura <ArrowRight size={15} />
        </button>
      </div>
    );
  const metrics = (
    <div className="metrics">
      <article className="metric">
        <div className="metric-top">
          <span>
            {components ? "Subtotal cotizado mensual" : "Computación mensual"}
          </span>
          <div className="icon-tile purple">
            <Server size={17} />
          </div>
        </div>
        <h2>
          {summary ? money(summary.monthly) : "—"}
          {summary && <span>/ mes</span>}
        </h2>
        <small>Subtotal en USD · sin impuestos</small>
        <div className="metric-note">
          <span className="dot purple-dot" />
          {summary ? "Tarifa seleccionada" : "Pendiente de una tarifa oficial"}
        </div>
      </article>
      <article className="metric">
        <div className="metric-top">
          <span>
            {components
              ? "Subtotal cotizado anual"
              : "Proyección anual de computación"}
          </span>
          <div className="icon-tile blue">
            <ChartNoAxesCombined size={18} />
          </div>
        </div>
        <h2>
          {summary ? money(summary.annual) : "—"}
          {summary && <span>/ año</span>}
        </h2>
        <small>12 meses con el mismo consumo</small>
        <div className="metric-note">
          <Clock3 size={12} />
          Hipótesis de consumo constante
        </div>
      </article>
      <article className="metric">
        <div className="metric-top">
          <span>Cobertura de la estimación</span>
          <div className="icon-tile amber">
            <ShieldCheck size={18} />
          </div>
        </div>
        <h2 className="coverage-title">
          Parcial <span className="badge amber-badge">Sin ganador</span>
        </h2>
        <small>
          {components
            ? "Computación, capacidad de disco y salida Azure"
            : "Computación Azure; componentes opcionales"}
        </small>
        <div className="metric-note">
          <Info size={12} />
          {components
            ? "Condiciones y exclusiones en la calculadora"
            : "Discos y red pendientes de cotizar"}
        </div>
      </article>
    </div>
  );
  const comparison = (
    <section className="comparison">
      <div className="section-title">
        <div>
          <h3>Comparación de proveedores</h3>
          <p>El mismo escenario, con el alcance de cada fuente a la vista.</p>
        </div>
        <span className="badge">
          <span className="dot amber-dot" />
          Cobertura incompleta
        </span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Proveedor / servicio</th>
              <th>Región efectiva</th>
              <th>Computación / mes</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div className="provider-name">
                  <span className="provider-logo azure">A</span>
                  <div>
                    Microsoft Azure<small>{config.sku}</small>
                  </div>
                </div>
              </td>
              <td>
                {config.region}
                <small>SKU explícito · Linux</small>
              </td>
              <td className="price-cell">
                {cost ? money(cost.monthly) : "—"}
                <small>
                  {cost ? "USD · subtotal" : "Sin tarifa seleccionada"}
                </small>
              </td>
              <td>
                <span className="badge">
                  {cost ? "Parcial" : "Pendiente de consulta"}
                </span>
              </td>
            </tr>
            <tr>
              <td>
                <div className="provider-name">
                  <span className="provider-logo aws">a</span>
                  <div>
                    Amazon Web Services<small>Amazon EC2</small>
                  </div>
                </div>
              </td>
              <td>—</td>
              <td className="price-cell">—</td>
              <td>
                <span className="badge muted-badge">Conector pendiente</span>
              </td>
            </tr>
            <tr>
              <td>
                <div className="provider-name">
                  <span className="provider-logo gcp">G</span>
                  <div>
                    Google Cloud<small>Compute Engine</small>
                  </div>
                </div>
              </td>
              <td>—</td>
              <td className="price-cell">—</td>
              <td>
                <span className="badge muted-badge">Conector pendiente</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="table-note">
        <Info size={15} />
        <span>
          Igualar vCPU y RAM no garantiza igual rendimiento. Faltan precios de
          otros proveedores y servicios: no se puede determinar un ganador.
        </span>
      </div>
    </section>
  );
  return (
    <div
      className={`app ${dark ? "dark" : ""} ${collapsed ? "collapsed" : ""}`}
    >
      <aside>
        <div className="brand">
          <div className="brand-mark">
            <Cloud size={23} />
          </div>
          <div className="brand-text">
            CloudCost<span>COMPARE</span>
          </div>
        </div>
        <div className="workspace">
          <span className="workspace-avatar">P</span>
          <div>
            <strong>Mi espacio de trabajo</strong>
            <small>Planificación de infraestructura</small>
          </div>
        </div>
        <p className="nav-label">ESPACIO DE TRABAJO</p>
        <nav aria-label="Navegación principal">
          {pages.map(({ name, icon: Icon }) => (
            <button
              aria-current={page === name ? "page" : undefined}
              className={page === name ? "active" : ""}
              title={name}
              key={name}
              onClick={() => navigate(name)}
            >
              <Icon size={18} />
              <span>{name}</span>
              {page === name && <span className="active-mark" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="source-note">
            <ShieldCheck size={19} />
            <div>
              Fuentes oficiales
              <small>Precios trazables, sin datos ficticios</small>
            </div>
          </div>
          <div className="sidebar-version">
            <span className="dot purple-dot" />
            <span>Versión inicial</span>
            <span>0.1</span>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            <button
              className="icon-button"
              aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
              onClick={() => setCollapsed(!collapsed)}
            >
              <Menu size={19} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{page}</strong>
          </div>
          <div className="header-actions">
            <span className="desktop-label">
              <span className="dot purple-dot" />
              {isTauri()
                ? "Aplicación de escritorio"
                : "Vista previa de interfaz"}
            </span>
            <button
              className="icon-button"
              aria-label={dark ? "Activar tema claro" : "Activar tema oscuro"}
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <div className="avatar" title="Espacio local">
              LC
            </div>
          </div>
        </header>
        <div className="content">
          <div className="heading">
            <div>
              <div className="eyebrow">PLANIFICACIÓN CLOUD / FINOPS</div>
              <h1>{page}</h1>
              <p>{descriptions[page]}</p>
            </div>
            {page === "Dashboard" ? (
              <button
                className="primary"
                onClick={() => navigate("Calculadora")}
              >
                <Plus size={17} />
                Configurar escenario
              </button>
            ) : page === "Calculadora" ? (
              <button
                className="secondary"
                disabled={!cost || saving}
                onClick={() => void save()}
              >
                <Save size={16} />
                {saving ? "Guardando…" : "Guardar presupuesto"}
              </button>
            ) : null}
          </div>
          {message && (
            <div role="status" className="notice">
              <Info size={18} />
              <span>{message}</span>
              <button
                className="icon-button"
                aria-label="Cerrar aviso"
                onClick={() => setMessage("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {stale && (
            <div role="status" className="notice warning">
              <Clock3 size={18} />
              <span>
                Tarifas obsoletas o fecha de consulta futura. Computación:{" "}
                {dateLabel(fetched)}.
                {components && (
                  <> Discos y salida: {dateLabel(components.fetched)}.</>
                )}{" "}
                Actualiza antes de tomar una decisión.
              </span>
            </div>
          )}
          {(page === "Dashboard" ||
            page === "Calculadora" ||
            page === "Comparador") &&
            metrics}
          {page === "Dashboard" && (
            <>
              <div className="summary-banner">
                <div className="banner-icon">
                  <Cloud size={26} />
                </div>
                <div>
                  <span className="eyebrow">
                    UN ESCENARIO, TODAS SUS HIPÓTESIS
                  </span>
                  <h3>Empieza con una tarifa que puedas verificar.</h3>
                  <p>
                    Consulta Azure, revisa el SKU y construye una estimación
                    transparente.
                  </p>
                </div>
                <button
                  className="text-button"
                  onClick={() => navigate("Calculadora")}
                >
                  Abrir calculadora <ArrowUpRight size={17} />
                </button>
              </div>
              <div className="dashboard-grid">
                <section>
                  <div className="section-title">
                    <div>
                      <h3>Proyección de computación</h3>
                      <p>Coste acumulado en 12 meses</p>
                    </div>
                    <span className="badge">USD</span>
                  </div>
                  {chart()}
                </section>
                <section className="scope-card">
                  <div className="section-title">
                    <div>
                      <h3>Alcance del escenario</h3>
                      <p>Qué se está calculando</p>
                    </div>
                    <span className="badge">Azure</span>
                  </div>
                  <div className="scope-row">
                    <div className="icon-tile purple">
                      <Server size={18} />
                    </div>
                    <div>
                      <strong>Computación</strong>
                      <small>
                        {config.instances} instancia(s) · {config.hours} h/mes
                      </small>
                    </div>
                    <span className={`badge ${cost ? "green-badge" : ""}`}>
                      {cost ? "Calculada" : "Pendiente"}
                    </span>
                  </div>
                  <div className="scope-row">
                    <div className="icon-tile">
                      <HardDrive size={18} />
                    </div>
                    <div>
                      <strong>Almacenamiento</strong>
                      <small>
                        {config.storage} GiB solicitados por instancia
                      </small>
                    </div>
                    <span className="badge">
                      {components ? "Cotizados" : "Sin tarifa"}
                    </span>
                  </div>
                  <div className="scope-row">
                    <div className="icon-tile">
                      <Network size={18} />
                    </div>
                    <div>
                      <strong>Red</strong>
                      <small>{config.egress} GB de salida / mes</small>
                    </div>
                    <span className="badge">
                      {components ? "Cotizados" : "Sin tarifa"}
                    </span>
                  </div>
                  <div className="scope-note">
                    <Info size={16} />
                    <p>
                      El subtotal no representa el coste total de la
                      infraestructura.
                    </p>
                  </div>
                </section>
              </div>
              {comparison}
            </>
          )}
          {page === "Calculadora" && (
            <>
              <div className="calculator-grid">
                <section>
                  <div className="section-title">
                    <div>
                      <h3>Infraestructura</h3>
                      <p>Define los recursos de tu escenario.</p>
                    </div>
                    <div className="icon-tile purple">
                      <Server size={19} />
                    </div>
                  </div>
                  <div className="form-divider">
                    <span>01</span>Máquina virtual
                  </div>
                  <div className="form">
                    <label className="full-width">
                      SKU de Azure
                      <input
                        value={config.sku}
                        maxLength={100}
                        onChange={(e) =>
                          changeConfig({ ...config, sku: e.target.value })
                        }
                      />
                      <small>
                        El SKU determina vCPU y RAM. Verifica sus
                        especificaciones oficiales.
                      </small>
                    </label>
                    <label>
                      Región
                      <select
                        value={config.region}
                        onChange={(e) =>
                          changeConfig({ ...config, region: e.target.value })
                        }
                      >
                        {!["westeurope", "northeurope", "eastus"].includes(
                          config.region,
                        ) && (
                          <option value={config.region}>{config.region}</option>
                        )}
                        <option value="westeurope">Europa occidental</option>
                        <option value="northeurope">Europa del norte</option>
                        <option value="eastus">Este de EE. UU.</option>
                      </select>
                    </label>
                    <label>
                      Sistema operativo
                      <div className="readonly-field">
                        Linux <span className="badge">Pago por uso</span>
                      </div>
                    </label>
                    {(["instances", "hours"] as const).map((k, i) => (
                      <label key={k}>
                        {["Instancias", "Horas / mes"][i]}
                        <input
                          type="number"
                          min={k === "instances" ? 1 : 0}
                          step={k === "instances" ? 1 : "any"}
                          max={k === "hours" ? 744 : 100000}
                          value={Number.isFinite(config[k]) ? config[k] : ""}
                          aria-invalid={!!inputError}
                          onChange={(e) =>
                            changeConfig({
                              ...config,
                              [k]:
                                e.target.value === ""
                                  ? NaN
                                  : Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <div className="form-divider">
                    <span>02</span>Necesidades adicionales{" "}
                    <span className="form-caption">
                      Cotización adicional opcional
                    </span>
                  </div>
                  <div className="form">
                    {(["storage", "egress"] as const).map((k, i) => (
                      <label key={k}>
                        {
                          [
                            "Disco por instancia (GiB)",
                            "Salida a Internet (GB / mes)",
                          ][i]
                        }
                        <input
                          type="number"
                          min="0"
                          max="1000000000"
                          step="any"
                          value={Number.isFinite(config[k]) ? config[k] : ""}
                          aria-invalid={!!inputError}
                          onChange={(e) =>
                            changeConfig({
                              ...config,
                              [k]:
                                e.target.value === ""
                                  ? NaN
                                  : Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  {inputError && (
                    <div role="alert" className="field-error">
                      <AlertTriangle size={16} />
                      {inputError}
                    </div>
                  )}
                  <div className="form-footer">
                    <span>
                      <ShieldCheck size={14} />
                      Azure Retail Prices API
                    </span>
                    <div className="actions">
                      <button
                        disabled={busy || !!inputError}
                        onClick={() => void refresh(true)}
                      >
                        Actualizar desde Azure
                      </button>
                      <button
                        className="primary"
                        disabled={busy || !!inputError}
                        onClick={() => void refresh()}
                      >
                        <RefreshCw size={16} className={busy ? "spin" : ""} />
                        {busy ? "Consultando…" : "Consultar tarifas"}
                      </button>
                    </div>
                  </div>
                </section>
                <section>
                  <div className="section-title">
                    <div>
                      <h3>Tu estimación</h3>
                      <p>Computación · Linux · pago por uso</p>
                    </div>
                    <span className="badge">USD</span>
                  </div>
                  {chart()}
                  <div className="estimate-facts">
                    <div>
                      <span>Instancias</span>
                      <strong>
                        {Number.isFinite(config.instances)
                          ? config.instances
                          : "—"}
                      </strong>
                    </div>
                    <div>
                      <span>Horas al mes</span>
                      <strong>
                        {Number.isFinite(config.hours) ? config.hours : "—"}
                      </strong>
                    </div>
                    <div>
                      <span>Región</span>
                      <strong>{config.region}</strong>
                    </div>
                  </div>
                  <div className="scope-note">
                    <Info size={16} />
                    <p>
                      Gráficos y proyecciones de computación. El subtotal con
                      discos y salida se muestra en su cotización adicional. Sin
                      licencias adicionales, soporte ni impuestos.
                    </p>
                  </div>
                </section>
              </div>
              <ComponentsPanel
                config={config}
                components={components}
                computeMonthly={cost?.monthlyExact}
                busy={quotingComponents}
                quoteDisabled={!!inputError}
                onQuote={() => void quoteComponents()}
                onRemove={() => {
                  requestId.current++;
                  setBusy(false);
                  setComponents(undefined);
                  setQuotingComponents(false);
                }}
                onUsedChange={(amount) =>
                  changeConfig({ ...config, egressUsedGB: amount })
                }
              />
              <section>
                <div className="section-title">
                  <div>
                    <h3>Tarifas y trazabilidad</h3>
                    <p>
                      Revisa el producto exacto antes de utilizar su precio.
                    </p>
                  </div>
                  <span className="badge">{options.length} candidatas</span>
                </div>
                {options.length ? (
                  <>
                    <label>
                      Producto / SKU / precio por hora
                      <select
                        value={selected}
                        onChange={(e) => setSelected(e.target.value)}
                      >
                        <option value="">Selecciona una tarifa</option>
                        {options.map((r) => (
                          <option key={rateKey(r)} value={rateKey(r)}>
                            {r.productName} / {r.skuName} / {r.retailPrice} USD
                            · {r.effectiveStartDate}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="source-details">
                      <div>
                        <span>Fuente</span>
                        <strong>Azure Retail Prices API</strong>
                      </div>
                      <div>
                        <span>Consultada</span>
                        <strong>{dateLabel(fetched)}</strong>
                      </div>
                      <div>
                        <span>Vigente desde</span>
                        <strong>
                          {rate
                            ? dateLabel(rate.effectiveStartDate)
                            : "Selecciona una tarifa"}
                        </strong>
                      </div>
                    </div>
                    {cost && (
                      <>
                        <div className="estimate-facts">
                          <div>
                            <span>Por hora de ejecución</span>
                            <strong>{money(cost.hourly, 6)}</strong>
                          </div>
                          <div>
                            <span>Media diaria (mes de 30 días)</span>
                            <strong>{money(cost.daily)}</strong>
                          </div>
                          <div>
                            <span>Proyección anual</span>
                            <strong>{money(cost.annual)}</strong>
                          </div>
                        </div>
                        <div className="actions">
                          <button onClick={() => exportData("json")}>
                            <Download size={15} />
                            JSON
                          </button>
                          <button onClick={() => exportData("csv")}>
                            <Download size={15} />
                            CSV
                          </button>
                          <button onClick={() => window.print()}>
                            <FileText size={15} />
                            Imprimir / PDF
                          </button>
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <div className="inline-empty">
                    <Search size={24} />
                    <div>
                      <h3>
                        {fetched
                          ? "Sin tarifas compatibles"
                          : "Todavía no hay tarifas consultadas"}
                      </h3>
                      <p>
                        {fetched
                          ? "Prueba otro SKU o región. No se usan precios ficticios ni se sustituyen productos automáticamente."
                          : "Configura la infraestructura y consulta Azure para ver los productos disponibles."}
                      </p>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
          {page === "Comparador" && (
            <>
              {comparison}
              <div className="summary-banner">
                <div className="banner-icon">
                  <ArrowLeftRight size={25} />
                </div>
                <div>
                  <h3>Comparar exige más que un precio por hora.</h3>
                  <p>
                    Los conectores de AWS y GCP, la equivalencia técnica y los
                    costes completos siguen pendientes.
                  </p>
                </div>
                <button
                  className="text-button"
                  onClick={() => navigate("Acceso a proveedores")}
                >
                  Ver proveedores <ArrowRight size={16} />
                </button>
              </div>
              {cost && (
                <section>
                  <div className="section-title">
                    <div>
                      <h3>Desglose disponible</h3>
                      <p>
                        Gráfico de computación Azure. Los discos y la salida se
                        detallan en la calculadora.
                      </p>
                    </div>
                  </div>
                  {chart("breakdown")}
                </section>
              )}
            </>
          )}
          {page === "Presupuestos" && (
            <section>
              <div className="section-title">
                <div>
                  <h3>Biblioteca de escenarios</h3>
                  <p>
                    Reabre un escenario y guárdalo de nuevo para duplicarlo.
                  </p>
                </div>
                <label className="file-button">
                  <Upload size={16} />
                  Importar JSON
                  <input
                    type="file"
                    accept=".json"
                    aria-label="Importar presupuesto JSON"
                    onChange={async (e) => {
                      const input = e.currentTarget;
                      try {
                        const file = input.files?.[0];
                        if (file) {
                          if (file.size > 5000000)
                            throw Error(
                              "Archivo demasiado grande (máximo 5 MB)",
                            );
                          restore(parseSnapshot(JSON.parse(await file.text())));
                        }
                      } catch (e) {
                        setMessage(errorMessage(e));
                      } finally {
                        input.value = "";
                      }
                    }}
                  />
                </label>
              </div>
              {loadingHistory ? (
                <div className="empty">
                  <RefreshCw className="spin" />
                  <p>Cargando presupuestos…</p>
                </div>
              ) : history.length ? (
                history
                  .filter((s) =>
                    s.name
                      .toLocaleLowerCase()
                      .includes(search.toLocaleLowerCase()),
                  )
                  .map((s) => (
                    <div className="history" key={s.id}>
                      <div className="icon-tile purple">
                        <FileText size={18} />
                      </div>
                      <div>
                        <strong>{s.name}</strong>
                        <small>
                          {dateLabel(s.created)} · {s.config.region}
                        </small>
                      </div>
                      <button onClick={() => restore(s)}>
                        <Copy size={15} />
                        Abrir escenario
                      </button>
                    </div>
                  ))
              ) : (
                <div className="empty">
                  <div className="empty-icon">
                    <FolderOpen size={28} />
                  </div>
                  <h3>Tu próximo escenario empieza aquí</h3>
                  <p>
                    Guarda una estimación desde la calculadora o importa un
                    presupuesto JSON.
                  </p>
                  <button
                    className="secondary"
                    onClick={() => navigate("Calculadora")}
                  >
                    <Plus size={16} />
                    Crear escenario
                  </button>
                </div>
              )}
              {!!history.length && (
                <label className="history-search">
                  Buscar presupuesto
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Nombre del escenario"
                  />
                </label>
              )}
            </section>
          )}
          {page === "Acceso a proveedores" && (
            <div className="provider-grid">
              {["Azure", "AWS", "GCP"].map((name, i) => (
                <button
                  key={name}
                  className={`provider-card ${provider === name ? "selected" : ""}`}
                  disabled={checking}
                  aria-pressed={provider === name}
                  onClick={() => {
                    setProvider(name);
                    setApiKey("");
                    setMessage("");
                  }}
                >
                  <span
                    className={`provider-logo ${["azure", "aws", "gcp"][i]}`}
                  >
                    {["A", "a", "G"][i]}
                  </span>
                  <strong>
                    {
                      [
                        "Microsoft Azure",
                        "Amazon Web Services",
                        "Google Cloud",
                      ][i]
                    }
                  </strong>
                  <small>
                    {i === 2
                      ? "API key · prueba puntual"
                      : "Acceso público · sin login"}
                  </small>
                  {provider === name && (
                    <Check size={17} className="provider-check" />
                  )}
                </button>
              ))}
              <section className="provider-setup">
                <div className="section-title">
                  <div>
                    <h3>Conectar con {provider}</h3>
                    <p>Comprueba que el catálogo oficial es accesible.</p>
                  </div>
                  <span className="badge">
                    {provider === "GCP" ? "API key" : "Sin credenciales"}
                  </span>
                </div>
                {provider === "Azure" && (
                  <p>
                    Azure Retail Prices API permite consultar tarifas públicas
                    sin iniciar sesión. Comprueba el acceso y utiliza la
                    calculadora para obtener precios por SKU y región.
                  </p>
                )}
                {provider === "AWS" && (
                  <p>
                    El índice de AWS Price List Bulk es público. Esta
                    comprobación verifica el catálogo oficial; las estimaciones
                    EC2 aún no están implementadas. La API Query requerirá
                    permisos IAM cuando se integre.
                  </p>
                )}
                {provider === "GCP" && (
                  <>
                    <p>
                      Habilita Cloud Billing API en un proyecto de Google Cloud
                      y utiliza una API key restringida a esta API. Se comprueba
                      el catálogo de servicios; el cálculo de precios de GCP
                      está pendiente.
                    </p>
                    <label>
                      API key de Google Cloud
                      <input
                        type="password"
                        disabled={checking}
                        autoComplete="off"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="Introduce tu API key para esta comprobación"
                      />
                    </label>
                    <div className="security-note">
                      <ShieldCheck size={16} />
                      Se usa solo en esta petición. No se guarda en disco ni se
                      conserva en el formulario.
                    </div>
                  </>
                )}
                <div className="actions">
                  <button
                    className="primary"
                    disabled={checking || (provider === "GCP" && !apiKey)}
                    onClick={() => void checkProvider()}
                  >
                    <RefreshCw size={16} className={checking ? "spin" : ""} />
                    {checking ? "Comprobando…" : "Comprobar acceso"}
                  </button>
                  {provider === "Azure" && (
                    <button onClick={() => navigate("Calculadora")}>
                      Abrir calculadora <ArrowUpRight size={16} />
                    </button>
                  )}
                </div>
                <div className="scope-note">
                  <Info size={16} />
                  <p>
                    Un login no corrige un bloqueo del proxy o firewall. La
                    prueba de acceso tampoco confirma una estimación completa.
                  </p>
                </div>
              </section>
            </div>
          )}
          {page === "Preferencias" && (
            <section className="settings">
              <div className="section-title">
                <div>
                  <h3>Preferencias de la aplicación</h3>
                  <p>Se guardan localmente en este dispositivo.</p>
                </div>
                <Settings size={20} />
              </div>
              <div className="settings-row">
                <div>
                  <strong>Apariencia</strong>
                  <p>Elige el tema de tu espacio de trabajo.</p>
                </div>
                <div className="segmented">
                  <button aria-pressed={!dark} onClick={() => setDark(false)}>
                    <Sun size={15} />
                    Claro
                  </button>
                  <button aria-pressed={dark} onClick={() => setDark(true)}>
                    <Moon size={15} />
                    Oscuro
                  </button>
                </div>
              </div>
              <div className="settings-row">
                <div>
                  <strong>Caducidad de las tarifas</strong>
                  <p>
                    Las tarifas guardadas se señalan como obsoletas al vencer
                    este plazo.
                  </p>
                </div>
                <label>
                  Horas de caché
                  <input
                    type="number"
                    min="1"
                    max="720"
                    step="1"
                    value={ttl}
                    onChange={(e) =>
                      setTtl(
                        Math.max(
                          1,
                          Math.min(
                            720,
                            Math.trunc(Number(e.target.value)) || 24,
                          ),
                        ),
                      )
                    }
                  />
                </label>
              </div>
              <div className="settings-row">
                <div>
                  <strong>Moneda</strong>
                  <p>
                    La conversión a EUR requiere una fuente verificable de
                    cambio.
                  </p>
                </div>
                <span className="badge">USD · moneda original</span>
              </div>
              <div className="settings-row">
                <div>
                  <strong>Idioma</strong>
                  <p>La traducción al inglés está pendiente.</p>
                </div>
                <span className="badge">Español</span>
              </div>
            </section>
          )}
          <footer>
            <span>
              <ShieldCheck size={13} />
              Estimaciones transparentes · importes sin impuestos
            </span>
            <span>
              CloudCost Compare <span className="footer-version">v0.1</span>
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
