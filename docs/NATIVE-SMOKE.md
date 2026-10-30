# Prueba nativa Linux: WebView, IPC y SQLite

El job Linux de [Actions 40881103267](https://github.com/nrcb28/CalculatorCLOUD/actions/runs/40881103267)
completó el 29 de octubre de 2026 la prueba con la aplicación real compilada.
La ejecución global inicial detectó además un fallo en las pruebas HTTP locales
de Windows, corregido en la revisión posterior; el resultado Linux es específico
del job, no un aprobado de toda esa ejecución.

Con tauri-driver 2.1.0, WebKitWebDriver, Xvfb y D-Bus, la prueba:

1. Abre el ejecutable Tauri compilado con su WebView real.
2. Importa un escenario sintético exclusivo de pruebas mediante la interfaz.
3. Pulsa «Guardar presupuesto» y espera la confirmación del comando Rust real.
4. Cierra la sesión y abre de nuevo la aplicación.
5. Consulta el historial SQLite mediante IPC y reabre el escenario.
6. El recorrido ampliado guarda también un escenario con disco y red, conserva
   ambos presupuestos y recupera 266,00 USD del escenario nuevo después de reiniciar.
   Los importes son sintéticos exclusivos de prueba. Se guarda una captura.

No se reemplazan los comandos IPC. El directorio XDG temporal permanece entre
las dos sesiones y se elimina al terminar; nunca se usa una base del usuario.
La captura y el registro del controlador están en el artefacto
`native-smoke-Linux` de Actions. El dato sintético no entra en producción.

Para reproducir en Linux con las dependencias del workflow instaladas:

```sh
npm ci
npm run tauri -- build --bundles deb,appimage
cargo install tauri-driver --version 2.1.0 --locked
export TAURI_DRIVER_BINARY="$(command -v tauri-driver)"
export TAURI_TEST_BINARY="$PWD/src-tauri/target/release/cloudcost-compare"
xvfb-run -a dbus-run-session -- bash scripts/native-smoke.sh
```

Esto acredita el arranque del ejecutable Linux, el WebView, IPC y persistencia
entre sesiones. No instala los paquetes .deb/AppImage, no prueba Windows
manualmente y no consulta Azure. La conectividad Azure real se comprueba por
separado en [AZURE-LIVE.md](AZURE-LIVE.md) y [SQLITE-LIVE.md](SQLITE-LIVE.md).
