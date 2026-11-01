import { describe, it, expect } from "vitest";
import raw from "../tests/aws-quote-fixture.json";
import { fixture } from "../tests/fixtures";
import { parseQuote, parseQuotes, quoteCost } from "./comparison";
import { parseSnapshot, snapshotRows } from "./engine";
describe("cotizaciones alternativas", () => {
  it("calcula el precio AWS capturado con precisión decimal", () => {
    const q = parseQuote(raw);
    expect(quoteCost(q, 1, 730).monthly).toBe("156.22");
    expect(quoteCost(q, 3, 0.25).monthlyExact).toBe("0.1605");
    expect(quoteCost(q, 1, 0).monthly).toBe("0.00");
  });
  it("conserva las alternativas sin sumarlas a Azure y normaliza secretos", () => {
    const s = parseSnapshot({
      ...fixture,
      comparisonQuotes: [{ ...raw, apiKey: "secret" }],
    });
    expect(JSON.stringify(s)).not.toContain("secret");
    const rows = snapshotRows(s);
    expect(rows.some((r) => r.includes("312.44"))).toBe(true);
    expect(rows.some((r) => r.includes("146.00"))).toBe(true);
    expect(parseSnapshot(fixture).comparisonQuotes).toBeUndefined();
  });
  it("rechaza duplicados y precios ambiguos o incompatibles", () => {
    expect(() => parseQuotes([raw, raw])).toThrow();
    for (const change of [
      { source: "https://example.com" },
      { region: "westeurope" },
      { provider: "Azure" },
      { catalogVersion: "latest" },
      { fetched: "2999-01-01T00:00:00Z" },
      { charges: [{ ...raw.charges[0], unitPriceUSD: "1e-3" }] },
      { charges: [{ ...raw.charges[0], unit: "seconds" }] },
    ])
      expect(() => parseQuote({ ...raw, ...change })).toThrow();
  });
  it("compone las unidades CPU y memoria de N2", () => {
    const q = parseQuote({
      model: "compute-retail-v1",
      provider: "GCP",
      instanceType: "n2-standard-4",
      region: "europe-west4",
      vcpu: 4,
      memoryGiB: 16,
      source:
        "https://cloudbilling.googleapis.com/v1/services/6F81-5844-456A/skus",
      fetched: "2026-01-01T00:00:00Z",
      charges: [
        {
          id: "cpu",
          description: "N2 Instance Core running in Netherlands",
          unit: "vcpu-hour",
          quantity: 4,
          unitPriceUSD: "0.031",
          effective: "2025-01-01",
        },
        {
          id: "ram",
          description: "N2 Instance Ram running in Netherlands",
          unit: "gib-hour",
          quantity: 16,
          unitPriceUSD: "0.004",
          effective: "2025-01-01",
        },
      ],
    });
    expect(quoteCost(q, 1, 730).monthly).toBe("137.24");
    expect(() => parseQuote({ ...q, memoryGiB: 32 })).toThrow();
  });
});
