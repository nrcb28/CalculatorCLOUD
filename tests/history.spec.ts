import { test, expect, type Page } from "@playwright/test";
import { fixture } from "./fixtures";
import components from "./components-fixture.json" with { type: "json" };
async function load(page: Page, side: "Base" | "Objetivo", value: unknown) {
  await page.getByLabel(`${side}: importar presupuesto JSON`).setInputFiles({
    name: "snapshot.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(value)),
  });
}
async function exportText(page: Page, format: "JSON" | "CSV") {
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: `Exportar comparación ${format}`,
      exact: true,
    })
    .click();
  const stream = await (await event).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}
test("compara JSON independientes, exporta fuentes y conserva la calculadora", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Presupuestos", exact: true }).click();
  await load(page, "Base", fixture);
  await load(page, "Objetivo", {
    ...fixture,
    id: "target",
    name: "Más instancias",
    config: { ...fixture.config, instances: 3 },
  });
  const panel = page.getByTestId("historical-comparison");
  await expect(
    panel.getByRole("table", { name: "Variación del coste mensual en USD" }),
  ).toContainText("73,00");
  await expect(
    panel.getByRole("table", {
      name: "Configuración original de cada escenario",
    }),
  ).toContainText("Instancias · cambió");
  const report = JSON.parse(await exportText(page, "JSON"));
  expect(report.baseline.config.instances).toBe(2);
  expect(report.target.config.instances).toBe(3);
  expect(report.rows[0].percent).toBe("50.00");
  expect(await exportText(page, "CSV")).toContain("prices.azure.com");
  await load(page, "Objetivo", { invalid: true });
  await expect(panel.getByRole("status")).toContainText("Presupuesto inválido");
  await expect(
    panel.getByRole("table", { name: "Variación del coste mensual en USD" }),
  ).toContainText("73,00");
  await page.screenshot({
    path: testInfo.outputPath("history.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Calculadora", exact: true }).click();
  await expect(page.getByLabel("Instancias", { exact: true })).toHaveValue("1");
});
test("advierte cobertura distinta y base cero", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Presupuestos", exact: true }).click();
  await load(page, "Base", {
    ...fixture,
    config: { ...fixture.config, hours: 0 },
  });
  await load(page, "Objetivo", { ...fixture, components });
  const panel = page.getByTestId("historical-comparison");
  await expect(panel.getByRole("status")).toContainText("Cambio de cobertura");
  await expect(
    panel.getByRole("table", { name: "Variación del coste mensual en USD" }),
  ).toContainText("No definida: base cero");
  await expect(
    panel.getByRole("table", { name: "Variación del coste mensual en USD" }),
  ).not.toContainText("Subtotal Azure");
});
test("selecciona copias guardadas sin solicitar precios y permite limpiar", async ({
  page,
}) => {
  await page.addInitScript(
    ({ a, b }) => {
      const w = window as any;
      w.isTauri = true;
      w.calls = [];
      w.__TAURI_INTERNALS__ = {
        invoke: (command: string) => {
          w.calls.push(command);
          if (command === "list_budgets")
            return Promise.resolve([
              JSON.stringify(a),
              "invalid",
              JSON.stringify(b),
            ]);
          return Promise.reject(Error(command));
        },
      };
    },
    {
      a: fixture,
      b: {
        ...fixture,
        id: "second",
        name: "Segundo",
        config: { ...fixture.config, hours: 1 },
      },
    },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Presupuestos", exact: true }).click();
  await page.getByLabel("Base: presupuesto guardado").selectOption("saved-0");
  await page
    .getByLabel("Objetivo: presupuesto guardado")
    .selectOption("saved-1");
  const panel = page.getByTestId("historical-comparison");
  await expect(
    panel.getByRole("table", { name: "Variación del coste mensual en USD" }),
  ).toContainText("-145,80");
  expect(await page.evaluate(() => (window as any).calls)).toEqual([
    "list_budgets",
  ]);
  await page.getByLabel("Base: presupuesto guardado").selectOption("");
  await expect(
    panel.getByRole("button", { name: "Exportar comparación JSON" }),
  ).toHaveCount(0);
});
