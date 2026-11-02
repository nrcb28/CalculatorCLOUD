import DecimalBase from "decimal.js";
import { date } from "./dates.ts";
import {
  parseSnapshot,
  compute,
  computePlan,
  snapshotRows,
  type Snapshot,
} from "./engine.ts";
import { computeComponents } from "./components.ts";
import { quoteCost } from "./comparison.ts";
const Decimal = DecimalBase.clone({ precision: 60 });
export const PROJECT_MODEL = "resource-project-v1";
export type ProjectResource = {
  id: string;
  name: string;
  provider: "Azure" | "AWS" | "GCP";
  snapshot: Snapshot;
};
export type Project = {
  model: typeof PROJECT_MODEL;
  id: string;
  name: string;
  created: string;
  resources: ProjectResource[];
};
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && !!v.trim() && v.length <= max;
export function parseProject(raw: unknown): Project {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("Proyecto no válido");
  const p = raw as Record<string, unknown>;
  if (
    p.model !== PROJECT_MODEL ||
    !text(p.id, 100) ||
    !text(p.name, 200) ||
    !date(p.created) ||
    !Array.isArray(p.resources) ||
    p.resources.length < 1 ||
    p.resources.length > 40
  )
    throw Error("Proyecto: nombre válido y entre 1 y 40 recursos");
  const resources = p.resources.map((value: unknown): ProjectResource => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("Recurso no válido");
    const r = value as Record<string, unknown>;
    if (
      !text(r.id, 100) ||
      !text(r.name, 200) ||
      !["Azure", "AWS", "GCP"].includes(String(r.provider))
    )
      throw Error("Identidad o proveedor del recurso no válidos");
    const snapshot = parseSnapshot(r.snapshot),
      provider = r.provider as ProjectResource["provider"];
    if (
      provider !== "Azure" &&
      !snapshot.comparisonQuotes?.some((q) => q.provider === provider)
    )
      throw Error("Falta la tarifa del proveedor elegido");
    return { id: r.id, name: r.name, provider, snapshot };
  });
  if (new Set(resources.map((r) => r.id)).size !== resources.length)
    throw Error("ID de recurso repetido");
  if (
    resources.filter(
      (r) => r.provider === "Azure" && r.snapshot.config.egress > 0,
    ).length > 1
  )
    throw Error(
      "Consolida la salida Azure en un único recurso para no repetir los tramos de la cuenta. Ajusta los demás a cero en la calculadora.",
    );
  return {
    model: PROJECT_MODEL,
    id: p.id,
    name: p.name,
    created: p.created,
    resources,
  };
}
export function projectCost(raw: Project) {
  const p = parseProject(raw);
  const resources = p.resources.map((r) => {
    const s = r.snapshot,
      c = s.config,
      q = s.comparisonQuotes?.find((q) => q.provider === r.provider);
    const vm = compute(c, s.rates[0]);
    const base =
      r.provider === "Azure"
        ? s.components
          ? computeComponents(c, s.components, vm.monthlyExact)
          : vm
        : quoteCost(q!, c.instances, c.hours);
    const months = s.usagePlan
      ? computePlan(s).months.map(
          (m) => m.costs.find((c) => c.provider === r.provider)!.exact,
        )
      : Array.from({ length: 12 }, () => base.monthlyExact);
    const total = months.reduce((sum, m) => sum.add(m), new Decimal(0));
    return {
      id: r.id,
      name: r.name,
      provider: r.provider,
      instanceType: q?.instanceType ?? c.sku,
      region: q?.region ?? c.region,
      scope:
        r.provider === "Azure" && s.components
          ? "Computación + capacidad de discos + salida"
          : "Solo computación",
      monthly: base.monthly,
      monthlyExact: base.monthlyExact,
      periodTotal: total.toFixed(2),
      periodExact: total.toString(),
      months,
      source: q?.source ?? "https://prices.azure.com/api/retail/prices",
      fetched: q?.fetched ?? s.fetched,
    };
  });
  const monthly = resources.reduce(
    (sum, r) => sum.add(r.monthlyExact),
    new Decimal(0),
  );
  const months = Array.from({ length: 12 }, (_, i) => {
    const sum = resources.reduce(
      (sum, r) => sum.add(r.months[i]),
      new Decimal(0),
    );
    return { month: i + 1, amount: sum.toFixed(2), exact: sum.toString() };
  });
  return {
    resources,
    monthly: monthly.toFixed(2),
    monthlyExact: monthly.toString(),
    periodTotal: months
      .reduce((sum, m) => sum.add(m.exact), new Decimal(0))
      .toFixed(2),
    months,
  };
}
export function projectRows(raw: Project): string[][] {
  const p = parseProject(raw),
    result = projectCost(p);
  const rows = [
    [
      "Sección",
      "Recurso ID",
      "Recurso",
      "Proveedor elegido",
      "Componente",
      "Proveedor tarifa",
      "SKU / medidor",
      "Región",
      "Mes base USD",
      "Doce meses USD",
      "Fuente",
      "Consulta",
      "Vigencia",
      "Condiciones",
    ],
  ];
  for (const r of p.resources) {
    const cost = result.resources.find((c) => c.id === r.id)!;
    rows.push([
      "Subtotal elegido",
      r.id,
      r.name,
      r.provider,
      cost.scope,
      r.provider,
      cost.instanceType,
      cost.region,
      cost.monthly,
      cost.periodTotal,
      cost.source,
      cost.fetched,
      "ver copia conservada",
      "Solo se suma el proveedor elegido; sin previsión de precios; subtotal parcial",
    ]);
    rows.push(
      ...snapshotRows(r.snapshot)
        .slice(1)
        .map((row) => [
          "Copia conservada (no sumar de nuevo)",
          r.id,
          r.name,
          r.provider,
          ...row,
        ]),
    );
  }
  rows.push([
    "Subtotal proyecto",
    "",
    p.name,
    "Mixto",
    "Cargos elegidos",
    "",
    "",
    "",
    result.monthly,
    result.periodTotal,
    "",
    "",
    "",
    "Alternativas excluidas del total; red Azure en un único recurso; no acredita equivalencia ni ahorro",
  ]);
  for (const m of result.months)
    rows.push([
      `Mes proyecto ${m.month}`,
      "",
      p.name,
      "Mixto",
      "Cargos elegidos",
      "",
      "",
      "",
      m.amount,
      "",
      "",
      "",
      "",
      "Planes por recurso o consumo base repetido; suma exacta antes de redondear",
    ]);
  return rows;
}
