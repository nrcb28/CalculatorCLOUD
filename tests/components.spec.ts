import { test, expect, type Page } from "@playwright/test";
import { fixture } from "./fixtures";
import components from "./components-fixture.json" with { type: "json" };
const scenario = {
  ...fixture,
  config: { ...fixture.config, egress: 1000, egressUsedGB: 100 },
  components,
};
async function importScenario(page: Page, value: unknown) {
  await page.getByRole("button", { name: "Presupuestos", exact: true }).click();
  await page.getByLabel("Importar presupuesto JSON").setInputFiles({
    name: "components.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(value)),
  });
}
async function downloadedText(page: Page, button: string) {
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: button, exact: true }).click();
  const stream = await (await promise).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}
test("componentes importados se recalculan y se conservan en JSON y CSV", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await importScenario(page, scenario);
  await expect(page.getByTestId("components-total")).toContainText("266,00");
  await expect(page.locator(".metric").first()).toContainText("266,00");
  const exported = JSON.parse(await downloadedText(page, "JSON"));
  expect(exported.components).toEqual(components);
  expect(exported.config.egressUsedGB).toBe(100);
  const csv = await downloadedText(page, "CSV");
  expect(csv).toContain("Capacidad de discos");
  expect(csv).toContain("266.00");
  expect(csv).toContain("100 GB previos");
  await page.getByLabel("Instancias", { exact: true }).fill("3");
  await expect(page.getByTestId("components-total")).toContainText("349,00");
  await page.getByLabel("Salida previa de la cuenta (GB / mes)").fill("0");
  await expect(page.getByTestId("components-total")).toContainText("339,00");
  await page.screenshot({
    path: testInfo.outputPath("components.png"),
    fullPage: true,
  });
  await page.getByLabel("Disco por instancia (GiB)").fill("129");
  await expect(page.getByTestId("components-total")).toHaveCount(0);
});
test("cotiza mediante IPC y descarta una respuesta tardía tras importar", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.isTauri = true;
    w.__TAURI_INTERNALS__ = {
      invoke: (command: string) => {
        if (command === "list_budgets") return Promise.resolve([]);
        if (command === "azure_components")
          return new Promise((resolve) => (w.finishComponents = resolve));
        return Promise.reject(Error("unexpected " + command));
      },
    };
  });
  await page.goto("/");
  await importScenario(page, { ...scenario, components: undefined });
  await page
    .getByRole("button", { name: "Cotizar discos y red", exact: true })
    .click();
  await page.evaluate(
    (q) =>
      (window as any).finishComponents({
        source: q.source,
        fetched: q.fetched,
        region: q.region,
        diskRates: [q.disk],
        networkRates: q.network,
      }),
    components,
  );
  await expect(page.getByTestId("components-total")).toContainText("266,00");
  await page
    .getByRole("button", { name: "Cotizar discos y red", exact: true })
    .click();
  await importScenario(page, fixture);
  await page.evaluate(
    (q) =>
      (window as any).finishComponents({
        source: q.source,
        fetched: q.fetched,
        region: q.region,
        diskRates: [q.disk],
        networkRates: q.network,
      }),
    components,
  );
  await expect(page.getByTestId("components-total")).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Escenario abierto" }),
  ).toBeVisible();
});
