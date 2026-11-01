export const PLAN_MODEL = "monthly-usage-v1";
export type UsagePlan = {
  model: typeof PLAN_MODEL;
  months: { instances: number; hours: number }[];
};
export function parseUsagePlan(raw: unknown): UsagePlan {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("Plan mensual no válido");
  const r = raw as Record<string, unknown>;
  if (
    r.model !== PLAN_MODEL ||
    !Array.isArray(r.months) ||
    r.months.length !== 12
  )
    throw Error("El plan requiere doce meses de consumo");
  return {
    model: PLAN_MODEL,
    months: r.months.map((value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw Error("Mes de consumo no válido");
      const m = value as Record<string, unknown>;
      if (
        typeof m.instances !== "number" ||
        !Number.isInteger(m.instances) ||
        m.instances < 1 ||
        m.instances > 100000 ||
        typeof m.hours !== "number" ||
        !Number.isFinite(m.hours) ||
        m.hours < 0 ||
        m.hours > 744
      )
        throw Error(
          "Plan mensual: instancias enteras de 1 a 100000 y horas de 0 a 744",
        );
      return { instances: m.instances, hours: m.hours };
    }),
  };
}
