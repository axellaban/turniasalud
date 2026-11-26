import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

const mocks = vi.hoisted(() => ({ alerts: vi.fn(async (text: string) => text.length > 0) }));
vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn(async () => {}) }));
vi.mock("@/lib/chat-guard", async (original) => ({
  ...(await original<typeof import("@/lib/chat-guard")>()), notifyAxel: mocks.alerts,
}));
const url = testDatabaseUrl();

// Easypanel y dos WAHA simulados. Todo ficticio: ninguna clave ni número real.
const TOKEN = "token-ficticio-easypanel";
const PANEL = "https://panel.test/api";
type Fake = { status: string; started: number; reachable: boolean; me: string; lock?: boolean; capping?: string };
let lines: Record<string, Fake>;
let memoryPct: number;
let containerMb: number;
let calls: Array<{ url: string; method: string; key: string | null }>;

function fakeFetch(input: string | URL | Request, init: RequestInit = {}) {
  const u = new URL(String(input));
  const headers = new Headers(init.headers);
  calls.push({ url: u.toString(), method: init.method ?? "GET", key: headers.get("x-api-key") });
  if (u.host === "panel.test") {
    expect(headers.get("authorization")).toBe("Bearer " + TOKEN);
    const path = u.pathname.replace("/api/", "");
    if (path === "getLegacyMonitorSystemStats") return Response.json({ cpuInfo: { usedPercentage: 3, loadavg: [0.1] }, diskInfo: { usedPercentage: "46.6" }, memInfo: { usedMemPercentage: memoryPct, freeMemMb: 400 } });
    if (path === "getMonitorTableData") return Response.json([
      { projectName: "n8n", serviceName: "waha", stats: { memory: { usage: 300 * 1048576 } } },
      { projectName: "n8n", serviceName: "consultorio-waha", stats: { memory: { usage: containerMb * 1048576 } } },
    ]);
    if (path === "listProjectsAndServices") return Response.json({ projects: [], services: [
      { projectName: "n8n", name: "waha", type: "app", enabled: true, source: { image: "devlikeapro/waha:noweb" } },
      { projectName: "n8n", name: "consultorio-waha", type: "app", enabled: true, source: { image: "devlikeapro/waha@sha256:abc" }, resources: { memoryLimit: 768 } },
      { projectName: "n8n", name: "n8n", type: "app", enabled: true, source: { image: "n8nio/n8n" } },
    ] });
    if (path === "inspectAppService") return Response.json({ env: "TZ=America/Argentina/Buenos_Aires\nWAHA_API_KEY=clave-" + u.searchParams.get("serviceName") });
    throw new Error("Easypanel inesperado: " + path);
  }
  const service = u.host.replace(".panel.test", "").replace(/^n8n-/, "");
  const fake = lines[service];
  if (!fake) throw new Error("Host inesperado " + u.host);
  if (!fake.reachable) throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
  expect(headers.get("x-api-key")).toBe("clave-" + service);
  if (u.pathname === "/api/sessions") return Response.json([{ name: "default", status: fake.status, me: { id: fake.me + "@c.us" }, config: { webhooks: [] } }]);
  if (u.pathname === "/api/sessions/default/me") return Response.json({
    id: fake.me + "@c.us",
    reachoutTimelock: { enforcementType: "DEFAULT", isActive: Boolean(fake.lock), timeEnforcementEnds: fake.lock ? "2026-11-27T18:00:00Z" : null },
    messageCapping: { cappingStatus: fake.capping ?? "NONE", totalQuota: -1, usedQuota: 0 },
  });
  if (u.pathname === "/api/server/status") return Response.json({ startTimestamp: fake.started, uptime: 1 });
  if (u.pathname === "/api/server/version") return Response.json({ version: "2026.9.2" });
  throw new Error("WAHA inesperado " + u.pathname);
}

