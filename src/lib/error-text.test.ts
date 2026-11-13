import { describe, expect, it } from "vitest";
import { SIN_CONEXION, errorText } from "./error-text";

describe("texto de un error para mostrar en la web", () => {
  it("sin conexión dice qué pasó y qué hacer, no «Failed to fetch»", () => {
    expect(errorText(new TypeError("Failed to fetch"), "No se pudo abrir la demo.")).toBe(SIN_CONEXION);
    expect(errorText(new TypeError("Load failed"), "No se pudo abrir la demo.")).toBe(SIN_CONEXION);
  });

  it("una respuesta que no es JSON muestra el mensaje de siempre", () => {
    expect(errorText(new SyntaxError("Unexpected token '<'"), "No se pudo abrir la demo.")).toBe("No se pudo abrir la demo.");
  });

  it("los mensajes propios se muestran tal cual", () => {
    expect(errorText(new Error("Revisá la dirección web."), "x")).toBe("Revisá la dirección web.");
    expect(errorText("algo raro", "No se pudo abrir la demo.")).toBe("No se pudo abrir la demo.");
  });
});
