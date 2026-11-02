import { describe, it, expect } from "vitest";
import raw from "../tests/project-fixture.json";
import { parseProject, projectCost, projectRows } from "./project";
import { csv } from "./engine";
describe("proyectos", () => {
  it("suma solo el proveedor elegido y aplica planes por recurso", () => {
    const p = parseProject(raw),
      cost = projectCost(p);
    expect(cost.monthly).toBe("578.44");
    expect(cost.periodTotal).toBe("6482.84");
    expect(cost.months[0].amount).toBe("120.00");
    expect(cost.resources.map((r) => r.periodTotal)).toEqual([
      "3046.00",
      "3436.84",
    ]);
  });
  it("normaliza campos públicos sin conservar secretos", () => {
    const copy = structuredClone(raw) as any;
    copy.apiKey = "secret";
    copy.resources[0].token = "secret";
    copy.resources[0].snapshot.config.token = "secret";
    expect(JSON.stringify(parseProject(copy))).not.toContain("secret");
    expect(
      parseProject(copy).resources[0].snapshot.usagePlan?.months,
    ).toHaveLength(12);
  });
  it("rechaza doble asignación de salida Azure, proveedores sin tarifa e identidades repetidas", () => {
    const copy = structuredClone(raw);
    copy.resources[1].provider = "Azure";
    expect(() => parseProject(copy)).toThrow(/Consolida/);
    copy.resources[1].snapshot.config.egress = 0;
    expect(() => parseProject(copy)).not.toThrow();
    copy.resources[1].provider = "GCP";
    expect(() => parseProject(copy)).toThrow(/Falta/);
    copy.resources[1].provider = "AWS";
    copy.resources[1].id = copy.resources[0].id;
    expect(() => parseProject(copy)).toThrow(/repetido/);
  });
  it.each([
    null,
    {},
    { ...raw, model: "other" },
    { ...raw, name: "" },
    { ...raw, resources: [] },
    { ...raw, resources: Array.from({ length: 41 }, () => raw.resources[0]) },
    { ...raw, created: "2025-02-30T00:00:00Z" },
  ])("valida límites y modelo %#", (p) =>
    expect(() => parseProject(p)).toThrow(),
  );
  it("conserva fuentes y separa las copias de precios de los cargos sumados en CSV", () => {
    const p = parseProject(raw),
      before = JSON.stringify(p),
      rows = projectRows(p);
    expect(rows.every((r) => r.length === 14)).toBe(true);
    expect(rows.filter((r) => r[0] === "Subtotal elegido")).toHaveLength(2);
    expect(
      rows.some((r) => r[0] === "Subtotal proyecto" && r[9] === "6482.84"),
    ).toBe(true);
    expect(csv(rows)).toContain(
      raw.resources[1].snapshot.comparisonQuotes[0].catalogVersion,
    );
    expect(JSON.stringify(p)).toBe(before);
  });
  it("usa consumo constante sin plan y suma fracciones antes de redondear", () => {
    const p = parseProject(raw);
    p.resources = p.resources.slice(0, 1);
    delete p.resources[0].snapshot.components;
    delete p.resources[0].snapshot.usagePlan;
    p.resources[0].snapshot.config.instances = 1;
    p.resources[0].snapshot.config.hours = 1;
    p.resources[0].snapshot.rates[0].retailPrice = 0.001;
    const c = projectCost(p);
    expect(c.monthly).toBe("0.00");
    expect(c.periodTotal).toBe("0.01");
  });
});
