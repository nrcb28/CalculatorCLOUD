import DecimalBase from "decimal.js";
import { date } from "./dates.ts";
import type { Config } from "./engine";
const Decimal = DecimalBase.clone({ precision: 50 });
export const COMPONENT_MODEL = "premium-lrs-mgn-api-v1";
export const COMPONENT_SOURCE = "https://prices.azure.com/api/retail/prices";
export const DISK_SPEC_SOURCE =
  "https://learn.microsoft.com/en-us/azure/virtual-machines/disks-types#premium-ssds";
// Especificaciones oficiales revisadas el 29-10-2026. No son tarifas.
export const DISK_SIZES = [
  ["P1", 4],
  ["P2", 8],
  ["P3", 16],
  ["P4", 32],
  ["P6", 64],
  ["P10", 128],
  ["P15", 256],
  ["P20", 512],
  ["P30", 1024],
  ["P40", 2048],
  ["P50", 4096],
  ["P60", 8192],
  ["P70", 16384],
  ["P80", 32767],
] as const;
// Escala MGN observada en la API. Si cambia, exigir revisión en vez de
// extrapolar una respuesta parcial. No aplicar el último tramo negociable.
export const MAX_NETWORK_GB = 500000;
export const NETWORK_SPEC_SOURCE =
  "https://azure.microsoft.com/en-us/pricing/details/bandwidth/";
export const NETWORK_STARTS = [0, 100, 10335, 51295, 153695, 512095];
export type ComponentRate = {
  meterId: string;
  meterName: string;
  skuName: string;
  productName: string;
  armRegionName: string;
  unitOfMeasure: string;
  retailPrice: number;
  currencyCode: string;
  effectiveStartDate: string;
  type: string;
  tierMinimumUnits: number;
  isPrimaryMeterRegion: boolean;
};
export type Components = {
  model: string;
  source: string;
  fetched: string;
  region: string;
  disk: ComponentRate | null;
  network: ComponentRate[];
};
const record = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const nonnegative = (x: unknown, max = 1e12): x is number =>
  typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= max;
function fail(): never {
  throw Error(
    "Cotización de discos o red incompleta, incompatible o no soportada",
  );
}

