// Prueba de WebView e IPC reales mediante tauri-driver / WebKitWebDriver.
// No sustituye __TAURI_INTERNALS__ ni utiliza Azure o datos de producción.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
const application = process.env.TAURI_TEST_BINARY;
assert.ok(
  application,
  "Configura TAURI_TEST_BINARY con el ejecutable compilado",
);
assert.ok(
  process.env.XDG_DATA_HOME,
  "Configura XDG_DATA_HOME con un directorio de pruebas aislado",
);
const base = "http://127.0.0.1:4444";
let session;
async function request(path, body, method = "POST") {
  const response = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(35000),
  });
  const result = await response.json();
  if (!response.ok || result.value?.error)
    throw Error(JSON.stringify(result.value));
  return result.value;
}
const execute = (script, args = []) =>
  request(`/session/${session}/execute/sync`, { script, args });
async function waitFor(script) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await execute(script)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw Error(`No se cumplió: ${script}`);
}
async function start() {
  const result = await request("/session", {
    capabilities: {
      alwaysMatch: {
        "tauri:options": { application: resolve(application) },
      },
    },
  });
  session = result.sessionId;
  assert.ok(session);
  await waitFor("return !!document.querySelector('h1')");
  assert.equal(await execute("return !!window.__TAURI_INTERNALS__"), true);
}
async function click(text) {
  await execute(
    "const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === arguments[0]); if (!button) throw Error('Botón no encontrado: '+arguments[0]); button.click();",
    [text],
  );
}
async function close() {
  if (session) {
    await request(`/session/${session}`, undefined, "DELETE");
    session = undefined;
  }
}
try {
  const readyDeadline = Date.now() + 15000;
  while (true) {
    try {
      await request("/status", undefined, "GET");
      break;
    } catch (error) {
      if (Date.now() > readyDeadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  const fixture = (await import("../tests/fixtures.ts")).fixture;
  await start();
  await click("Presupuestos");
  await waitFor(
    "return document.body.textContent.includes('Importar JSON') && !document.body.textContent.includes('Cargando presupuestos…')",
  );
  await execute(
    `
    const input = document.querySelector('input[type=file]');
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(arguments[0])], 'test.json', {type:'application/json'}));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
  `,
    [fixture],
  );
  await waitFor("return document.body.textContent.includes('146,00')");
  await click("Guardar presupuesto");
  await waitFor(
    "return document.body.textContent.includes('Presupuesto guardado con una copia')",
  );
  await close();
  // Nueva ventana/proceso con el mismo directorio: leer de SQLite tras reiniciar.
  await start();
  await click("Presupuestos");
  await waitFor("return document.querySelectorAll('.history').length === 1");
  await click("Abrir escenario");
  await waitFor("return document.body.textContent.includes('146,00')");
  const screenshot = await request(
    `/session/${session}/screenshot`,
    undefined,
    "GET",
  );
  writeFileSync("native-smoke.png", Buffer.from(screenshot, "base64"));
  console.log(
    "WebView + IPC + SQLite: importar, guardar, reiniciar y recuperar aprobados.",
  );
} catch (error) {
  if (session) {
    try {
      console.error(await execute("return document.body.innerText"));
      const screenshot = await request(
        `/session/${session}/screenshot`,
        undefined,
        "GET",
      );
      writeFileSync("native-smoke.png", Buffer.from(screenshot, "base64"));
    } catch {
      /* Conservar el error original si la ventana ya se cerró. */
    }
  }
  throw error;
} finally {
  await close();
}
