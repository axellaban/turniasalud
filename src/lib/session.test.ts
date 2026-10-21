import { beforeAll, describe, expect, it } from "vitest";
import { createSessionToken, passwordMatches, verifySessionToken } from "./session";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret";
  process.env.PANEL_PASSWORD = "clave-de-prueba";
});

describe("sesión del panel", () => {
  it("acepta un token recién creado", () => {
    expect(verifySessionToken(createSessionToken())).toBe(true);
  });

  it("rechaza tokens vencidos", () => {
    const old = createSessionToken(Date.now() - 30 * 86400_000);
    expect(verifySessionToken(old)).toBe(false);
  });

  it("rechaza tokens adulterados", () => {
    const token = createSessionToken();
    const tampered = token.replace("panel.", "panel.9");
    expect(verifySessionToken(tampered)).toBe(false);
    expect(verifySessionToken("cualquier-cosa")).toBe(false);
    expect(verifySessionToken(undefined)).toBe(false);
  });

  it("compara la contraseña", () => {
    expect(passwordMatches("clave-de-prueba")).toBe(true);
    expect(passwordMatches("otra")).toBe(false);
  });
});
