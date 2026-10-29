#!/usr/bin/env bash
set -euo pipefail
: "${TAURI_DRIVER_BINARY:?Configura la ruta de tauri-driver}"
: "${TAURI_TEST_BINARY:?Configura la ruta del ejecutable de pruebas}"
# Aislar todos los datos de usuario de la aplicación bajo un directorio temporal.
native_test_dir=$(mktemp -d)
export XDG_DATA_HOME="$native_test_dir/data"
export XDG_CONFIG_HOME="$native_test_dir/config"
export XDG_CACHE_HOME="$native_test_dir/cache"
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"
"$TAURI_DRIVER_BINARY" > tauri-driver.log 2>&1 &
native_driver_pid=$!
cleanup() {
  kill "$native_driver_pid" 2>/dev/null || true
  wait "$native_driver_pid" 2>/dev/null || true
  rm -rf "$native_test_dir"
}
trap cleanup EXIT
node scripts/native-smoke.mjs
