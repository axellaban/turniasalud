import { beforeAll, describe, expect, it } from "vitest";
import { createClinicSessionToken, createSessionToken, isAdminSessionToken, passwordMatches, readSessionToken, verifySessionToken } from "./session";

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

  it("distingue la sesión de administrador de la de un consultorio", () => {
    const access = "00000000-0000-4000-8000-0000000000aa";
    const clinic = createClinicSessionToken(access);
    expect(readSessionToken(createSessionToken())).toEqual({ role: "admin" });
    expect(readSessionToken(clinic)).toEqual({ role: "clinic", accessId: access });
    expect(isAdminSessionToken(clinic)).toBe(false);
    expect(isAdminSessionToken(createSessionToken())).toBe(true);
    // No se puede convertir una sesión de consultorio en una de administrador.
    const [, , expires, signature] = clinic.split(".");
    expect(readSessionToken(`panel.${expires}.${signature}`)).toBeNull();
    expect(readSessionToken(clinic.replace(access, "00000000-0000-4000-8000-0000000000bb"))).toBeNull();
    expect(readSessionToken(createClinicSessionToken(access, Date.now() - 30 * 86400_000))).toBeNull();
    expect(() => createClinicSessionToken("no-es-uuid")).toThrow();
  });

  it("compara la contraseña", () => {
    expect(passwordMatches("clave-de-prueba")).toBe(true);
    expect(passwordMatches("otra")).toBe(false);
  });
});
