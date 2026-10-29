import DecimalBase from "decimal.js";
const Decimal = DecimalBase.clone({ precision: 50 });

// Mantener la cadena decimal hasta el último redondeo; Recharts requiere números.
export function projectCosts(monthly: string) {
  const amount = new Decimal(monthly);
  if (!amount.isFinite() || amount.isNegative())
    throw Error("Importe de proyección no válido");
  return Array.from({ length: 12 }, (_, i) => ({
    month: String(i + 1),
    USD: amount
      .mul(i + 1)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .toNumber(),
  }));
}
