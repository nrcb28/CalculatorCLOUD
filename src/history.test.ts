import { describe, it, expect } from "vitest";
import { fixture } from "../tests/fixtures";
import components from "../tests/components-fixture.json";
import aws from "../tests/aws-quote-fixture.json";
import { compareSnapshots, historyRows, variation } from "./history";
import { parseSnapshot, csv } from "./engine";
describe("comparación histórica", () => {
  it("resta antes de redondear y calcula el porcentaje desde el valor original", () => {
    const a = {
        ...fixture,
        config: { ...fixture.config, instances: 1 },
        rates: [{ ...fixture.rates[0], retailPrice: 0.00001 }],
      },
      b = { ...a, rates: [{ ...a.rates[0], retailPrice: 0.00002 }] };
    const change = compareSnapshots(a, b).rows[0];
    expect(change.base).toBe("0.01");
    expect(change.target).toBe("0.01");
    expect(change.monthlyExact).toBe("0.0073");
    expect(change.monthly).toBe("0.01");
    expect(change.annual).toBe("0.09");
    expect(change.percent).toBe("100.00");
  });
  it("permite disminuciones y no divide por cero", () => {
    expect(variation("100", "0")).toMatchObject({
      monthly: "-100.00",
      annual: "-1200.00",
      percent: "-100.00",
    });
    expect(variation("0", "1").percent).toBeNull();
    expect(variation("0", "0").percent).toBeNull();
    for (const value of ["NaN", "Infinity", "-1"])
      expect(() => variation(value, "1")).toThrow();
  });
  it("no compara subtotales con distinta cobertura", () => {
    const b = { ...fixture, components };
    const report = compareSnapshots(fixture, b);
    expect(report.coverageChanged).toBe(true);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].monthly).toBe("0.00");
    expect(
      historyRows(parseSnapshot(fixture), parseSnapshot(b)).at(-1)?.join(" "),
    ).toContain("Cambio de cobertura");
  });
  it("compara componentes solo cuando están en ambos escenarios", () => {
    const a = { ...fixture, components },
      b = { ...a, config: { ...a.config, instances: 3 } };
    const report = compareSnapshots(a, b);
    expect(report.coverageChanged).toBe(false);
    expect(
      report.rows.find((r) => r.component === "Subtotal Azure cotizado")
        ?.monthly,
    ).toBe("83.00");
    expect(report.changed).toEqual(["instances"]);
  });
  it("mantiene alternativas separadas y usa el consumo de cada escenario", () => {
    const a = { ...fixture, comparisonQuotes: [aws] },
      b = { ...a, config: { ...a.config, instances: 3 } };
    const result = compareSnapshots(a, b);
    expect(result.rows.map((r) => r.monthly)).toEqual(["73.00", "156.22"]);
    expect(compareSnapshots(a, fixture).rows).toHaveLength(1);
    expect(result.baseline.comparisonQuotes?.[0].source).toBe(aws.source);
  });
  it("exporta fuentes y condiciones sin modificar snapshots ni admitir campos secretos", () => {
    const a = parseSnapshot({
        ...fixture,
        name: "=HYPERLINK(test)",
        comparisonQuotes: [{ ...aws, apiKey: "secret" }],
      }),
      b = parseSnapshot({
        ...fixture,
        name: "objetivo",
        config: { ...fixture.config, hours: 1 },
      });
    const original = JSON.stringify(a);
    const rows = historyRows(a, b);
    expect(rows.every((row) => row.length === 15)).toBe(true);
    const text = csv(rows);
    expect(text).toContain("'=HYPERLINK");
    expect(text).toContain('"-145.80"');
    expect(text).toContain(aws.catalogVersion);
    expect(text).toContain(aws.charges[0].id);
    expect(text).not.toContain("secret");
    expect(JSON.stringify(a)).toBe(original);
    expect(() => compareSnapshots(a, { ...fixture, rates: [] })).toThrow();
  });
});
