import { test, expect, type Page } from "@playwright/test";

type NativeFailure = {
  code: string;
  message: string;
  action: string;
  host: string;
  retryable: boolean;
  details?: string;
};

const proxyFailure: NativeFailure = {
  code: "proxy_denied",
  message: "El proxy rechazó la conexión.",
  action: "Permite el dominio en la red del entorno.",
  host: "prices.azure.com",
  retryable: false,
};

test("actualizar desde Azure fuerza la red y consultar respeta la caché", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.isTauri = true;
    w.calls = [];
    w.__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: unknown) => {
        w.calls.push({ command, args });
        return { rates: [], fetched: new Date().toISOString(), cached: false };
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Calculadora", exact: true }).click();
  await page
    .getByRole("button", { name: "Consultar tarifas", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("No hay tarifas");
  await page
    .getByRole("button", { name: "Actualizar desde Azure", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).calls.length))
    .toBe(2);
  const calls = await page.evaluate(() => (window as any).calls);
  expect(calls[0].args.forceRefresh).toBe(false);
  expect(calls[1].args.forceRefresh).toBe(true);
});

// IPC simulado: estas pruebas verifican la reacción de la interfaz, no una
// conexión a Azure ni el diagnóstico del proxy real de este entorno.
async function rejectNativeCalls(page: Page, failure: NativeFailure) {
  await page.addInitScript(
    ({ failure }) => {
      const w = window as any;
      w.isTauri = true;
      w.nativeCalls = [];
      w.__TAURI_INTERNALS__ = {
        invoke: async (command: string) => {
          w.nativeCalls.push(command);
          throw failure;
        },
      };
    },
    { failure },
  );
}

async function expectActionableError(page: Page, failure: NativeFailure) {
  const notice = page.getByRole("status");
  await expect(notice).toContainText(failure.message);
  await expect(notice).toContainText(failure.action);
  await expect(notice).toContainText(`Dominio: ${failure.host}.`);
  await expect(notice).not.toContainText("[object Object]");
  await expect(notice).not.toContainText("Endpoint oficial accesible");
}

test("un rechazo de proxy muestra acción y dominio en acceso a proveedores", async ({
  page,
}) => {
  await rejectNativeCalls(page, proxyFailure);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Acceso a proveedores", exact: true })
    .click();
  const check = page.getByRole("button", {
    name: "Comprobar acceso",
    exact: true,
  });
  await check.click();
  await expectActionableError(page, proxyFailure);
  await expect(check).toBeEnabled();
  expect(await page.evaluate(() => (window as any).nativeCalls)).toEqual([
    "check_provider",
  ]);
});

test("una consulta bloqueada no inventa precios y permite volver a consultar", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await rejectNativeCalls(page, proxyFailure);
  await page.goto("/");
  await page.getByRole("button", { name: "Calculadora", exact: true }).click();
  const query = page.getByRole("button", {
    name: "Consultar tarifas",
    exact: true,
  });
  await query.click();
  await expectActionableError(page, proxyFailure);
  await expect(query).toBeEnabled();
  await expect(
    page
      .locator("article.metric")
      .filter({ hasText: "Computación mensual" })
      .getByRole("heading"),
  ).toHaveText("—");
  await expect(
    page.getByText("Todavía no hay tarifas consultadas", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Guardar presupuesto", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Producto / SKU / precio por hora")).toHaveCount(
    0,
  );
  expect(await page.evaluate(() => (window as any).nativeCalls)).toEqual([
    "azure_prices",
  ]);
  expect(errors).toEqual([]);
});

test("un fallo TLS indica cómo instalar una CA de confianza sin exponer detalles", async ({
  page,
}) => {
  const failure: NativeFailure = {
    code: "tls",
    message: "No se pudo validar el certificado TLS del servidor.",
    action:
      "Instala el certificado de la CA corporativa de confianza en el almacén del sistema.",
    host: "prices.azure.com",
    retryable: false,
    details:
      "https://test-user:test-password@example.invalid/?token=test-only-token",
  };
  await rejectNativeCalls(page, failure);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Acceso a proveedores", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Comprobar acceso", exact: true })
    .click();
  await expectActionableError(page, failure);
  await expect(page.getByRole("status")).not.toContainText("test-only-token");
  await expect(page.getByRole("status")).not.toContainText("test-password");
  await expect(
    page.getByRole("button", { name: "Comprobar acceso", exact: true }),
  ).toBeEnabled();
});
