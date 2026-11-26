import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock("./db", () => ({ sql: mocks.sql }));
import { notifyN8n } from "./n8n";

describe("avisos de respaldo a n8n", () => {
  beforeEach(() => {
    vi.stubEnv("N8N_WEBHOOK_URL", "https://n8n.test/webhook/turnia-eventos");
    vi.stubEnv("AGENT_TOOLS_SECRET", "firma-ficticia");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("firma el evento axel.aviso y devuelve si el webhook lo aceptó", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await notifyN8n("axel.aviso", { texto: "Prueba ficticia" })).toBe(true);
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://n8n.test/webhook/turnia-eventos");
    expect(new Headers(options.headers).get("x-turnia-secret")).toBe("firma-ficticia");
    expect(JSON.parse(String(options.body))).toMatchObject({ event: "axel.aviso", texto: "Prueba ficticia", sent_at: expect.any(String) });
  });
  it("un HTTP 401 o 500 no se presenta como un aviso aceptado", async () => {
    for (const status of [401, 500]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status })));
      expect(await notifyN8n("axel.aviso", { texto: "Prueba ficticia" })).toBe(false);
    }
  });
  it("una caída de n8n devuelve fallo sin cortar el flujo principal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Caída simulada"); }));
    expect(await notifyN8n("axel.aviso", { texto: "Prueba ficticia" })).toBe(false);
  });
  it("sin webhook o con una clínica demo no manda nada", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    vi.stubEnv("N8N_WEBHOOK_URL", "");
    expect(await notifyN8n("axel.aviso", { texto: "Prueba ficticia" })).toBe(false);
    vi.stubEnv("N8N_WEBHOOK_URL", "https://n8n.test/webhook/turnia-eventos");
    mocks.sql.mockResolvedValueOnce([{ is_demo: true }]);
    expect(await notifyN8n("tarea.creada", { clinic_id: "00000000-0000-4000-8000-000000000111" })).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
