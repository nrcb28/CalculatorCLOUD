import Decimal from "decimal.js";

export const AZURE_SOURCE = "https://prices.azure.com/api/retail/prices";
export type Config = {
  sku: string;
  region: string;
  instances: number;
  hours: number;
  storage: number;
  egress: number;
};
export type Rate = {
  meterId: string;
  skuName: string;
  armSkuName: string;
  productName: string;
  armRegionName: string;
  unitOfMeasure: string;
  retailPrice: number;
  currencyCode: string;
  effectiveStartDate: string;
  type: string;
  isPrimaryMeterRegion: boolean;
  tierMinimumUnits?: number;
};
export type Snapshot = {
  id: string;
  name: string;
  created: string;
  config: Config;
  rates: Rate[];
  fetched: string;
};
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, limit = 500): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= limit;
const date = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 40 &&
  Number.isFinite(Date.parse(value));

export function validate(value: unknown): asserts value is Config {
  if (
    !record(value) ||
    typeof value.sku !== "string" ||
    typeof value.region !== "string" ||
    !value.sku.trim() ||
    !/^[A-Za-z0-9_ -]{1,100}$/.test(value.sku) ||
    !/^[a-z0-9]{1,40}$/.test(value.region)
  )
    throw Error("SKU o región no válidos");
  for (const key of ["instances", "hours", "storage", "egress"] as const) {
    if (
      typeof value[key] !== "number" ||
      !Number.isFinite(value[key]) ||
      value[key] < 0
    )
      throw Error(
        "Los consumos deben ser números finitos mayores o iguales a cero",
      );
  }
  if (
    !Number.isInteger(value.instances) ||
    (value.instances as number) < 1 ||
    (value.instances as number) > 100000 ||
    (value.hours as number) > 744
  )
    throw Error("Instancias: entero entre 1 y 100000; horas: entre 0 y 744");
  if ((value.storage as number) > 1e9 || (value.egress as number) > 1e9)
    throw Error("Almacenamiento y tráfico: máximo 1000000000");
}

export function isRate(value: unknown): value is Rate {
  if (!record(value)) return false;
  return (
    [
      "meterId",
      "skuName",
      "armSkuName",
      "productName",
      "armRegionName",
      "unitOfMeasure",
      "currencyCode",
      "type",
    ].every((key) => text(value[key])) &&
    typeof value.retailPrice === "number" &&
    Number.isFinite(value.retailPrice) &&
    value.retailPrice >= 0 &&
    value.retailPrice <= 1e12 &&
    typeof value.isPrimaryMeterRegion === "boolean" &&
    date(value.effectiveStartDate) &&
    (value.tierMinimumUnits === undefined ||
      (typeof value.tierMinimumUnits === "number" &&
        Number.isFinite(value.tierMinimumUnits) &&
        value.tierMinimumUnits >= 0))
  );
}

export function eligible(r: unknown, c: Config, now = Date.now()): r is Rate {
  return (
    isRate(r) &&
    r.armSkuName === c.sku &&
    r.armRegionName === c.region &&
    r.unitOfMeasure === "1 Hour" &&
    r.type === "Consumption" &&
    r.currencyCode === "USD" &&
    r.isPrimaryMeterRegion &&
    (r.tierMinimumUnits ?? 0) === 0 &&
    Date.parse(r.effectiveStartDate) <= now &&
    !/windows|spot|low priority/i.test(r.productName + " " + r.skuName)
  );
}

// Un meterId puede repetirse con diferentes fechas o precios en una respuesta.
export function rateKey(r: Rate) {
  return JSON.stringify([
    r.meterId,
    r.effectiveStartDate,
    r.skuName,
    r.retailPrice,
  ]);
}
export function candidates(
  rates: unknown[],
  config: Config,
  now = Date.now(),
): Rate[] {
  const tieredMeters = new Set(
    rates
      .filter(isRate)
      .filter(
        (r) =>
          r.armSkuName === config.sku &&
          r.armRegionName === config.region &&
          (r.tierMinimumUnits ?? 0) > 0,
      )
      .map((r) => r.meterId),
  );
  return [
    ...new Map(
      rates
        .filter(
          (r): r is Rate =>
            eligible(r, config, now) && !tieredMeters.has(r.meterId),
        )
        .map((r) => [rateKey(r), r]),
    ).values(),
  ];
}

export function compute(c: Config, r: Rate) {
  validate(c);
  if (!eligible(r, c))
    throw Error(
      "Tarifa incompatible con la configuración, caducidad de vigencia o modalidad soportada",
    );
  const hourly = new Decimal(r.retailPrice).mul(c.instances);
  const monthly = hourly.mul(c.hours);
  return {
    hourly: hourly.toFixed(6),
    monthlyExact: monthly.toString(),
    daily: monthly.div(30).toFixed(2),
    monthly: monthly.toFixed(2),
    annual: monthly.mul(12).toFixed(2),
  };
}

export function parseSnapshot(input: unknown): Snapshot {
  if (
    !record(input) ||
    !text(input.id, 100) ||
    !text(input.name, 200) ||
    !date(input.created) ||
    !date(input.fetched) ||
    !Array.isArray(input.rates) ||
    input.rates.length !== 1
  )
    throw Error(
      "Presupuesto inválido: se requiere una configuración y una tarifa",
    );
  validate(input.config);
  const config = input.config;
  const rates = input.rates;
  if (!rates.every((r) => eligible(r, config)))
    throw Error("Tarifa inválida o incompatible con el presupuesto");
  return {
    id: input.id,
    name: input.name,
    created: input.created,
    fetched: input.fetched,
    config,
    rates: rates as Rate[],
  };
}

export function isStale(fetched: string, ttlHours: number, now = Date.now()) {
  const timestamp = Date.parse(fetched);
  return (
    !Number.isFinite(timestamp) ||
    timestamp > now ||
    now - timestamp >= ttlHours * 3600000
  );
}

export function csv(rows: string[][]) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map(
            (value) =>
              '"' +
              (/^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/.test(value) ? "'" : "") +
              value.replaceAll('"', '""') +
              '"',
          )
          .join(","),
      )
      .join("\r\n")
  );
}
