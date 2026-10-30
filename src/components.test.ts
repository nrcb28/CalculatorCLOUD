import { describe, expect, it } from "vitest";
import {
  computeComponents,
  parseComponents,
  selectComponents,
  diskSize,
} from "./components";
import { parseSnapshot, snapshotRows } from "./engine";
import sample from "../tests/components-fixture.json";
import { fixture } from "../tests/fixtures";
const config = { ...fixture.config, egress: 1000, egressUsedGB: 100 };
const fresh = () => structuredClone(sample);
describe("capacidad Premium SSD y salida MGN", () => {
  it("redondea capacidad al tamaño provisionado sin multiplicar por horas de VM", () => {
    expect(diskSize(100)).toEqual(["P10", 128]);
    expect(diskSize(128.1)).toEqual(["P15", 256]);
    expect(diskSize(0)).toBeNull();
    expect(() => diskSize(32768)).toThrow();
    const q = parseComponents(sample, config);
    expect(computeComponents(config, q, "146").monthly).toBe("266.00");
    expect(computeComponents({ ...config, hours: 0 }, q).disk).toBe("20.00");
  });
  it("aplica la franquicia una sola vez y resta el uso previo de la cuenta", () => {
    const q = parseComponents(sample, config);
    expect(
      computeComponents({ ...config, egress: 100, egressUsedGB: 0 }, q).network,
    ).toBe("0.00");
    expect(
      computeComponents({ ...config, egress: 100, egressUsedGB: 100 }, q)
        .network,
    ).toBe("10.00");
    expect(
      computeComponents({ ...config, egress: 200, egressUsedGB: 50 }, q)
        .network,
    ).toBe("15.00");
    expect(
      computeComponents({ ...config, egress: 200, egressUsedGB: 10300 }, q)
        .network,
    ).toBe("16.70");
    expect(computeComponents({ ...config, egress: 0 }, q).network).toBe("0.00");
  });
  it("mantiene fracciones de GB y no extrapola el último tramo", () => {
    const q = parseComponents(sample, config);
    expect(computeComponents({ ...config, egress: 0.15 }, q).networkExact).toBe(
      "0.015",
    );
    expect(() =>
      computeComponents({ ...config, egress: 500001, egressUsedGB: 0 }, q),
    ).toThrow("fuera de cobertura");
  });
  it.each([
    "region",
    "unit",
    "partial",
    "duplicate",
    "currency",
    "reservation",
    "future",
    "wrongDisk",
    "meter",
    "prior",
  ])("rechaza una cotización incompatible: %s", (change) => {
    const q = fresh();
    const c = { ...config };
    if (change === "region") q.region = "eastus";
    if (change === "unit") q.network[1].unitOfMeasure = "1 GiB";
    if (change === "partial") q.network.pop();
    if (change === "duplicate") q.network[1] = { ...q.network[0] };
    if (change === "currency") q.disk.currencyCode = "EUR";
    if (change === "reservation") (q.disk as any).reservationTerm = "1 Year";
    if (change === "future") q.disk.effectiveStartDate = "2999-01-01";
    if (change === "wrongDisk") q.disk.meterName = "P10 LRS Disk Mount";
    if (change === "meter") q.network[2].meterId = "another";
    if (change === "prior") c.egressUsedGB = -1;
    expect(() => parseComponents(q, c)).toThrow();
  });
  it("selecciona capacidad exacta y todos los tramos; rechaza ambigüedad", () => {
    const raw = {
      source: sample.source,
      fetched: sample.fetched,
      region: sample.region,
      diskRates: [sample.disk],
      networkRates: sample.network,
    };
    expect(selectComponents(raw, config)).toEqual(sample);
    expect(() =>
      selectComponents(
        {
          ...raw,
          diskRates: [sample.disk, { ...sample.disk, retailPrice: 11 }],
        },
        config,
      ),
    ).toThrow();
  });
  it("los snapshots antiguos siguen sin componentes y los nuevos conservan el uso previo y las tarifas", () => {
    expect(parseSnapshot(fixture).components).toBeUndefined();
    const q = fresh();
    (q.disk as any).secret = "discard-this";
    const s = parseSnapshot({ ...fixture, config, components: q });
    expect(s.config.egressUsedGB).toBe(100);
    expect(s.components).toEqual(sample);
    expect(
      snapshotRows(s).find((row) => row[0] === "Subtotal cotizado")?.[4],
    ).toBe("266.00");
    expect(JSON.stringify(s)).not.toContain("discard-this");
  });
});
