import { describe, it, expect } from "vitest";
import {
  compute,
  eligible,
  parseSnapshot,
  csv,
  validate,
  candidates,
  rateKey,
  isStale,
} from "./engine";
import { fixture } from "../tests/fixtures";
const c = fixture.config,
  r = fixture.rates[0];
describe("cálculo y selección", () => {
  it("mantiene precisión decimal y anualiza", () => {
    expect(compute(c, r).monthly).toBe("146.00");
    expect(compute(c, r).annual).toBe("1752.00");
  });
  it("no redondea el subtotal antes de proyectar", () => {
    const cost = compute(
      { ...c, instances: 1 },
      { ...r, retailPrice: 0.00001 },
    );
    expect(cost.monthly).toBe("0.01");
    expect(cost.monthlyExact).toBe("0.0073");
    expect(cost.annual).toBe("0.09");
  });
  it("permite cero horas y conserva precisión con horas fraccionarias", () => {
    expect(compute({ ...c, hours: 0 }, r).monthly).toBe("0.00");
    expect(compute({ ...c, hours: 0.25 }, r).monthly).toBe("0.05");
  });
  it.each([
    null,
    {},
    { ...c, hours: 745 },
    { ...c, instances: 1.5 },
    { ...c, instances: 0 },
    { ...c, hours: NaN },
    { ...c, egress: Infinity },
    { ...c, storage: 1e10 },
    { ...c, sku: undefined },
  ])("rechaza configuración inválida %#", (value) =>
    expect(() => validate(value)).toThrow(),
  );
  it.each([
    { ...r, unitOfMeasure: "1 GB" },
    { ...r, retailPrice: NaN },
    { ...r, retailPrice: -1 },
    { ...r, currencyCode: "EUR" },
    { ...r, armSkuName: "Other" },
    { ...r, armRegionName: "eastus" },
    { ...r, skuName: "Spot" },
    { ...r, productName: "Windows" },
    { ...r, tierMinimumUnits: 100 },
    { ...r, effectiveStartDate: "2999-01-01T00:00:00Z" },
  ])("no calcula ni selecciona tarifas incompatibles %#", (value) => {
    expect(eligible(value, c)).toBe(false);
    expect(() => compute(c, value)).toThrow();
  });
  it("no extrapola el primer tramo de un medidor con múltiples tramos", () => {
    expect(
      candidates([r, { ...r, tierMinimumUnits: 100, retailPrice: 0.05 }], c),
    ).toEqual([]);
  });
  it("descarta respuestas malformadas sin bloquear el selector", () => {
    expect(
      candidates([null, {}, r, { ...r, retailPrice: Infinity }], c),
    ).toEqual([r]);
  });
  it("distingue tarifas con el mismo meterId y deduplica copias idénticas", () => {
    const another = { ...r, retailPrice: 0.2 };
    expect(rateKey(r)).not.toBe(rateKey(another));
    expect(candidates([r, r, another], c)).toHaveLength(2);
  });
});
describe("importación y exportación", () => {
  it("recupera los valores originales de un snapshot", () =>
    expect(parseSnapshot(JSON.parse(JSON.stringify(fixture)))).toEqual(
      fixture,
    ));
  it.each([
    {},
    null,
    { ...fixture, config: null },
    { ...fixture, rates: [] },
    { ...fixture, created: "invalid" },
    { ...fixture, name: 2 },
    { ...fixture, rates: [{ ...r, currencyCode: undefined }] },
    { ...fixture, rates: [{ ...r, isPrimaryMeterRegion: "true" }] },
    { ...fixture, rates: [{ ...r, armRegionName: "eastus" }] },
  ])("rechaza importación malformada %#", (value) =>
    expect(() => parseSnapshot(value)).toThrow(),
  );
  it.each([
    "1",
    "2025-01-01",
    "2025-02-30T00:00:00Z",
    "2025-02-29T00:00:00Z",
    "2025-04-31T00:00:00Z",
    "2025-01-01T24:00:00Z",
    "2025-01-01T00:00:00",
    "2025-01-01T00:00:00+24:00",
  ])("exige timestamps RFC3339 con calendario válido: %s", (value) => {
    expect(() => parseSnapshot({ ...fixture, created: value })).toThrow();
    expect(() => parseSnapshot({ ...fixture, fetched: value })).toThrow();
  });
  it("admite una zona explícita, fracciones y fechas de vigencia ISO", () => {
    const valid = {
      ...fixture,
      created: "2024-02-29T23:59:59.1234567+01:30",
      fetched: "2025-01-01T00:00:00-00:00",
      rates: [{ ...r, effectiveStartDate: "2024-02-29", tierMinimumUnits: 0 }],
    };
    expect(parseSnapshot(valid)).toEqual(valid);
  });
  it.each(["1", "2025-02-30", "2025-01-01T00:00:00"])(
    "rechaza fechas de vigencia ambiguas o imposibles: %s",
    (effectiveStartDate) => {
      expect(eligible({ ...r, effectiveStartDate }, c)).toBe(false);
    },
  );
  it("reconstruye los campos permitidos sin conservar extras ni mutar la entrada", () => {
    const input = {
      ...fixture,
      unknown: "root extra",
      config: { ...c, token: "unexpected secret" },
      rates: [{ ...r, unknown: { nested: "rate extra" } }],
    };
    const parsed = parseSnapshot(input);
    expect(parsed).toEqual(fixture);
    expect(parsed.config).not.toBe(input.config);
    expect(parsed.rates[0]).not.toBe(input.rates[0]);
    expect(input.config.token).toBe("unexpected secret");
    expect(JSON.stringify(parsed)).not.toContain("unexpected secret");
    expect(JSON.stringify(parsed)).not.toContain("rate extra");
  });
  it("escapa CSV, fórmulas precedidas de espacios y saltos", () => {
    expect(csv([["=1+1", 'a"b']])).toContain('"\'=1+1","a""b"');
    for (const v of ["  =1+1", "\t@SUM(A1)", "\rtest", "\n=1"])
      expect(csv([[v]])).toContain("\"'" + v + '"');
  });
});
describe("caducidad", () => {
  const now = Date.parse("2026-01-02T00:00:00Z");
  it("marca el límite exacto, fechas inválidas y relojes adelantados", () => {
    expect(isStale("2026-01-01T00:00:00Z", 24, now)).toBe(true);
    expect(isStale("2026-01-03T00:00:00Z", 24, now)).toBe(true);
    expect(isStale("invalid", 24, now)).toBe(true);
    expect(isStale("2025-02-30T00:00:00Z", 24 * 365, now)).toBe(true);
    expect(isStale("2026-01-01T12:00:00Z", 24, now)).toBe(false);
  });
});
