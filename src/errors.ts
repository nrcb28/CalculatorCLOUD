// Los errores nativos estructurados no son Error de JavaScript; String(error)
// devolvería [object Object] y ocultaría la acción necesaria al usuario.
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    const action =
      "action" in error && typeof error.action === "string" ? error.action : "";
    const host =
      "host" in error && typeof error.host === "string" ? error.host : "";
    return [error.message, action, host ? `Dominio: ${host}.` : ""]
      .filter(Boolean)
      .join(" ");
  }
  return "No se pudo completar la operación. Comprueba la conexión y vuelve a intentarlo.";
}
