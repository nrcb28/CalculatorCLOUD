import { test, expect, type Page } from "@playwright/test";
import raw from "./project-fixture.json" with { type: "json" };
async function open(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Proyectos", exact: true }).click();
}
async function load(page: Page, value: unknown) {
  await page
    .getByLabel("Importar proyecto JSON", { exact: true })
    .setInputFiles({
      name: "project.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(value)),
    });
}
async function downloaded(page: Page, label: string) {
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: label, exact: true }).click();
  const stream = await (await event).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  return Buffer.concat(chunks);
}
test("agrupa recursos, protege tramos y conserva el borrador al editar en calculadora", async ({
  page,
}, info) => {
  await open(page);
  await load(page, raw);
  await expect(page.getByTestId("project-monthly")).toContainText("578,44");
  await expect(page.getByTestId("project-total")).toContainText("6482,84");
  await page
    .getByLabel("Proveedor del recurso 2", { exact: true })
    .selectOption("Azure");
  await expect(page.getByRole("alert")).toContainText("Consolida");
  await expect(
    page.getByRole("button", { name: "Proyecto JSON", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Proveedor del recurso 2", { exact: true })
    .selectOption("AWS");
  expect(
    JSON.parse(
      (await downloaded(page, "Proyecto JSON")).toString(),
    ).resources.map((r: any) => r.provider),
  ).toEqual(["Azure", "AWS"]);
  expect((await downloaded(page, "Proyecto CSV")).toString()).toContain(
    "6482.84",
  );
  await page
    .getByTestId("project-resource")
    .first()
    .getByRole("button", { name: "Abrir recurso en calculadora" })
    .click();
  await expect(page.getByLabel("Mes 1: horas", { exact: true })).toHaveValue(
    "0",
  );
  await page.getByRole("button", { name: "Proyectos", exact: true }).click();
  await expect(page.getByTestId("project-resource")).toHaveCount(2);
  await expect(page.getByTestId("project-total")).toContainText("6482,84");
  await load(page, { model: "broken" });
  await expect(
    page.locator(".project-panel").getByRole("status"),
  ).toContainText("Proyecto:");
  await expect(page.getByTestId("project-total")).toContainText("6482,84");
  await page.screenshot({
    path: info.outputPath("projects.png"),
    fullPage: true,
  });
});
test("guarda copia normalizada y solicita el diálogo PDF mediante IPC", async ({
  page,
}) => {
  await page.addInitScript((p) => {
    const w = window as any;
    w.isTauri = true;
    w.__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        if (command === "list_projects")
          return Promise.resolve([JSON.stringify(p), "invalid"]);
        if (command === "list_budgets") return Promise.resolve([]);
        if (command === "save_project") {
          w.savedProject = JSON.parse(args.data);
          return Promise.resolve();
        }
        if (command === "save_project_pdf") {
          w.pdfArgs = args;
          return Promise.resolve({
            saved: !w.cancelPdf,
            pages: 3,
            monthly: "578.44",
            total: "6482.84",
          });
        }
        return Promise.reject(Error(command));
      },
    };
  }, raw);
  await open(page);
  await page
    .getByRole("button", { name: "Abrir proyecto", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Guardar proyecto", exact: true })
    .click();
  await expect(
    page.locator(".project-panel").getByRole("status"),
  ).toContainText("Proyecto guardado");
  expect(
    await page.evaluate(() => (window as any).savedProject.resources.length),
  ).toBe(2);
  await page
    .getByRole("button", { name: "Generar PDF del proyecto", exact: true })
    .click();
  await expect(
    page.locator(".project-panel").getByRole("status"),
  ).toContainText("PDF guardado: 3 páginas");
  expect(await page.evaluate(() => (window as any).pdfArgs.expectedTotal)).toBe(
    "6482.84",
  );
  await page.evaluate(() => {
    (window as any).cancelPdf = true;
  });
  await page
    .getByRole("button", { name: "Generar PDF del proyecto", exact: true })
    .click();
  await expect(
    page.locator(".project-panel").getByRole("status"),
  ).toContainText("Exportación PDF cancelada");
  await expect(page.getByTestId("project-total")).toContainText("6482,84");
});
test("descarta el estado de un PDF tardío si el proyecto cambia", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.isTauri = true;
    w.__TAURI_INTERNALS__ = {
      invoke: (command: string) => {
        if (command.startsWith("list_")) return Promise.resolve([]);
        if (command === "save_project_pdf")
          return new Promise((resolve) => (w.finishPdf = resolve));
        return Promise.reject(Error(command));
      },
    };
  });
  await open(page);
  await load(page, raw);
  await page.getByRole("button", { name: "Generar PDF del proyecto" }).click();
  await page
    .getByLabel("Nombre del proyecto", { exact: true })
    .fill("Proyecto editado");
  await page.evaluate(async () => {
    (window as any).finishPdf({
      saved: true,
      pages: 3,
      monthly: "578.44",
      total: "6482.84",
    });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await expect(
    page.getByLabel("Nombre del proyecto", { exact: true }),
  ).toHaveValue("Proyecto editado");
  await expect(page.locator(".project-panel").getByRole("status")).toHaveCount(
    0,
  );
});
