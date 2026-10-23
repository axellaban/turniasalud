import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";
import { SESSION_COOKIE, createClinicSessionToken, createSessionToken } from "@/lib/session";

const visit = (path: string, token?: string) =>
  proxy(new NextRequest(`https://turnia.test${path}`, { headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {} }));

describe("proxy del panel", () => {
  beforeEach(() => { vi.stubEnv("SESSION_SECRET", "test-session"); vi.stubEnv("PANEL_PASSWORD", "clave"); });
  afterEach(() => vi.unstubAllEnvs());

  it("sin sesión manda al login conservando el destino", () => {
    const res = visit("/panel/agenda");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/panel/login");
    expect(new URL(res.headers.get("location")!).searchParams.get("next")).toBe("/panel/agenda");
    expect(visit("/panel/login").headers.get("location")).toBeNull();
  });

  it("el administrador entra a todo y el consultorio no llega a las secciones de Turnia", () => {
    const admin = createSessionToken();
    const clinic = createClinicSessionToken("00000000-0000-4000-8000-0000000000aa");
    for (const path of ["/panel/sistema", "/panel/clinicas", "/panel/demos", "/panel/agenda"]) expect(visit(path, admin).headers.get("location")).toBeNull();
    for (const path of ["/panel/sistema", "/panel/clinicas", "/panel/demos/x"]) expect(visit(path, clinic).headers.get("location")).toBe("https://turnia.test/panel");
    for (const path of ["/panel/configuracion/equipo", "/panel/agenda", "/demo"]) expect(visit(path, clinic).headers.get("location")).toBeNull();
  });
});
