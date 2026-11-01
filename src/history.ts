import DecimalBase from "decimal.js";
import {
  compute,
  parseSnapshot,
  snapshotRows,
  type Snapshot,
} from "./engine.ts";
import { computeComponents } from "./components.ts";
import { quoteCost } from "./comparison.ts";
const Decimal = DecimalBase.clone({ precision: 50 });
export const HISTORY_MODEL = "historical-comparison-v1";
export function variation(base: string, target: string) {
  const a = new Decimal(base),
    b = new Decimal(target);
  if (!a.isFinite() || !b.isFinite() || a.isNegative() || b.isNegative())
    throw Error("Importe histórico no válido");
  const delta = b.sub(a);
  return {
    base: a.toFixed(2),
    target: b.toFixed(2),
    monthly: delta.toFixed(2),
    monthlyExact: delta.toString(),
    annual: delta.mul(12).toFixed(2),
    percent: a.isZero() ? null : delta.div(a).mul(100).toFixed(2),
  };
}
export function compareSnapshots(base: unknown, target: unknown) {
  const a = parseSnapshot(base),
    b = parseSnapshot(target);
  const vmA = compute(a.config, a.rates[0]),
    vmB = compute(b.config, b.rates[0]);
  const rows = [
    {
      component: "Computación Azure",
      provider: "Azure",
      ...variation(vmA.monthlyExact, vmB.monthlyExact),
    },
  ];
  const coverageChanged = !!a.components !== !!b.components;
  if (a.components && b.components) {
    const ca = computeComponents(a.config, a.components, vmA.monthlyExact),
      cb = computeComponents(b.config, b.components, vmB.monthlyExact);
    rows.push({
      component: "Subtotal Azure cotizado",
      provider: "Azure",
      ...variation(ca.monthlyExact, cb.monthlyExact),
    });
  }
  for (const provider of ["AWS", "GCP"] as const) {
    const qa = a.comparisonQuotes?.find((q) => q.provider === provider),
      qb = b.comparisonQuotes?.find((q) => q.provider === provider);
    if (qa && qb)
      rows.push({
        component: `Computación alternativa ${provider}`,
        provider,
        ...variation(
          quoteCost(qa, a.config.instances, a.config.hours).monthlyExact,
          quoteCost(qb, b.config.instances, b.config.hours).monthlyExact,
        ),
      });
  }
  const fields = [
    "sku",
    "region",
    "instances",
    "hours",
    "storage",
    "egress",
    "egressUsedGB",
  ] as const;
  const changed = fields.filter(
    (k) => (a.config[k] ?? 0) !== (b.config[k] ?? 0),
  );
  return {
    model: HISTORY_MODEL,
    baseline: a,
    target: b,
    rows,
    coverageChanged,
    changed,
  };
}
export function historyRows(base: Snapshot, target: Snapshot): string[][] {
  const report = compareSnapshots(base, target);
  const rows = [
    [
      "Sección",
      "Referencia",
      "ID",
      "Nombre",
      "Guardado",
      "Componente",
      "Proveedor",
      "SKU / medidor",
      "Región",
      "Mensual USD",
      "Anual USD",
      "Fuente",
      "Consulta",
      "Vigencia",
      "Condiciones",
    ],
  ];
  for (const [side, s] of [
    ["Base", report.baseline],
    ["Objetivo", report.target],
  ] as const) {
    rows.push(
      ...snapshotRows(s)
        .slice(1)
        .map((row) => ["Escenario", side, s.id, s.name, s.created, ...row]),
    );
  }
  for (const change of report.rows)
    rows.push([
      "Variación",
      "Objetivo − base",
      "",
      "",
      "",
      change.component,
      change.provider,
      "",
      "",
      change.monthly,
      change.annual,
      "",
      "",
      "",
      `Base ${change.base} USD; objetivo ${change.target} USD; porcentaje ${change.percent === null ? "no definido (base cero)" : change.percent + "%"}; diferencia calculada antes de redondear; anual = 12 meses; selecciones independientes, no atribuye variación a tarifas ni acredita ahorro`,
    ]);
  if (report.coverageChanged)
    rows.push([
      "Aviso",
      "",
      "",
      "",
      "",
      "Cambio de cobertura",
      "Azure",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "Solo se compara computación: un escenario incluye discos/red y el otro no",
    ]);
  if (report.baseline.usagePlan || report.target.usagePlan)
    rows.push([
      "Aviso",
      "",
      "",
      "",
      "",
      "Planes mensuales conservados",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "Las variaciones comparan el mes base, no los totales de los planes mensuales",
    ]);
  return rows;
}
