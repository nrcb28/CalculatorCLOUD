import { expect, it } from "vitest";
import { money } from "./money";

it("conserva los céntimos de subtotales que superan el entero seguro de JavaScript", () => {
  expect(
    money("74312345678836087797.777875181782").replace(/[^0-9,]/g, ""),
  ).toBe("74312345678836087797,78");
});
it("muestra hasta seis decimales por hora y al menos dos decimales", () => {
  expect(money("0.1234565", 6)).toContain("0,123457");
  expect(money("0.23", 6)).toContain("0,23");
  expect(money("1.005")).toContain("1,01");
});
it("rechaza importes no finitos y precisiones inválidas", () => {
  expect(() => money("Infinity")).toThrow();
  expect(() => money("1", 100)).toThrow();
});
