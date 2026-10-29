// Node 22.18+ puede cargar el motor TypeScript sin generar una copia.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { candidates, compute, AZURE_SOURCE } from "../src/engine.ts";

const path = process.argv[2];
assert.ok(path, "Uso: node scripts/verify-azure-evidence.mjs <catalog.json>");
const evidence = JSON.parse(readFileSync(path, "utf8"));
assert.equal(evidence.source, AZURE_SOURCE);
const at = Date.parse(evidence.retrievedAt);
assert.ok(Number.isFinite(at) && at <= Date.now());
const config = {
  sku: "Standard_D4s_v5",
  region: "westeurope",
  instances: 1,
  hours: 730,
  storage: 100,
  egress: 0,
};
assert.equal(evidence.sku, config.sku);
assert.equal(evidence.region, config.region);
const options = candidates(evidence.rates, config, at);
// Una ambigüedad debe revisarse expresamente, nunca elegir el menor precio.
assert.equal(options.length, 1, "Se esperaba una única opción Linux PAYG");
const rate = options[0];
assert.equal(rate.productName, "Virtual Machines Dsv5 Series");
assert.equal(rate.meterName, "D4s v5");
assert.ok(
  !/windows|spot|low priority|devtest|reservation/i.test(
    `${rate.productName} ${rate.skuName} ${rate.meterName} ${rate.type}`,
  ),
);
assert.ok(!rate.reservationTerm);
const subtotal = compute(config, rate);
console.log(
  JSON.stringify(
    {
      source: evidence.source,
      retrievedAt: evidence.retrievedAt,
      config,
      items: evidence.rates.length,
      eligibleRates: options.length,
      meterId: rate.meterId,
      effectiveStartDate: rate.effectiveStartDate,
      hourlyPriceUSD: rate.retailPrice,
      subtotal,
      unquoted: ["storage", "egress"],
      scope:
        "Solo computación Linux de pago por uso; sin comparación multicloud.",
    },
    null,
    2,
  ),
);
