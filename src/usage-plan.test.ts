import { describe, it, expect } from "vitest";
import { fixture } from "../tests/fixtures";
import plan from "../tests/usage-plan-fixture.json";
import components from "../tests/components-fixture.json";
import aws from "../tests/aws-quote-fixture.json";
import { parseUsagePlan } from "./usage-plan";
import { computePlan, parseSnapshot, snapshotRows } from "./engine";
import { compareSnapshots, historyRows } from "./history";
describe("plan mensual", () => {
  it("normaliza doce meses y conserva compatibilidad con presupuestos anteriores", () => {
    expect(parseSnapshot(fixture).usagePlan).toBeUndefined();
    expect(
      parseSnapshot({
        ...fixture,
        usagePlan: {
          ...plan,
          secret: "token",
          months: plan.months.map((m) => ({ ...m, token: "secret" })),
        },
      }).usagePlan,
    ).toEqual(plan);
  });
  it.each([
    null,
    {},
    { ...plan, model: "unknown" },
    { ...plan, months: [] },
    { ...plan, months: [...plan.months, plan.months[0]] },
    ...[-1, 0, 1.5, 100001, NaN, Infinity, "2"].map((instances) => ({
      ...plan,
      months: plan.months.map((m) => ({ ...m, instances })),
    })),
    ...[-1, 745, Infinity, NaN, "730"].map((hours) => ({
      ...plan,
      months: plan.months.map((m) => ({ ...m, hours })),
    })),
  ])("rechaza plan inválido %#", (raw) =>
    expect(() => parseUsagePlan(raw)).toThrow(),
  );
  it("suma meses exactos antes de redondear", () => {
    const s = parseSnapshot({
      ...fixture,
      rates: [{ ...fixture.rates[0], retailPrice: 0.001 }],
      usagePlan: {
        model: plan.model,
        months: plan.months.map(() => ({ instances: 1, hours: 1 })),
      },
    });
    const result = computePlan(s);
    expect(result.months.every((m) => m.costs[0].monthly === "0.00")).toBe(
      true,
    );
    expect(result.totals[0].amount).toBe("0.01");
    expect(result.totals[0].exact).toBe("0.012");
  });
  it("conserva cargos mensuales de disco/red a cero horas y separa alternativas", () => {
    const s = parseSnapshot({
      ...fixture,
      config: { ...fixture.config, egress: 1000, egressUsedGB: 100 },
      components,
      comparisonQuotes: [aws],
      usagePlan: plan,
    });
    const r = computePlan(s);
    expect(r.months[0].costs.map((c) => c.monthly)).toEqual(["120.00", "0.00"]);
    expect(r.totals.map((t) => t.amount)).toEqual(["3046.00", "3436.84"]);
    expect(r.months[0].costs[0].source).toContain("prices.azure.com");
  });
  it("exporta periodos y total real sin modificar la anualización del mes base", () => {
    const s = parseSnapshot({ ...fixture, usagePlan: plan });
    const rows = snapshotRows(s);
    expect(
      rows.some(
        (r) => r[0] === "Total plan de doce meses" && r[5] === "1606.00",
      ),
    ).toBe(true);
    expect(rows[1][5]).toBe("1752.00");
    expect(rows.filter((r) => r[0].startsWith("Plan mes"))).toHaveLength(12);
    expect(rows.every((r) => r.length === 10)).toBe(true);
    expect(historyRows(s, parseSnapshot(fixture)).at(-1)?.join(" ")).toContain(
      "mes base",
    );
    expect(compareSnapshots(s, fixture).rows[0].monthly).toBe("0.00");
  });
});
