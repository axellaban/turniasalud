import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { POST as logout } from "../logout/route";
import { SESSION_COOKIE, safeNext, verifySessionToken } from "@/lib/session";

const login = (fields: Record<string, string>) => {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return POST(new Request("https://turnia.test/api/panel/login", { method: "POST", body }));
};

describe("Login del panel por formulario", () => {
  beforeEach(() => { vi.stubEnv("PANEL_PASSWORD", "clave-correcta"); vi.stubEnv("SESSION_SECRET", "test-session"); });
  afterEach(() => vi.unstubAllEnvs());

  it("con la contraseña correcta guarda la sesión y vuelve al destino pedido", async () => {
    const res = await login({ password: "clave-correcta", next: "/panel/clinicas" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://turnia.test/panel/clinicas");
    const cookie = res.cookies.get(SESSION_COOKIE);
    expect(verifySessionToken(cookie?.value)).toBe(true);
    expect(cookie?.httpOnly).toBe(true);
  });

  it("con la contraseña incorrecta vuelve al login con el aviso y conserva el destino", async () => {
    const res = await login({ password: "otra", next: "/panel/clinicas" });
    expect(res.status).toBe(303);
    const url = new URL(res.headers.get("location")!);
    expect(url.pathname).toBe("/panel/login");
    expect(url.searchParams.get("next")).toBe("/panel/clinicas");
    expect(url.searchParams.get("error")).toBe("password");
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("sin PANEL_PASSWORD no deja entrar", async () => {
    vi.stubEnv("PANEL_PASSWORD", "");
    const res = await login({ password: "", next: "/panel" });
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("config");
  });

  it("solo redirige a rutas propias del panel", () => {
    expect(safeNext("/panel/clinicas")).toBe("/panel/clinicas");
    expect(safeNext("/demo")).toBe("/demo");
    expect(safeNext("/panel/demos?q=Telegram")).toBe("/panel/demos?q=Telegram");
    expect(safeNext("/panel/configuracion/equipo")).toBe("/panel/configuracion/equipo");
    for (const bad of ["https://evil.test", "//evil.test", "/panel/login", "/panel/clinica", "/panel/no-existe", "/otra", undefined, ["/panel"]]) expect(safeNext(bad)).toBe("/panel");
  });

  it("rechaza formularios enviados desde otro sitio", async () => {
    const body = new FormData(); body.set("password", "clave-correcta"); body.set("next", "/panel");
    const res = await POST(new Request("https://turnia.test/api/panel/login", { method: "POST", body, headers: { origin: "https://evil.test" } }));
    expect(res.status).toBe(403);
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
    const same = await POST(new Request("https://turnia.test/api/panel/login", { method: "POST", body, headers: { origin: "https://turnia.test" } }));
    expect(same.status).toBe(303);
    expect((await logout(new Request("https://turnia.test/api/panel/logout", { method: "POST", headers: { origin: "https://evil.test" } }))).status).toBe(403);
  });

  it("rechaza formularios enviados desde otro sitio", async () => {
    const body = new FormData(); body.set("password", "clave-correcta"); body.set("next", "/panel");
    const res = await POST(new Request("https://turnia.test/api/panel/login", { method: "POST", body, headers: { origin: "https://evil.test" } }));
    expect(res.status).toBe(403);
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
    const same = await POST(new Request("https://turnia.test/api/panel/login", { method: "POST", body, headers: { origin: "https://turnia.test" } }));
    expect(same.status).toBe(303);
    expect((await logout(new Request("https://turnia.test/api/panel/logout", { method: "POST", headers: { origin: "https://evil.test" } }))).status).toBe(403);
  });

  it("cerrar sesión borra la cookie", async () => {
    const res = await logout(new Request("https://turnia.test/api/panel/logout", { method: "POST" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://turnia.test/panel/login");
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=;`);
  });
});
