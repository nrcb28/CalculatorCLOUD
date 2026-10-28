import { test, expect, type Page } from "@playwright/test";
import { fixture } from "./fixtures";
async function importFixture(page: Page, value: unknown = fixture) {
  await page.getByRole("button", { name: "Presupuestos", exact: true }).click();
  await page.getByLabel("Importar presupuesto JSON").setInputFiles({
    name: "scenario.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(value)),
  });
}
test("navegación, tema persistente y menú compacto", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Activar tema claro" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Activar tema oscuro" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Contraer menú" }).click();
  await expect(
    page.getByRole("button", { name: "Expandir menú" }),
  ).toBeVisible();
  for (const name of [
    "Calculadora",
    "Comparador",
    "Acceso a proveedores",
    "Preferencias",
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }
});
test("editar consumos inválidos después de importar no bloquea React", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await importFixture(page);
  await expect(
    page.getByText("146,00", { exact: false }).first(),
  ).toBeVisible();
  await page.getByLabel("Instancias", { exact: true }).fill("0");
  await expect(page.getByRole("alert")).toContainText("entero");
  await expect(
    page.getByRole("button", { name: "Guardar presupuesto" }),
  ).toBeDisabled();
  await page.getByLabel("Instancias", { exact: true }).fill("2");
  await page.getByLabel("Horas / mes", { exact: true }).fill("");
  await expect(page.getByRole("alert")).toContainText("finitos");
  await page.getByLabel("Horas / mes", { exact: true }).fill("730");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("rechaza JSON malformado y mantiene el escenario al importar de nuevo", async ({
  page,
}) => {
  await page.goto("/");
  await importFixture(page, { ...fixture, config: null });
  await expect(page.getByRole("status")).toContainText("SKU o región");
  await importFixture(page);
  await expect(
    page.getByRole("heading", { name: "Calculadora", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("SKU de Azure")).toHaveValue(fixture.config.sku);
});
test("historial tolera una fila corrupta y guarda IDs consistentes", async ({
  page,
}) => {
  await page.addInitScript(
    ({ fixture }) => {
      const w = window as any;
      w.isTauri = true;
      w.saved = [];
      w.__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args: any) => {
          if (cmd === "list_budgets")
            return ["invalid", JSON.stringify(fixture)];
          if (cmd === "save_budget") {
            w.saved.push(args);
            return null;
          }
          throw Error("unexpected " + cmd);
        },
      };
    },
    { fixture },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Presupuestos", exact: true }).click();
  await expect(page.getByText(fixture.name, { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("omitido");
  await page.getByRole("button", { name: "Abrir escenario" }).click();
  await page.getByRole("button", { name: "Guardar presupuesto" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Presupuesto guardado" }),
  ).toBeVisible();
  const saved = await page.evaluate(() => (window as any).saved[0]);
  expect(saved.id).toBe(JSON.parse(saved.data).id);
});
test("una respuesta tardía no sobrescribe un escenario importado", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.isTauri = true;
    w.__TAURI_INTERNALS__ = {
      invoke: (cmd: string) => {
        if (cmd === "azure_prices")
          return new Promise((resolve) => (w.finishAzure = resolve));
        if (cmd === "list_budgets") return Promise.resolve([]);
        return Promise.reject(Error("unexpected"));
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Calculadora", exact: true }).click();
  await page
    .getByRole("button", { name: "Consultar tarifas", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Consultando…" }),
  ).toBeVisible();
  await importFixture(page);
  await page.evaluate(() => {
    (window as any).finishAzure({
      rates: [],
      fetched: new Date().toISOString(),
      cached: false,
    });
  });
  await expect(
    page.getByText("146,00", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Escenario abierto", { exact: false }),
  ).toBeVisible();
});
test("la clave GCP se elimina al salir y al comprobar el acceso", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.isTauri = true;
    w.__TAURI_INTERNALS__ = {
      invoke: async () => ({
        provider: "GCP",
        message: "Comprobado por el doble de pruebas",
      }),
    };
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Acceso a proveedores", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Google Cloud", exact: false })
    .click();
  await page
    .getByLabel("API key de Google Cloud")
    .fill("test-only-not-a-real-key");
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page
    .getByRole("button", { name: "Acceso a proveedores", exact: true })
    .click();
  await expect(page.getByLabel("API key de Google Cloud")).toHaveValue("");
  await page
    .getByLabel("API key de Google Cloud")
    .fill("test-only-not-a-real-key");
  await page
    .getByRole("button", { name: "Comprobar acceso", exact: true })
    .click();
  await expect(page.getByLabel("API key de Google Cloud")).toHaveValue("");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "test-only",
  );
});
test("preferencia de caché persiste y usa horas enteras", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preferencias", exact: true }).click();
  await page.getByLabel("Horas de caché").fill("12.5");
  await expect(page.getByLabel("Horas de caché")).toHaveValue("12");
  await page.reload();
  await page.getByRole("button", { name: "Preferencias", exact: true }).click();
  await expect(page.getByLabel("Horas de caché")).toHaveValue("12");
});
test("exporta un snapshot que conserva la tarifa y su consulta", async ({
  page,
}) => {
  await page.goto("/");
  await importFixture(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("presupuesto.json");
  const stream = await download.createReadStream();
  const buffers: Buffer[] = [];
  for await (const chunk of stream!) buffers.push(chunk);
  const exported = JSON.parse(Buffer.concat(buffers).toString());
  expect(exported.rates).toEqual(fixture.rates);
  expect(exported.fetched).toBe(fixture.fetched);
});
