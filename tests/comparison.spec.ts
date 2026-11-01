import { test, expect } from "@playwright/test";
import quote from "./aws-quote-fixture.json" with { type: "json" };
import { fixture } from "./fixtures";
test("consulta AWS, conserva región manual y descarta respuestas al salir", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.isTauri = true;
    w.__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: any) => {
        if (cmd === "list_budgets") return Promise.resolve([]);
        if (cmd === "compute_quote") {
          w.quoteArgs = args;
          return new Promise((resolve) => (w.finishQuote = resolve));
        }
        return Promise.reject(Error(cmd));
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Comparador", exact: true }).click();
  await page
    .getByRole("button", { name: "Consultar computación", exact: true })
    .click();
  expect(await page.evaluate(() => (window as any).quoteArgs)).toEqual({
    provider: "AWS",
    instanceType: "m6i.xlarge",
    region: "eu-west-1",
    apiKey: null,
  });
  await page.evaluate((q) => (window as any).finishQuote(q), quote);
  await expect(page.locator(".comparison tbody")).toContainText("156,22");
  await page.getByLabel("Proveedor", { exact: true }).selectOption("GCP");
  await page
    .getByLabel("Clave API efímera de Cloud Billing")
    .fill("test-only-key");
  await page
    .getByRole("button", { name: "Consultar computación", exact: true })
    .click();
  await expect(
    page.getByLabel("Clave API efímera de Cloud Billing"),
  ).toHaveValue("");
  await page.getByRole("button", { name: "Presupuestos", exact: true }).click();
  await page.getByLabel("Importar presupuesto JSON").setInputFiles({
    name: "legacy.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await page.evaluate((q) => (window as any).finishQuote(q), quote);
  await page.getByRole("button", { name: "Comparador", exact: true }).click();
  await expect(page.locator(".comparison tbody tr")).toHaveCount(0);
});
test("importa y exporta una alternativa sin alterar el subtotal Azure", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Presupuestos", exact: true }).click();
  await page.getByLabel("Importar presupuesto JSON").setInputFiles({
    name: "multi.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ ...fixture, comparisonQuotes: [quote] }),
    ),
  });
  await expect(page.locator(".metric").first()).toContainText("146,00");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  expect(JSON.parse(Buffer.concat(chunks).toString()).comparisonQuotes).toEqual(
    [quote],
  );
  await page.getByRole("button", { name: "Comparador", exact: true }).click();
  await expect(page.locator(".comparison tbody")).toContainText("312,44");
});
