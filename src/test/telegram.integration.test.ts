import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

const mocks = vi.hoisted(() => ({ after: [] as Array<() => unknown>, session: undefined as string | undefined }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (fn: () => unknown) => mocks.after.push(fn) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => mocks.session ? { value: mocks.session } : undefined }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn() }));
vi.mock("@/lib/demo/scraper", async (original) => ({ ...(await original<typeof import("@/lib/demo/scraper")>()), scrapeSite: vi.fn(async (url: string) => ({ url, pages: [{ url, text: "Clínica Telegram" }] })) }));
vi.mock("@/lib/demo/profile", () => ({ buildProfile: vi.fn(async () => ({ nombre: "Clínica Telegram", especialidad: "Cardiología", direccion: "Calle 123", telefono: null, descripcion: "Consultorio de prueba", horario_texto: null, horarios: [], coberturas: ["Particular"], profesionales: [], prestaciones: [], preguntas_frecuentes: null, politicas: null })) }));

const base = testDatabaseUrl();
const CHANNEL = "https://api.elevenlabs.io/custom-test";
const calls: Array<{ url: string; body: Record<string, unknown> | FormData }> = [];
let webhook = "";
let username = "TurnIA_salud_bot";
let updateId = 0;
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input);
  const body = init.body instanceof FormData ? init.body : JSON.parse(String(init.body || "{}"));
  calls.push({ url, body });
  if (url === CHANNEL) return json({ conversation_id: `conv_tg_${updateId}`, status: "queued" });
  if (url.includes("/speech-to-text")) return json({ text: "Quiero un turno para mañana" });
  if (url.includes("/text-to-speech/")) return new Response(new Uint8Array([79, 103, 103, 83]), { headers: { "Content-Type": "audio/ogg" } });
  if (url === "https://api.telegram.org/file/bottest-private/voice/test.oga") return new Response(new Uint8Array([1, 2, 3]));
  if (url.startsWith("https://api.telegram.org/bottest-private/")) {
    const method = url.split("/").at(-1);
    if (method === "getMe") return json({ ok: true, result: { username } });
    if (method === "getWebhookInfo") return json({ ok: true, result: { url: webhook } });
    if (method === "setWebhook") { webhook = (body as { url: string }).url; return json({ ok: true, result: true }); }
    if (method === "getFile") return json({ ok: true, result: { file_path: "voice/test.oga", file_size: 3 } });
    if (method === "sendMessage" || method === "sendVoice") return json({ ok: true, result: { message_id: 1 } });
  }
  if (url === "https://waha.test/api/sendText") return json({ id: "wa_1" });
  throw new Error("Servicio inesperado en una prueba aislada");
}

const tgCalls = (method: string) => calls.filter((c) => c.url.endsWith(`/${method}`));
const texts = () => tgCalls("sendMessage").map((c) => (c.body as { text: string }).text);