export function diskSize(gib: number) {
  if (!nonnegative(gib, 32767))
    throw Error("Disco Premium SSD: tamaño entre 0 y 32767 GiB por instancia");
  return gib === 0 ? null : DISK_SIZES.find(([, size]) => size >= gib)!;
}
function cleanRate(
  raw: unknown,
  region: string,
  fetched: string,
): ComponentRate {
  if (
    !record(raw) ||
    ![
      "meterId",
      "meterName",
      "skuName",
      "productName",
      "armRegionName",
      "unitOfMeasure",
      "currencyCode",
      "type",
    ].every(
      (k) =>
        typeof raw[k] === "string" &&
        (raw[k] as string).trim().length > 0 &&
        (raw[k] as string).length <= 500,
    ) ||
    !date(raw.effectiveStartDate, true) ||
    Date.parse(raw.effectiveStartDate) >
      Math.min(Date.now(), Date.parse(fetched)) ||
    !nonnegative(raw.retailPrice) ||
    !nonnegative(raw.tierMinimumUnits, 1e9) ||
    raw.armRegionName !== region ||
    raw.currencyCode !== "USD" ||
    raw.type !== "Consumption" ||
    typeof raw.isPrimaryMeterRegion !== "boolean" ||
    "reservationTerm" in raw
  )
    fail();
  return Object.fromEntries(
    [
      "meterId",
      "meterName",
      "skuName",
      "productName",
      "armRegionName",
      "unitOfMeasure",
      "currencyCode",
      "type",
      "effectiveStartDate",
      "retailPrice",
      "tierMinimumUnits",
      "isPrimaryMeterRegion",
    ].map((k) => [k, raw[k]]),
  ) as ComponentRate;
}
export function parseComponents(raw: unknown, c: Config): Components {
  const size = diskSize(c.storage);
  if (!nonnegative(c.egress, 1e9) || !nonnegative(c.egressUsedGB ?? 0, 1e9))
    fail();
  if (new Decimal(c.egressUsedGB ?? 0).add(c.egress).gt(MAX_NETWORK_GB))
    throw Error(
      "Salida acumulada fuera de cobertura: solicita cotización a Azure para el último tramo",
    );
  if (
    !record(raw) ||
    raw.model !== COMPONENT_MODEL ||
    raw.source !== COMPONENT_SOURCE ||
    raw.region !== c.region ||
    !date(raw.fetched) ||
    Date.parse(raw.fetched) > Date.now() ||
    !Array.isArray(raw.network) ||
    raw.network.length !== NETWORK_STARTS.length
  )
    fail();
  const disk =
    raw.disk === null ? null : cleanRate(raw.disk, c.region, raw.fetched);
  if (size) {
    if (
      !disk ||
      disk.productName !== "Premium SSD Managed Disks" ||
      disk.skuName !== `${size[0]} LRS` ||
      disk.meterName !== `${size[0]} LRS Disk` ||
      disk.unitOfMeasure !== "1/Month" ||
      disk.tierMinimumUnits !== 0 ||
      !disk.isPrimaryMeterRegion
    )
      fail();
  } else if (disk !== null) fail();
  const network = raw.network
    .map((r) => cleanRate(r, c.region, raw.fetched as string))
    .sort((a, b) => a.tierMinimumUnits - b.tierMinimumUnits);
  for (let i = 0; i < network.length; i++) {
    const r = network[i];
    if (
      r.productName !== "Rtn Preference: MGN" ||
      r.skuName !== "Standard" ||
      r.meterName !== "Standard Data Transfer Out" ||
      r.unitOfMeasure !== "1 GB" ||
      r.tierMinimumUnits !== NETWORK_STARTS[i] ||
      r.meterId !== network[0].meterId ||
      r.effectiveStartDate !== network[0].effectiveStartDate
    )
      fail();
  }
  return {
    model: COMPONENT_MODEL,
    source: COMPONENT_SOURCE,
    fetched: raw.fetched,
    region: c.region,
    disk,
    network,
  };
}
export function selectComponents(raw: unknown, c: Config): Components {
  if (
    !record(raw) ||
    !Array.isArray(raw.diskRates) ||
    !Array.isArray(raw.networkRates) ||
    !date(raw.fetched)
  )
    fail();
  const size = diskSize(c.storage);
  const fetched = raw.fetched;
  function latest(rows: unknown[]): ComponentRate[] {
    // Limitar primero por vigencia, sin normalizar ni ocultar modalidades no válidas.
    const valid = rows.filter(
      (r): r is Record<string, unknown> =>
        record(r) &&
        date(r.effectiveStartDate, true) &&
        Date.parse(r.effectiveStartDate) <= Date.parse(fetched),
    );
    const at = valid.reduce(
      (at, r) => Math.max(at, Date.parse(r.effectiveStartDate as string)),
      -Infinity,
    );
    return [
      ...new Map(
        valid
          .filter((r) => Date.parse(r.effectiveStartDate as string) === at)
          .map((r) => {
            const clean = cleanRate(r, c.region, fetched);
            return [JSON.stringify(clean), clean] as const;
          }),
      ).values(),
    ];
  }
  const disks = size
    ? latest(
        raw.diskRates.filter(
          (r) =>
            record(r) &&
            r.skuName === `${size[0]} LRS` &&
            r.meterName === `${size[0]} LRS Disk`,
        ),
      )
    : [];
  if (size && disks.length !== 1) fail();
  const network = latest(
    raw.networkRates.filter(
      (r) =>
        record(r) &&
        r.productName === "Rtn Preference: MGN" &&
        r.skuName === "Standard" &&
        r.meterName === "Standard Data Transfer Out",
    ),
  );
  return parseComponents(
    {
      model: COMPONENT_MODEL,
      source: raw.source,
      region: raw.region,
      fetched: raw.fetched,
      disk: disks[0] ?? null,
      network,
    },
    c,
  );
}
export function computeComponents(
  c: Config,
  raw: Components,
  computeMonthly = "0",
) {
  if (
    !Number.isInteger(c.instances) ||
    c.instances < 1 ||
    c.instances > 100000 ||
    !nonnegative(c.egress, 1e9) ||
    !nonnegative(c.egressUsedGB ?? 0, 1e9)
  )
    fail();
  const selection = parseComponents(raw, c);
  const used = new Decimal(c.egressUsedGB ?? 0);
  const end = used.add(c.egress);
  if (end.gt(MAX_NETWORK_GB))
    throw Error(
      "Salida acumulada fuera de cobertura: solicita cotización a Azure para el último tramo",
    );
  let network = new Decimal(0);
  const bands: {
    from: number;
    to: number;
    quantity: string;
    price: number;
    cost: string;
  }[] = [];
  for (let i = 0; i < selection.network.length - 1; i++) {
    const r = selection.network[i],
      next = selection.network[i + 1].tierMinimumUnits;
    const quantity = Decimal.max(
      0,
      Decimal.min(end, next).sub(Decimal.max(used, r.tierMinimumUnits)),
    );
    const cost = quantity.mul(r.retailPrice);
    network = network.add(cost);
    if (quantity.gt(0))
      bands.push({
        from: r.tierMinimumUnits,
        to: next,
        quantity: quantity.toString(),
        price: r.retailPrice,
        cost: cost.toString(),
      });
  }
  const disk = new Decimal(selection.disk?.retailPrice ?? 0).mul(c.instances);
  const vm = new Decimal(computeMonthly);
  if (!vm.isFinite() || vm.isNegative()) fail();
  const monthly = vm.add(disk).add(network);
  return {
    disk: disk.toFixed(2),
    diskExact: disk.toString(),
    diskAnnual: disk.mul(12).toFixed(2),
    network: network.toFixed(2),
    networkExact: network.toString(),
    networkAnnual: network.mul(12).toFixed(2),
    monthly: monthly.toFixed(2),
    monthlyExact: monthly.toString(),
    annual: monthly.mul(12).toFixed(2),
    bands,
    diskSizeGiB: diskSize(c.storage)?.[1] ?? 0,
  };
}
