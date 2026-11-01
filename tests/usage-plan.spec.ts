import { test, expect, type Page } from "@playwright/test";
import { fixture } from "./fixtures";
import plan from "./usage-plan-fixture.json" with { type: "json" };
import components from "./components-fixture.json" with { type: "json" };
async function load(page: Page, value: unknown) {
  await page.getByRole("button", { name: "Presupuestos", exact: true }).click();
  await page
    .getByLabel("Importar presupuesto JSON", { exact: true })
    .setInputFiles({
      name: "plan.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(value)),
    });
}
async function downloaded(page: Page, label: string) {
  const d = page.waitForEvent("download");
  await page.getByRole("button", { name: label, exact: true }).click();
  const stream = await (await d).createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream!) chunks.push(c);
  return Buffer.concat(chunks).toString();
}
test("crea, edita y exporta el plan manteniendo el mes base", async ({
  page,
}) => {
  await page.goto("/");
  await load(page, fixture);
  await page.getByRole("button", { name: "Crear plan de doce meses" }).click();
  await expect(page.getByTestId("plan-total-Azure")).toContainText("1752,00");
  await page.getByLabel("Mes 1: horas", { exact: true }).fill("0");
  await expect(page.getByTestId("plan-total-Azure")).toContainText("1606,00");
  await expect(page.locator(".metric").first()).toContainText("146,00");
  const s = JSON.parse(await downloaded(page, "JSON"));
  expect(s.usagePlan).toEqual(plan);
  expect(s.config.hours).toBe(730);
  expect(await downloaded(page, "CSV")).toContain("Total plan de doce meses");
  await page.getByLabel("Mes 1: instancias", { exact: true }).fill("0");
  await expect(
    page.getByRole("button", { name: "Guardar presupuesto", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Reiniciar con consumo base" })
    .click();
  await expect(page.getByTestId("plan-total-Azure")).toContainText("1752,00");
  await page.getByRole("button", { name: "Quitar plan mensual" }).click();
  expect(JSON.parse(await downloaded(page, "JSON")).usagePlan).toBeUndefined();
});
test("recupera plan importado con cargos de disco/red a cero horas y limpia al abrir legado", async ({
  page,
}, info) => {
  await page.goto("/");
  await load(page, {
    ...fixture,
    config: { ...fixture.config, egress: 1000, egressUsedGB: 100 },
    components,
    usagePlan: plan,
  });
  await expect(page.getByTestId("plan-total-Azure")).toContainText("3046,00");
  await expect(page.getByTestId("components-total")).toContainText("266,00");
  await page
    .getByTestId("usage-plan")
    .screenshot({ path: info.outputPath("usage-plan.png") });
  await load(page, fixture);
  await expect(
    page.getByRole("button", { name: "Crear plan de doce meses" }),
  ).toBeVisible();
  await expect(page.getByLabel("Mes 1: horas", { exact: true })).toHaveCount(0);
});