describe.runIf(base)("Telegram y selector de canales", () => {
  let sql: typeof import("@/lib/db").sql;
  let inbound: typeof import("@/app/api/telegram/webhook/route").POST;
  let reply: typeof import("@/app/api/elevenlabs/canal/route").POST;
  let settings: typeof import("@/lib/messaging-settings");
  let telegram: typeof import("@/lib/telegram");
  let start: typeof import("@/app/api/demo/iniciar/route").POST;
  const send = async (text: string, media = false, user = 123) => {
    updateId++;
    return inbound(new Request("https://turnia.test/api/telegram/webhook", { method: "POST", headers: { "x-telegram-bot-api-secret-token": telegram.telegramWebhookSecret() }, body: JSON.stringify({ update_id: updateId, message: { message_id: updateId, from: { id: user, is_bot: false }, chat: { id: user, type: "private" }, ...(media ? { voice: { file_id: "voice-file", file_size: 3 } } : { text }) } }) }));
  };
  const runAfter = async () => { for (const fn of mocks.after.splice(0)) await fn(); };
  const prepare = async (mode = "chat") => {
    expect((await send("Quiero probar la demo con https://clinica.example/")).status).toBe(200);
    await runAfter();
    await send(mode);
    calls.length = 0;
  };
  const answer = async (conv: string, text = "Tenemos un turno disponible.") => {
    const body = JSON.stringify({ conversation_id: conv, status: "completed", user_message_ids: ["1"], data: [{ type: "agent_response", event: { agent_response: text, response_id: "r1" } }] });
    const timestamp = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", "test-signing").update(`${timestamp}.${body}`).digest("hex");
    return reply(new Request("https://turnia.test/api/elevenlabs/canal", { method: "POST", body, headers: { "elevenlabs-signature": `t=${timestamp},v0=${sig}` } }));
  };

  beforeAll(async () => {
    const url = await scratchDatabase(base!, "turnia_test_telegram");
    await resetTestDatabase(url);
    for (const [key, value] of Object.entries({ DATABASE_URL: url, TELEGRAM_BOT_TOKEN: "test-private", AGENT_TOOLS_SECRET: "test-tools", SESSION_SECRET: "test-session", APP_URL: "https://turnia.test", ELEVENLABS_API_KEY: "test-eleven", ELEVENLABS_VOICE_ID: "voice_test", ELEVENLABS_CHANNEL_URL: CHANNEL, ELEVENLABS_CHANNEL_SECRET: "test-channel", ELEVENLABS_CHANNEL_SIGNING_SECRET: "test-signing", WAHA_URL: "https://waha.test", WAHA_API_KEY: "test-waha", WAHA_WEBHOOK_HMAC: "test-waha-sign", ELEVENLABS_PHONE_NUMBER_ID: "phone_test" })) vi.stubEnv(key, value);
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
    ({ sql } = await import("@/lib/db"));
    settings = await import("@/lib/messaging-settings");
    telegram = await import("@/lib/telegram");
    inbound = (await import("@/app/api/telegram/webhook/route")).POST;
    reply = (await import("@/app/api/elevenlabs/canal/route")).POST;
    start = (await import("@/app/api/demo/iniciar/route")).POST;
    await sql`update clinics set elevenlabs_agent_id = 'agent_test' where not is_demo`;
  }, 60000);
  beforeEach(async () => {
    await sql`delete from demo_sessions`;
    await sql`delete from channel_conversations`;
    await sql`delete from conversations`;
    await sql`delete from clinics where is_demo`;
    await sql`delete from channel_events`;
    await sql`delete from demo_handoffs`;
    await sql`delete from leads`;
    await sql`update messaging_settings set active_channel = 'telegram', revision = 1, telegram_ready = true where id`;
    calls.length = 0; mocks.after.length = 0; mocks.session = undefined; webhook = ""; username = "TurnIA_salud_bot";
  });
  afterAll(async () => { await (await import("@/lib/db")).closeDb(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("rechaza webhooks falsos y JSON inválido", async () => {
    expect((await inbound(new Request("https://turnia.test", { method: "POST", body: "{}" }))).status).toBe(401);
    expect((await inbound(new Request("https://turnia.test", { method: "POST", headers: { "x-telegram-bot-api-secret-token": telegram.telegramWebhookSecret() }, body: "[" }))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it("asocia la web larga mediante /start, prepara la clínica y conversa con sus datos", async () => {
    const website = `https://clinica.example/${"a".repeat(200)}`;
    const response = await start(new Request("https://turnia.test/api/demo/iniciar", { method: "POST", body: JSON.stringify({ website }) }));
    const link = new URL((await response.json()).url);
    expect(link.pathname).toBe("/TurnIA_salud_bot");
    const token = link.searchParams.get("start")!;
    expect(token.length).toBeLessThanOrEqual(64);
    await send(`/start ${token}`); await runAfter();
    expect(texts().at(-1)).toContain("Clínica Telegram");
    await send("chat"); await send("Hola, quisiera solicitar un turno");
    const sent = calls.find((c) => c.url === CHANNEL)!.body as { user_identifier: string; dynamic_variables: Record<string, string> };
    expect(JSON.stringify(sent)).toContain("Clínica Telegram");
    expect(JSON.stringify(sent)).toContain("telegram:123");
    expect((await answer(`conv_tg_${updateId}`)).status).toBe(200);
    expect(texts().at(-1)).toContain("turno disponible");
    expect((await sql`select channel from conversations`)[0].channel).toBe("telegram");
    expect((await sql`select source from leads`)[0].source).toBe("demo-telegram");
    const { claimDemoHandoff } = await import("@/lib/demo/handoff");
    expect(await claimDemoHandoff(token, "telegram:999")).toBeNull();
    await sql`update demo_handoffs set expires_at = now() - interval '1 minute'`;
    expect(await claimDemoHandoff(token, "telegram:123")).toBeNull();
  });
  it("transcribe el audio entrante y devuelve Ogg de ElevenLabs como nota de voz", async () => {
    await prepare("audio");
    await send("", true);
    expect(tgCalls("getFile")).toHaveLength(1);
    expect(calls.some((c) => c.url.includes("speech-to-text"))).toBe(true);
    expect((await answer(`conv_tg_${updateId}`)).status).toBe(200);
    expect(calls.some((c) => c.url.includes("text-to-speech/voice_test?output_format=opus_48000_64"))).toBe(true);
    const form = tgCalls("sendVoice")[0].body as FormData;
    expect(form.get("chat_id")).toBe("123");
    expect((form.get("voice") as Blob).type).toBe("audio/ogg");
    expect(calls.some((c) => c.url.startsWith("https://waha.test"))).toBe(false);
  });
  it("reserva un turno simulado con identidad de Telegram y lo muestra con ese origen", async () => {
    await prepare();
    const [session] = await sql`select clinic_id from demo_sessions`;
    const [type] = await sql`select id from appointment_types where clinic_id = ${session.clinic_id} order by name limit 1`;
    const service = await import("@/lib/agent/service");
    const ctx = { clinicId: session.clinic_id, patientPhone: "telegram:123", channel: "custom" };
    await service.registerPatient(ctx, { nombre_completo: "Paciente ficticio Telegram", cobertura: "Particular" });
    const availability = await service.checkAvailability(ctx, { tipo_turno_id: type.id, desde: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10) });
    const first = availability.turnos[0];
    expect(first).toBeDefined();
    expect((await service.bookAppointment(ctx, { tipo_turno_id: type.id, profesional_id: first.profesional_id, inicio: first.inicio })).ok).toBe(true);
    expect((await sql`select source from appointments where clinic_id = ${session.clinic_id}`)[0].source).toBe("telegram");
  });
  it("en Telegram la opción llamada manda un enlace y nunca intenta llamar a una identidad ficticia", async () => {
    await prepare("llamada");
    const [row] = await sql`select call_token from demo_sessions`;
    expect(row.call_token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(calls.some((c) => c.url.includes("twilio"))).toBe(false);
    await settings.selectMessagingChannel("pausado");
    expect(await (await import("@/lib/demo/session")).sessionForCallToken(row.call_token)).toBeNull();
  });
  it("pausa entradas y envíos directos; descarta respuestas tardías incluso después de volver al canal", async () => {
    await prepare(); await send("Hola");
    const conv = `conv_tg_${updateId}`;
    await settings.selectMessagingChannel("whatsapp");
    calls.length = 0;
    expect(await (await send("otro mensaje")).json()).toEqual({ ignored: "canal pausado" });
    expect(await (await answer(conv)).json()).toMatchObject({ status: "inactive" });
    await expect(telegram.telegramSendText("telegram:123", "hola")).rejects.toThrow("pausado");
    await settings.selectMessagingChannel("telegram");
    expect(await (await answer(conv)).json()).toMatchObject({ status: "inactive" });
    await expect((await import("@/lib/waha")).wahaSendText("123@c.us", "hola")).rejects.toThrow("pausado");
    expect(calls).toHaveLength(0);
  });
  it("no inicia una clínica real ante un saludo sin demo, ni admite grupos", async () => {
    await send("hola");
    expect(texts()[0]).toContain("web de tu consultorio");
    expect(calls.some((c) => c.url === CHANNEL)).toBe(false);
    expect((await sql`select * from demo_sessions`)).toHaveLength(0);
    const res = await inbound(new Request("https://turnia.test", { method: "POST", headers: { "x-telegram-bot-api-secret-token": telegram.telegramWebhookSecret() }, body: JSON.stringify({ update_id: 9999, message: { message_id: 1, from: { id: 123, is_bot: false }, chat: { id: -123, type: "group" }, text: "hola" } }) }));
    expect(await res.json()).toEqual({ ignored: "solo chats privados" });
  });
  it("conecta solo el bot indicado y no pisa otro webhook", async () => {
    username = "otro_bot";
    await expect(telegram.connectTelegram()).rejects.toThrow("no pertenece");
    expect(tgCalls("setWebhook")).toHaveLength(0);
    username = "TurnIA_salud_bot"; webhook = "https://otro.test/webhook";
    await expect(telegram.connectTelegram()).rejects.toThrow("otro webhook");
    webhook = "";
    await telegram.connectTelegram();
    expect(webhook).toBe("https://turnia.test/api/telegram/webhook");
    expect(tgCalls("setWebhook")[0].body).toMatchObject({ secret_token: telegram.telegramWebhookSecret(), allowed_updates: ["message"] });
  });
  it("protege el selector con la sesión del panel y limita el alta de enlaces", async () => {
    const { saveMessagingChannel } = await import("@/app/panel/actions");
    const form = new FormData(); form.set("channel", "pausado");
    await expect(saveMessagingChannel({}, form)).rejects.toThrow("redirect:/panel/login");
    mocks.session = (await import("@/lib/session")).createSessionToken();
    expect(await saveMessagingChannel({}, form)).toMatchObject({ ok: true });
    expect((await settings.messagingSettings()).active_channel).toBe("pausado");
    expect((await start(new Request("https://turnia.test", { method: "POST", body: JSON.stringify({ website: "clinica.example" }) }))).status).toBe(409);
    await settings.selectMessagingChannel("telegram");
    for (let i = 0; i < 30; i++) expect((await start(new Request("https://turnia.test", { method: "POST", body: JSON.stringify({ website: "clinica.example" }) }))).status).toBe(200);
    expect((await start(new Request("https://turnia.test", { method: "POST", body: JSON.stringify({ website: "clinica.example" }) }))).status).toBe(429);
  });
});
