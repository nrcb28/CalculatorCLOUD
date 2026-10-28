import { describe, it, expect } from "vitest";
import { errorMessage } from "./errors";
describe("mensajes de conexión", () => {
  it("muestra los errores nativos con la acción y el dominio", () => {
    expect(
      errorMessage({
        code: "proxy_denied",
        message: "El proxy rechazó la conexión.",
        action: "Permite el dominio en la red.",
        host: "prices.azure.com",
        retryable: false,
      }),
    ).toBe(
      "El proxy rechazó la conexión. Permite el dominio en la red. Dominio: prices.azure.com.",
    );
  });
  it("mantiene compatibilidad con cadenas y errores JS", () => {
    expect(errorMessage("Error SQL")).toBe("Error SQL");
    expect(errorMessage(new Error("Archivo inválido"))).toBe(
      "Archivo inválido",
    );
  });
  it("no expone campos adicionales ni serializa objetos de error", () => {
    const result = errorMessage({
      message: "Fallo de proxy",
      url: "https://user:password@example.test/?key=secret",
      headers: { Authorization: "secret" },
    });
    expect(result).toBe("Fallo de proxy");
    expect(result).not.toContain("secret");
    expect(errorMessage(null)).not.toBe("[object Object]");
  });
});
