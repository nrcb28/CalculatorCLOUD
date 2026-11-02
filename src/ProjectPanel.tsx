import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  parseProject,
  projectCost,
  projectRows,
  type Project,
  type ProjectResource,
} from "./project";
import { csv, parseSnapshot, type Snapshot } from "./engine";
import { money } from "./money";
import { errorMessage } from "./errors";
export function newProject(): Project {
  return {
    model: "resource-project-v1",
    id: crypto.randomUUID(),
    name: "Nuevo proyecto",
    created: new Date().toISOString(),
    resources: [],
  };
}
function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function ProjectPanel({
  project,
  onChange,
  getCurrent,
  onRestore,
}: {
  project: Project;
  onChange: (p: Project) => void;
  getCurrent: () => Snapshot;
  onRestore: (s: Snapshot) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]),
    [budgets, setBudgets] = useState<Snapshot[]>([]),
    [selected, setSelected] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    request.current++;
    setBusy(false);
    return () => {
      request.current++;
    };
  }, [project]);
  useEffect(() => {
    let active = true;
    if (isTauri())
      void Promise.allSettled([
        invoke<string[]>("list_projects"),
        invoke<string[]>("list_budgets"),
      ]).then(([a, b]) => {
        if (!active) return;
        let omitted = 0;
        if (a.status === "fulfilled")
          setProjects(
            a.value.flatMap((raw) => {
              try {
                return [parseProject(JSON.parse(raw))];
              } catch {
                omitted++;
                return [];
              }
            }),
          );
        if (b.status === "fulfilled")
          setBudgets(
            b.value.flatMap((raw) => {
              try {
                return [parseSnapshot(JSON.parse(raw))];
              } catch {
                omitted++;
                return [];
              }
            }),
          );
        if (a.status === "rejected" || b.status === "rejected")
          setMessage(
            "No se pudo leer parte de la biblioteca. El proyecto activo sigue disponible.",
          );
        else if (omitted)
          setMessage(
            `${omitted} entradas no válidas omitidas de la biblioteca.`,
          );
      });
    return () => {
      active = false;
    };
  }, []);
  let result: ReturnType<typeof projectCost> | undefined,
    error = "";
  try {
    result = projectCost(project);
  } catch (e) {
    error = errorMessage(e);
  }
  function add(snapshot: Snapshot) {
    if (project.resources.length >= 40) {
      setMessage("Máximo 40 recursos");
      return;
    }
    onChange({
      ...project,
      resources: [
        ...project.resources,
        {
          id: crypto.randomUUID(),
          name: snapshot.name,
          provider: "Azure",
          snapshot,
        },
      ],
    });
    setMessage("");
  }
  function update(id: string, patch: Partial<ProjectResource>) {
    onChange({
      ...project,
      resources: project.resources.map((r) =>
        r.id === id ? { ...r, ...patch } : r,
      ),
    });
  }
  async function file(kind: "project" | "snapshot", file: File) {
    const id = ++request.current;
    try {
      if (file.size > (kind === "project" ? 10000000 : 5000000))
        throw Error("Archivo demasiado grande");
      const value = JSON.parse(await file.text());
      if (id !== request.current) return;
      if (kind === "project") onChange(parseProject(value));
      else add(parseSnapshot(value));
      setMessage("");
    } catch (e) {
      if (id === request.current) setMessage(errorMessage(e));
    }
  }
  async function action(kind: "save" | "pdf") {
    const id = ++request.current;
    setBusy(true);
    setMessage("");
    try {
      if (!isTauri())
        throw Error(
          "Guardar y generar PDF requiere la aplicación de escritorio",
        );
      const p = parseProject(project);
      const data = JSON.stringify(p);
      if (kind === "save") {
        await invoke("save_project", { data });
        if (id !== request.current) return;
        setProjects([p, ...projects.filter((old) => old.id !== p.id)]);
        setMessage("Proyecto guardado con las copias y proveedores elegidos.");
      } else {
        const expected = projectCost(p);
        const pdf = await invoke<{
          saved: boolean;
          pages: number;
          monthly: string;
          total: string;
        }>("save_project_pdf", {
          data,
          expectedMonthly: expected.monthly,
          expectedTotal: expected.periodTotal,
        });
        if (id !== request.current) return;
        if (
          pdf.monthly !== expected.monthly ||
          pdf.total !== expected.periodTotal
        )
          throw Error("El PDF no coincide con los totales del proyecto");
        setMessage(
          pdf.saved
            ? `PDF guardado: ${pdf.pages} páginas, con fuentes y gráficos.`
            : "Exportación PDF cancelada. El proyecto no ha cambiado.",
        );
      }
    } catch (e) {
      if (id === request.current) setMessage(errorMessage(e));
    } finally {
      if (id === request.current) setBusy(false);
    }
  }
  return (
    <>
      <section className="project-panel">
        <div className="section-title">
          <div>
            <h3>Proyecto de recursos</h3>
            <p>
              Entre 1 y 40 recursos, cada uno con su proveedor, copia de precios
              y plan opcional.
            </p>
          </div>
          <button
            onClick={() => {
              onChange(newProject());
              setMessage("");
            }}
          >
            Nuevo proyecto
          </button>
        </div>
        <label>
          Nombre del proyecto
          <input
            aria-label="Nombre del proyecto"
            maxLength={200}
            value={project.name}
            onChange={(e) => onChange({ ...project, name: e.target.value })}
          />
        </label>
        <p>
          El borrador permanece al navegar entre páginas. Guarda para
          conservarlo al cerrar la aplicación. Las ediciones posteriores a
          guardar requieren volver a guardar.
        </p>
        <div className="project-actions">
          <button
            onClick={() => {
              try {
                add(getCurrent());
              } catch (e) {
                setMessage(errorMessage(e));
              }
            }}
          >
            Añadir escenario de la calculadora
          </button>
          <label className="file-button">
            Añadir presupuesto JSON
            <input
              type="file"
              accept=".json"
              aria-label="Añadir presupuesto JSON al proyecto"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) void file("snapshot", f);
                e.currentTarget.value = "";
              }}
            />
          </label>
          <label className="file-button">
            Importar proyecto JSON
            <input
              type="file"
              accept=".json"
              aria-label="Importar proyecto JSON"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) void file("project", f);
                e.currentTarget.value = "";
              }}
            />
          </label>
        </div>
        {!!budgets.length && (
          <div className="form">
            <label>
              Presupuesto guardado
              <select
                aria-label="Presupuesto para añadir"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">Seleccionar</option>
                {budgets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={!selected}
              onClick={() => {
                const s = budgets.find((s) => s.id === selected);
                if (s) add(s);
              }}
            >
              Añadir presupuesto guardado
            </button>
          </div>
        )}
        {message && <p role="status">{message}</p>}
        {project.resources.length > 0 && error && <p role="alert">{error}</p>}
        {!project.resources.length ? (
          <p>Añade un presupuesto o el escenario actual para comenzar.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <caption>Recursos y cargos elegidos · USD</caption>
              <thead>
                <tr>
                  <th>Recurso / proveedor</th>
                  <th>SKU / región / cobertura</th>
                  <th>Mes base</th>
                  <th>Doce meses</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {project.resources.map((r, i) => {
                  const cost = result?.resources.find((c) => c.id === r.id);
                  return (
                    <tr key={r.id} data-testid="project-resource">
                      <td>
                        <label>
                          Nombre
                          <input
                            aria-label={`Nombre del recurso ${i + 1}`}
                            value={r.name}
                            maxLength={200}
                            onChange={(e) =>
                              update(r.id, { name: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          Proveedor elegido
                          <select
                            aria-label={`Proveedor del recurso ${i + 1}`}
                            value={r.provider}
                            onChange={(e) =>
                              update(r.id, {
                                provider: e.target
                                  .value as ProjectResource["provider"],
                              })
                            }
                          >
                            {[
                              "Azure",
                              ...(r.snapshot.comparisonQuotes ?? []).map(
                                (q) => q.provider,
                              ),
                            ].map((p) => (
                              <option key={p}>{p}</option>
                            ))}
                          </select>
                        </label>
                      </td>
                      <td>
                        {cost?.instanceType ?? r.snapshot.config.sku}
                        <small>
                          {cost?.region ?? r.snapshot.config.region} ·{" "}
                          {cost?.scope ?? "revisar configuración"}
                        </small>
                        <small>
                          {r.snapshot.usagePlan
                            ? "Con plan de doce meses"
                            : "Consumo base repetido doce meses"}
                        </small>
                        {cost && (
                          <>
                            <a
                              href={cost.source}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Fuente elegida
                            </a>
                            <small>
                              Consulta:{" "}
                              {new Date(cost.fetched).toLocaleString("es-ES")}
                            </small>
                          </>
                        )}
                      </td>
                      <td>{cost ? money(cost.monthly) : "—"}</td>
                      <td>{cost ? money(cost.periodTotal) : "—"}</td>
                      <td>
                        <button onClick={() => onRestore(r.snapshot)}>
                          Abrir recurso en calculadora
                        </button>
                        <button
                          onClick={() => {
                            try {
                              const s = getCurrent();
                              update(r.id, {
                                snapshot: s,
                                provider:
                                  r.provider === "Azure" ||
                                  s.comparisonQuotes?.some(
                                    (q) => q.provider === r.provider,
                                  )
                                    ? r.provider
                                    : "Azure",
                              });
                            } catch (e) {
                              setMessage(errorMessage(e));
                            }
                          }}
                        >
                          Reemplazar con calculadora
                        </button>
                        <button
                          onClick={() =>
                            onChange({
                              ...project,
                              resources: project.resources.filter(
                                (x) => x.id !== r.id,
                              ),
                            })
                          }
                        >
                          Quitar recurso
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {result && (
          <>
            <div className="project-totals">
              <p>
                Subtotal del mes base:{" "}
                <strong data-testid="project-monthly">
                  {money(result.monthly)}
                </strong>
              </p>
              <p>
                Subtotal de doce meses:{" "}
                <strong data-testid="project-total">
                  {money(result.periodTotal)}
                </strong>
              </p>
            </div>
            <details>
              <summary>Ver costes de los doce meses</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Mes</th>
                      <th>Cargos elegidos · USD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.months.map((m) => (
                      <tr key={m.month}>
                        <th>{m.month}</th>
                        <td>{money(m.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
        <p>
          Solo se suma el proveedor elegido de cada recurso; las alternativas
          conservadas no se añaden. AWS/GCP cubren computación. Azure incluye
          disco/red cuando están cotizados. Consolida la salida Azure en un
          único recurso; los demás deben tener cero GB para no repetir tramos de
          cuenta. Para varias cuentas o regiones de salida usa proyectos
          separados.
        </p>
        <p>
          Subtotal parcial en USD, sin impuestos ni servicios excluidos. No
          acredita equivalencia ni ahorro. Los planes de cada recurso se aplican
          por separado; sin plan se repite el mes base doce veces. No se
          consultan proveedores para sumar o exportar.
        </p>
        <div className="project-actions">
          <button
            disabled={!result || busy || !isTauri()}
            onClick={() => void action("save")}
          >
            Guardar proyecto
          </button>
          <button
            disabled={!result || busy}
            onClick={() => {
              try {
                download(
                  "proyecto.json",
                  JSON.stringify(parseProject(project), null, 2),
                  "application/json",
                );
              } catch (e) {
                setMessage(errorMessage(e));
              }
            }}
          >
            Proyecto JSON
          </button>
          <button
            disabled={!result || busy}
            onClick={() => {
              try {
                download(
                  "proyecto.csv",
                  csv(projectRows(project)),
                  "text/csv;charset=utf-8",
                );
              } catch (e) {
                setMessage(errorMessage(e));
              }
            }}
          >
            Proyecto CSV
          </button>
          <button
            disabled={!result || busy || !isTauri()}
            onClick={() => void action("pdf")}
          >
            {busy ? "Procesando proyecto…" : "Generar PDF del proyecto"}
          </button>
        </div>
        {!isTauri() && (
          <p>
            Guardar en SQLite y generar PDF nativo requieren la aplicación de
            escritorio. JSON y CSV permiten conservar el borrador desde esta
            vista.
          </p>
        )}
      </section>
      <section>
        <h3>Proyectos guardados</h3>
        {projects.length ? (
          projects.map((p) => (
            <div className="history" key={p.id}>
              <div>
                <strong>{p.name}</strong>
                <small>
                  {p.resources.length} recursos ·{" "}
                  {new Date(p.created).toLocaleString("es-ES")}
                </small>
              </div>
              <button
                onClick={() => {
                  onChange(p);
                  setMessage(
                    "Proyecto abierto con las copias originales de sus recursos.",
                  );
                }}
              >
                Abrir proyecto
              </button>
            </div>
          ))
        ) : (
          <p>No hay proyectos guardados disponibles.</p>
        )}
      </section>
    </>
  );
}