describe.runIf(url)("radar de WAHA y del VPS con Easypanel simulado", () => {
  let sql: typeof import("@/lib/db").sql;
  let radar: typeof import("@/lib/infra-radar");

  beforeAll(async () => {
    const db = await scratchDatabase(url!, "turnia_infra_radar_test");
    await resetTestDatabase(db);
    vi.stubEnv("DATABASE_URL", db);
    vi.stubEnv("EASYPANEL_API_URL", PANEL);
    vi.stubEnv("EASYPANEL_API_TOKEN", TOKEN);
    ({ sql } = await import("@/lib/db"));
    radar = await import("@/lib/infra-radar");
    vi.stubGlobal("fetch", vi.fn(async (i: string | URL | Request, init?: RequestInit) => fakeFetch(i, init)));
  });
  beforeEach(async () => {
    await sql`truncate infra_radar_state, infra_radar_events, infra_radar_samples`;
    mocks.alerts.mockClear();
    calls = [];
    memoryPct = 70;
    containerMb = 300;
    lines = {
      waha: { status: "WORKING", started: Date.parse("2026-11-07T14:59:33Z"), reachable: true, me: "5491100003765" },
      "consultorio-waha": { status: "WORKING", started: Date.parse("2026-11-19T12:53:00Z"), reachable: true, me: "5491100005483" },
    };
  });
  afterAll(async () => { await sql?.end(); });

  it("la primera corrida es el punto de partida: guarda estado y muestra, sin avisar", async () => {
    const result = await radar.runInfraRadar();
    expect(result).toMatchObject({ configured: true, ram: 70, disco: 46.6, avisos: 0 });
    expect(result.configured && result.instancias).toEqual([
      { servicio: "n8n/consultorio-waha", ok: true, sesiones: ["…5483 WORKING"] },
      { servicio: "n8n/waha", ok: true, sesiones: ["…3765 WORKING"] },
    ]);
    expect(mocks.alerts).not.toHaveBeenCalled();
    expect(await sql`select id from infra_radar_samples`).toHaveLength(1);
    // Solo lee: nunca un POST, ni a WAHA ni a Easypanel.
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("avisa la caída, el reinicio y la vuelta de una sesión, una vez cada una", async () => {
    await radar.runInfraRadar();
    lines.waha.status = "FAILED";
    await radar.runInfraRadar();
    await radar.runInfraRadar();
    expect(mocks.alerts).toHaveBeenCalledTimes(1);
    expect(mocks.alerts.mock.calls[0][0]).toContain("…3765) pasó de WORKING a FAILED en n8n/waha");
    lines.waha.status = "WORKING";
    lines.waha.started = Date.parse("2026-11-26T15:00:00Z");
    await radar.runInfraRadar();
    expect(mocks.alerts).toHaveBeenCalledTimes(2);
    expect(mocks.alerts.mock.calls[1][0]).toMatch(/se reinició[\s\S]*volvió a WORKING/);
    expect((await sql`select kind, detail->>'to' as to from infra_radar_events where subject like 'n8n/waha%' order by created_at`).map((e) => e.kind + ":" + (e.to ?? "")))
      .toEqual(["session:WORKING", "session:FAILED", "restart:2026-11-26T15:00:00.000Z", "session:WORKING"]);
  });

  it("avisa RAM alta del VPS y un contenedor cerca de su tope, con pausa entre avisos", async () => {
    memoryPct = 95;
    containerMb = 700;
    await radar.runInfraRadar();
    await radar.runInfraRadar();
    expect(mocks.alerts).toHaveBeenCalledTimes(1);
    const text = mocks.alerts.mock.calls[0][0];
    expect(text).toContain("RAM del VPS al 95 %");
    expect(text).toContain("n8n/consultorio-waha usa 700 de 768 MB");
  });

  it("si una WAHA deja de responder lo avisa, y no confunde eso con una sesión caída", async () => {
    await radar.runInfraRadar();
    lines["consultorio-waha"].reachable = false;
    await radar.runInfraRadar();
    expect(mocks.alerts.mock.calls[0][0]).toContain("n8n/consultorio-waha no responde (No respondió a tiempo)");
    lines["consultorio-waha"].reachable = true;
    await radar.runInfraRadar();
    expect(mocks.alerts.mock.calls[1][0]).toContain("volvió a responder");
    expect(mocks.alerts.mock.calls[1][0]).not.toContain("WORKING");
  });

  it("si WhatsApp frena la línea (bloqueo temporal o tope), avisa que NO hay que reiniciar", async () => {
    await radar.runInfraRadar();
    lines.waha.lock = true;
    await radar.runInfraRadar();
    await radar.runInfraRadar();
    expect(mocks.alerts).toHaveBeenCalledTimes(1);
    expect(mocks.alerts.mock.calls[0][0]).toMatch(/frenó la línea \(…3765\)[\s\S]*bloqueo temporal hasta 27\/11[\s\S]*NO reiniciar/);
    lines.waha.lock = false;
    lines.waha.capping = "FIRST_WARNING";
    await radar.runInfraRadar();
    expect(mocks.alerts.mock.calls[1][0]).toContain("primer aviso");
    lines.waha.capping = "NONE";
    await radar.runInfraRadar();
    expect(mocks.alerts.mock.calls[2][0]).toContain("ya puede escribir a contactos nuevos");
    // Una sesión caída nunca se confunde con un bloqueo: el aviso de caída dice que se reinicie primero.
    lines.waha.status = "FAILED";
    await radar.runInfraRadar();
    expect(mocks.alerts.mock.calls[3][0]).toContain("primero reiniciar");
  });

  it("restrictionOf interpreta lo que devuelve WAHA", () => {
    expect(radar.restrictionOf(null)).toBeNull();
    expect(radar.restrictionOf({ reachoutTimelock: { isActive: false }, messageCapping: { cappingStatus: "NONE" } })).toBeNull();
    expect(radar.restrictionOf({ messageCapping: { cappingStatus: "CAPPED" } })).toBe("tope de contactos nuevos alcanzado");
    expect(radar.restrictionOf({ reachoutTimelock: { isActive: true, timeEnforcementEnds: null } })).toBe("bloqueo temporal");
  });

  it("no guarda claves en la base", async () => {
    lines.waha.status = "SCAN_QR_CODE";
    await radar.runInfraRadar();
    const dump = JSON.stringify([await sql`select * from infra_radar_state`, await sql`select * from infra_radar_events`, await sql`select * from infra_radar_samples`]);
    expect(dump).not.toContain("clave-");
    expect(dump).not.toContain(TOKEN);
    expect(dump).not.toContain("5491100003765");
  });

  it("el aviso session.status del webhook se guarda al instante y avisa la caída y la vuelta", async () => {
    const at = "2026-11-26T15:00:00.000Z";
    expect(await radar.recordSessionStatus({ line: "guerra-mininni", session: "default", status: "WORKING", phone: "5491100003765@c.us", at })).toBeNull();
    expect(await radar.recordSessionStatus({ line: "guerra-mininni", session: "default", status: "FAILED", phone: "5491100003765@c.us", at })).toContain("…3765) pasó a FAILED");
    expect(await radar.recordSessionStatus({ line: "guerra-mininni", session: "default", status: "FAILED", phone: "5491100003765@c.us", at })).toBeNull();
    expect(await radar.recordSessionStatus({ line: "guerra-mininni", session: "default", status: "STARTING", phone: null, at })).toBeNull();
    expect(await radar.recordSessionStatus({ line: "guerra-mininni", session: "default", status: "WORKING", phone: "5491100003765@c.us", at })).toContain("volvió a WORKING");
    expect(mocks.alerts).toHaveBeenCalledTimes(2);
    expect((await sql`select detail->>'to' as to from infra_radar_events where kind = 'webhook_status' order by created_at`).map((e) => e.to))
      .toEqual(["WORKING", "FAILED", "STARTING", "WORKING"]);
  });

  it("de los logs guarda solo lo importante, sin teléfonos ni repetidos, y avisa una vez", async () => {
    const lines = [
      { at: "10:00:00", level: "INFO", text: "request completed {\"url\":\"/api/sendText\"}" },
      { at: "10:00:01", level: "INFO", text: "session:default - POST request was sent with status code: 200" },
      { at: "10:00:02", level: "WARN", text: "session:default - Connection closed, reconnecting... chat 5491100001234@c.us {\"pushName\":\"Fulana Prueba\"}" },
      { at: "10:00:02", level: "WARN", text: "session:default - got update for non-existent contact. update: '{\"notify\":\"Otra Persona\"}'" },
      { at: "10:00:03", level: "INFO", text: "session:default - Session status changed to FAILED, reason: logged out (401)" },
    ];
    expect(await radar.ingestWahaLogs("n8n/waha", lines)).toEqual({ saved: 2, important: 2 });
    expect(await radar.ingestWahaLogs("n8n/waha", lines)).toEqual({ saved: 0, important: 0 });
    expect(mocks.alerts).toHaveBeenCalledTimes(1);
    expect(mocks.alerts.mock.calls[0][0]).toContain("logged out");
    const dump = JSON.stringify(await sql`select detail from infra_radar_events where kind = 'log'`);
    expect(dump).not.toContain("5491100001234");
    expect(dump).toContain("…1234@c.us");
    expect(dump).not.toContain("Fulana");
    expect(dump).not.toContain("Otra Persona");
  });

  it("la clave del lector de logs sale del token y se verifica sin compararlo a mano", async () => {
    const secret = createHmac("sha256", TOKEN).update("turnia-waha-radar").digest("hex");
    expect(radar.radarLogSecret()).toBe(secret);
    expect(radar.verifyRadarSecret("Bearer " + secret)).toBe(true);
    expect(radar.verifyRadarSecret("Bearer " + TOKEN)).toBe(false);
    expect(radar.verifyRadarSecret(null)).toBe(false);
    // Pegado con las comillas del archivo .env: da lo mismo.
    vi.stubEnv("EASYPANEL_API_TOKEN", "'" + TOKEN + "'");
    vi.stubEnv("EASYPANEL_API_URL", "\"" + PANEL + "/\"");
    expect(radar.radarLogSecret()).toBe(secret);
    expect(radar.easypanelConfig()).toMatchObject({ url: PANEL, host: "panel.test" });
    // Y con «Bearer » adelante o como la línea entera del archivo.
    vi.stubEnv("EASYPANEL_API_TOKEN", "Bearer " + TOKEN);
    expect(radar.radarLogSecret()).toBe(secret);
    vi.stubEnv("EASYPANEL_API_TOKEN", "EASYPANEL_API_TOKEN=\"" + TOKEN + "\"");
    expect(radar.radarLogSecret()).toBe(secret);
    // La huella deja comparar tokens sin mostrarlos.
    const fp = radar.radarTokenFingerprint()!;
    expect(fp).toEqual({ largo: TOKEN.length, huella: createHash("sha256").update(TOKEN).digest("hex").slice(0, 8) });
    expect(JSON.stringify(fp)).not.toContain(TOKEN);
    vi.stubEnv("EASYPANEL_API_TOKEN", TOKEN);
    vi.stubEnv("EASYPANEL_API_URL", PANEL);
  });
});
