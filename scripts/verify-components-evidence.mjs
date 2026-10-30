import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import {
  candidates,
  compute,
  parseSnapshot,
  snapshotRows,
  csv,
} from "../src/engine.ts";
import { selectComponents, computeComponents } from "../src/components.ts";
const [componentFile, vmFile, prefix] = process.argv.slice(2);
assert.ok(
  componentFile && vmFile,
  "Uso: node scripts/verify-components-evidence.mjs <component-catalog.json> <vm-catalog.json> [prefijo-salida]",
);
const catalog = JSON.parse(readFileSync(componentFile, "utf8"));
const vm = JSON.parse(readFileSync(vmFile, "utf8"));
const config = {
  sku: "Standard_D4s_v5",
  region: "westeurope",
  instances: 1,
  hours: 730,
  storage: 100,
  egress: 1000,
  egressUsedGB: 0,
};
const options = candidates(vm.rates, config, Date.parse(vm.retrievedAt));
assert.equal(options.length, 1, "Revisar una opción Linux PAYG no ambigua");
const components = selectComponents(catalog, config);
const snapshot = parseSnapshot({
  id: "azure-components-live",
  name: "Azure: computación, disco y salida",
  created: new Date().toISOString(),
  fetched: vm.retrievedAt,
  config,
  rates: [options[0]],
  components,
});
const vmCost = compute(config, snapshot.rates[0]);
const result = computeComponents(config, components, vmCost.monthlyExact);
const report = {
  source: catalog.source,
  componentsFetched: components.fetched,
  computeFetched: vm.retrievedAt,
  config,
  compute: vmCost,
  components: result,
  scope:
    "Computación Linux PAYG, capacidad Premium SSD LRS y salida MGN; límites API distintos de tabla web; sin bursting, snapshots, IP/NAT, otros servicios ni impuestos.",
};
if (prefix) {
  writeFileSync(
    prefix + ".snapshot.json",
    JSON.stringify(snapshot, null, 2) + "\n",
  );
  writeFileSync(
    prefix + ".subtotal.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  writeFileSync(prefix + ".csv", csv(snapshotRows(snapshot)));
}
console.log(JSON.stringify(report, null, 2));
