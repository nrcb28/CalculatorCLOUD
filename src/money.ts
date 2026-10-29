import Decimal from "decimal.js";

// Intl con Number perdería céntimos al superar 2^53. Agrupar la parte entera
// como BigInt conserva todos los dígitos del resultado decimal del motor.
export function money(amount: string, maximumFractionDigits = 2) {
  if (
    !Number.isInteger(maximumFractionDigits) ||
    maximumFractionDigits < 2 ||
    maximumFractionDigits > 6
  )
    throw Error("Precisión monetaria no válida");
  const value = new Decimal(amount);
  if (!value.isFinite()) throw Error("Importe monetario no válido");
  const rounded = value
    .toDecimalPlaces(maximumFractionDigits, Decimal.ROUND_HALF_UP)
    .toFixed();
  const [integer, decimal = ""] = rounded.split(".");
  const fraction = decimal.padEnd(2, "0");
  const formatter = new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fraction.length,
    maximumFractionDigits: fraction.length,
  });
  const whole = integer === "-0" ? -0 : BigInt(integer);
  return formatter
    .formatToParts(whole)
    .map((part) => (part.type === "fraction" ? fraction : part.value))
    .join("");
}
