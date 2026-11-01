import DecimalBase from "decimal.js";
import { date } from "./dates.ts";
const Decimal = DecimalBase.clone({ precision: 50 });
export const QUOTE_MODEL = "compute-retail-v1";
export const AWS_TYPES = [
  "m6i.xlarge",
  "m6a.xlarge",
  "c6i.xlarge",
  "r6i.xlarge",
];
export const AWS_REGIONS = ["eu-west-1", "eu-central-1", "us-east-1"];
export const GCP_REGIONS = ["europe-west4", "europe-west1", "us-central1"];
export const GCP_SOURCE =
  "https://cloudbilling.googleapis.com/v1/services/6F81-5844-456A/skus";
export const awsSource = (region: string) =>
  `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/${region}/index.csv`;
export type ComputeQuote = {
  model: string;
  provider: "AWS" | "GCP";
  instanceType: string;
  region: string;
  vcpu: number;
  memoryGiB: number;
  source: string;
  fetched: string;
  catalogVersion?: string;
  published?: string;
  charges: Charge[];
};
type Charge = {
  id: string;
  description: string;
  unit: "instance-hour" | "vcpu-hour" | "gib-hour";
  quantity: number;
  unitPriceUSD: string;
  effective: string;
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 1000): v is string =>
  typeof v === "string" && !!v.trim() && v.length <= max;
