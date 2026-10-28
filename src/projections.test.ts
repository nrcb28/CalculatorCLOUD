import { describe, it, expect } from "vitest";
import { projectCosts } from "./projections";
describe("proyecciones monetarias", () => {
  it("redondea medios céntimos con la misma regla decimal del motor", () => {
    const projection = projectCosts("0.045");
    expect(projection[0].USD).toBe(0.05);
    expect(projection[11].USD).toBe(0.54);
  });
  it("acumula antes de redondear cada mes", () => {
    const projection = projectCosts("0.0073");
    expect(projection[0].USD).toBe(0.01);
    expect(projection[11].USD).toBe(0.09);
  });
  it("permite consumo cero y rechaza importes no finitos o negativos", () => {
    expect(projectCosts("0").every((point) => point.USD === 0)).toBe(true);
    for (const value of ["NaN", "Infinity", "-1"])
      expect(() => projectCosts(value)).toThrow();
  });
});
