// Prueba de WebView e IPC reales mediante tauri-driver / WebKitWebDriver.
// No sustituye __TAURI_INTERNALS__ ni consulta proveedores: utiliza escenarios de prueba y una tarifa pública capturada.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
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
  // Guardar también el esquema ampliado sin sustituir el escenario antiguo.
  await click("Presupuestos");
  await waitFor(
    "return document.body.textContent.includes('Importar JSON') && !document.body.textContent.includes('Cargando presupuestos…')",
  );
  const components = JSON.parse(
    readFileSync(
      new URL("../tests/components-fixture.json", import.meta.url),
      "utf8",
    ),
  );
  await execute(
    `
    const input = document.querySelector('input[type=file]');
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(arguments[0])], 'components.json', {type:'application/json'}));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
  `,
    [
      {
        ...fixture,
        config: { ...fixture.config, egress: 1000, egressUsedGB: 100 },
        components,
        usagePlan: JSON.parse(
          readFileSync(
            new URL("../tests/usage-plan-fixture.json", import.meta.url),
            "utf8",
          ),
        ),
        comparisonQuotes: [
          JSON.parse(
            readFileSync(
              new URL("../tests/aws-quote-fixture.json", import.meta.url),
              "utf8",
            ),
          ),
        ],
      },
    ],
  );
  await waitFor(
    "return document.querySelector('[data-testid=components-total]')?.textContent.includes('266,00')",
  );
  await click("Guardar presupuesto");
  await waitFor(
    "return document.body.textContent.includes('Presupuesto guardado con una copia')",
  );
  await close();
  // Nueva ventana/proceso con el mismo directorio: leer de SQLite tras reiniciar.
  await start();
  await click("Presupuestos");
  await waitFor("return document.querySelectorAll('.history').length === 2");
  await click("Abrir escenario");
  await waitFor(
    "return document.querySelector('[data-testid=components-total]')?.textContent.includes('266,00')",
  );
  await waitFor(
    "return document.querySelector('[data-testid=plan-total-Azure]')?.textContent.includes('3046,00')",
  );
  await click("Comparador");
  await waitFor(
    "return document.body.textContent.includes('m6i.xlarge') && document.body.textContent.includes('312,44')",
  );
  await click("Presupuestos");
  await waitFor("return document.querySelectorAll('.history').length === 2");
  await execute(`
    for (const [label,value] of [["Base: presupuesto guardado","saved-1"],["Objetivo: presupuesto guardado","saved-0"]]) {
      const select=document.querySelector('select[aria-label="'+label+'"]');
      select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));
    }
  `);
  await waitFor(
    "return document.querySelector('[data-testid=historical-comparison]')?.textContent.includes('Cambio de cobertura:') && document.querySelector('[data-testid=historical-comparison]')?.textContent.includes('Computación Azure')",
  );
  await click("Proyectos");
  await click("Añadir escenario de la calculadora");
  await click("Añadir escenario de la calculadora");
  await execute(`
    const select=document.querySelector('select[aria-label="Proveedor del recurso 2"]');
    select.value="AWS";select.dispatchEvent(new Event('change',{bubbles:true}));
  `);
  await waitFor(
    "return document.querySelector('[data-testid=project-total]')?.textContent.replace(/\\./g,'').includes('6482,84')",
  );
  await click("Guardar proyecto");
  await waitFor(
    "return document.body.textContent.includes('Proyecto guardado con las copias')",
  );
  await close();
  await start();
  await click("Proyectos");
  await waitFor(
    "return Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Abrir proyecto')",
  );
  await click("Abrir proyecto");
  await waitFor(
    "return document.querySelectorAll('[data-testid=project-resource]').length===2 && document.querySelector('[data-testid=project-total]')?.textContent.replace(/\\./g,'').includes('6482,84')",
  );
  await execute(`
    window.__TAURI_INTERNALS__.invoke('list_projects').then(entries=>window.__TAURI_INTERNALS__.invoke('project_pdf',{data:entries[0]})).then(pdf=>{window.nativeProjectPdf=pdf;}).catch(e=>{window.nativeProjectPdfError=String(e);});
  `);
  await waitFor(
    "return window.nativeProjectPdf?.bytes?.length>0 || !!window.nativeProjectPdfError",
  );
  const nativePdf = await execute("return window.nativeProjectPdf");
  assert.ok(nativePdf, "PDF nativo ausente");
  assert.equal(nativePdf.total, "6482.84");
  assert.equal(nativePdf.monthly, "578.44");
  assert.ok(nativePdf.pages >= 3);
  assert.equal(Buffer.from(nativePdf.bytes).subarray(0, 5).toString(), "%PDF-");
  writeFileSync("native-project.pdf", Buffer.from(nativePdf.bytes));
  const screenshot = await request(
    `/session/${session}/screenshot`,
    undefined,
    "GET",
  );
  writeFileSync("native-smoke.png", Buffer.from(screenshot, "base64"));
  console.log(
    "WebView + IPC + SQLite + PDF: presupuestos/proyectos recuperados y PDF generado en Rust.",
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