function fail(): never {
  throw Error(
    "Tarifa de computación multicloud incompleta, ambigua o incompatible",
  );
}
export function n2Spec(instance: string) {
  const match = /^n2-standard-(2|4|8|16|32)$/.exec(instance);
  if (!match) return null;
  const cpu = Number(match[1]);
  return { vcpu: cpu, memoryGiB: cpu * 4 };
}
export function parseQuote(raw: unknown): ComputeQuote {
  if (
    !record(raw) ||
    raw.model !== QUOTE_MODEL ||
    !date(raw.fetched) ||
    Date.parse(raw.fetched) > Date.now() ||
    !text(raw.instanceType, 100) ||
    !text(raw.region, 40) ||
    !Array.isArray(raw.charges) ||
    !Number.isInteger(raw.vcpu) ||
    Number(raw.vcpu) < 1 ||
    Number(raw.vcpu) > 1024 ||
    typeof raw.memoryGiB !== "number" ||
    !Number.isFinite(raw.memoryGiB) ||
    raw.memoryGiB <= 0 ||
    raw.memoryGiB > 100000
  )
    fail();
  const charges = raw.charges.map((c: unknown): Charge => {
    if (
      !record(c) ||
      !text(c.id, 250) ||
      !text(c.description) ||
      !text(c.unit) ||
      !date(c.effective, true) ||
      Date.parse(c.effective) > Date.parse(raw.fetched as string) ||
      typeof c.unitPriceUSD !== "string" ||
      c.unitPriceUSD.length > 40 ||
      !/^\d+(?:\.\d+)?$/.test(c.unitPriceUSD) ||
      new Decimal(c.unitPriceUSD).gt(1e12) ||
      typeof c.quantity !== "number" ||
      !Number.isInteger(c.quantity) ||
      c.quantity < 1 ||
      c.quantity > 100000
    )
      fail();
    return {
      id: c.id,
      description: c.description,
      unit: c.unit as Charge["unit"],
      quantity: c.quantity,
      unitPriceUSD: c.unitPriceUSD,
      effective: c.effective,
    };
  });
  if (new Set(charges.map((c) => c.id)).size !== charges.length) fail();
  if (raw.provider === "AWS") {
    if (
      !AWS_TYPES.includes(raw.instanceType) ||
      !AWS_REGIONS.includes(raw.region) ||
      raw.source !== awsSource(raw.region) ||
      !text(raw.catalogVersion, 30) ||
      !/^\d{14}$/.test(raw.catalogVersion) ||
      !date(raw.published) ||
      Date.parse(raw.published) > Date.parse(raw.fetched) ||
      charges.length !== 1 ||
      charges[0].unit !== "instance-hour" ||
      charges[0].quantity !== 1 ||
      !charges[0].id.includes(".JRTCKXETXF.") ||
      !charges[0].description.toLowerCase().includes("linux") ||
      !charges[0].description.includes(raw.instanceType)
    )
      fail();
  } else if (raw.provider === "GCP") {
    const spec = n2Spec(raw.instanceType);
    if (
      !spec ||
      !GCP_REGIONS.includes(raw.region) ||
      raw.source !== GCP_SOURCE ||
      raw.vcpu !== spec.vcpu ||
      raw.memoryGiB !== spec.memoryGiB ||
      charges.length !== 2 ||
      charges[0].unit !== "vcpu-hour" ||
      charges[1].unit !== "gib-hour" ||
      charges[0].quantity !== spec.vcpu ||
      charges[1].quantity !== spec.memoryGiB ||
      !charges[0].description
        .toLowerCase()
        .startsWith("n2 instance core running in ") ||
      !charges[1].description
        .toLowerCase()
        .startsWith("n2 instance ram running in ")
    )
      fail();
  } else fail();
  return {
    model: QUOTE_MODEL,
    provider: raw.provider,
    instanceType: raw.instanceType,
    region: raw.region,
    vcpu: raw.vcpu as number,
    memoryGiB: raw.memoryGiB,
    source: raw.source as string,
    fetched: raw.fetched,
    ...(raw.provider === "AWS"
      ? {
          catalogVersion: raw.catalogVersion as string,
          published: raw.published as string,
        }
      : {}),
    charges,
  };
}
export function parseQuotes(raw: unknown): ComputeQuote[] {
  if (!Array.isArray(raw) || raw.length > 2) fail();
  const quotes = raw.map(parseQuote);
  if (new Set(quotes.map((q) => q.provider)).size !== quotes.length) fail();
  return quotes;
}
export function quoteCost(raw: ComputeQuote, instances: number, hours: number) {
  const q = parseQuote(raw);
  if (
    !Number.isInteger(instances) ||
    instances < 1 ||
    instances > 100000 ||
    !Number.isFinite(hours) ||
    hours < 0 ||
    hours > 744
  )
    throw Error("Instancias: entero entre 1 y 100000; horas: entre 0 y 744");
  const perInstance = q.charges.reduce(
    (sum, c) => sum.add(new Decimal(c.unitPriceUSD).mul(c.quantity)),
    new Decimal(0),
  );
  const monthly = perInstance.mul(instances).mul(hours);
  return {
    perInstanceHourly: perInstance.toString(),
    hourly: perInstance.mul(instances).toFixed(6),
    monthly: monthly.toFixed(2),
    monthlyExact: monthly.toString(),
    annual: monthly.mul(12).toFixed(2),
  };
}
export function comparisonRows(
  quotes: ComputeQuote[],
  instances: number,
  hours: number,
): string[][] {
  return parseQuotes(quotes).flatMap((q) => {
    const cost = quoteCost(q, instances, hours);
    return [
      [
        `Computación alternativa ${q.provider}`,
        q.provider,
        q.instanceType,
        q.region,
        cost.monthly,
        cost.annual,
        q.source,
        q.fetched,
        q.charges.map((c) => c.effective).join("; "),
        `${instances} instancias × ${hours} horas; ${q.vcpu} vCPU; ${q.memoryGiB} GiB; ${q.provider === "AWS" ? `catálogo ${q.catalogVersion}, publicado ${q.published}; ` : ""}Linux PAYG; selección manual, sin equivalencia ni discos/red; ${q.charges.map((c) => `${c.id}: ${c.quantity} × ${c.unitPriceUSD} USD/${c.unit}`).join(" + ")}`,
      ],
    ];
  });
}
