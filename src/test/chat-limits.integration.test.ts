import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_LIMITS, CLIPPED_NOTE, DOCUMENTS_LIMIT_REPLY, LONG_AUDIO_REPLY, PAUSE_REPLY } from "@/lib/chat-limits";
import { AXEL_WHATSAPP } from "@/lib/sales/contacto-axel";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Límites de Sofi por chat y por llamada, contra un Postgres real y descartable.
// WAHA y ElevenLabs se simulan interceptando fetch: no sale nada a internet.

const mocks = vi.hoisted(() => ({ notifyN8n: vi.fn<(event: string, payload: Record<string, unknown>) => Promise<void>>(async () => {}) }));
vi.mock("@/lib/n8n", () => ({ notifyN8n: mocks.notifyN8n }));

const baseUrl = testDatabaseUrl();
const CLINIC = "00000000-0000-4000-8000-000000000001";
const WAHA = "https://waha.test";
const CHANNEL = "https://api.elevenlabs.io/v1/convai/api-integrations/custom_channel/triggers/trig_1/async_message";
const HMAC_KEY = "clave-hmac-waha";
const SIGNING = "firma-canal";
const API_KEY = "waha-api-key-super-secreta";
const SECRET = "secreto-de-prueba";

type Call = { url: string; body: Record<string, unknown> };
const fake = {
  calls: [] as Call[],
  audio: new Uint8Array([1, 2, 3, 4]),
  channel() {
    return this.calls.filter((c) => c.url === CHANNEL);
  },
  texts(chatId?: string) {
    return this.calls.filter((c) => c.url === `${WAHA}/api/sendText` && (!chatId || c.body.chatId === chatId)).map((c) => String(c.body.text));
  },
};

async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  fake.calls.push({ url, body });
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  // Una conversación del agente por número.
  if (url === CHANNEL) return json({ conversation_id: `conv_${(body.data as { user_identifier: string }).user_identifier}` }, 202);
  if (url === `${WAHA}/api/sendText`) return json({ id: "out" }, 201);
  if (url.startsWith(`${WAHA}/api/files/`)) return new Response(new Uint8Array(fake.audio), { headers: { "Content-Type": "audio/ogg" } });
  throw new Error(`fetch inesperado en el test: ${init.method ?? "GET"} ${url}`);
}

function wahaRequest(payload: Record<string, unknown>) {
  const raw = JSON.stringify({ event: "message", session: "default", engine: "NOWEB", payload });
  const hmac = createHmac("sha512", HMAC_KEY).update(raw).digest("hex");
  return new Request("https://turnia.example/api/waha/webhook", {
    method: "POST",
    body: raw,
    headers: { "x-webhook-hmac": hmac, "x-webhook-hmac-algorithm": "sha512", "content-type": "application/json" },
  });
}

const text = (id: string, phone: string, body: string) => wahaRequest({ id, from: `${phone}@c.us`, fromMe: false, body, hasMedia: false });

function replyRequest(conversationId: string, ids: string[], answer: string) {
  const raw = JSON.stringify({
    version: "1", conversation_id: conversationId, user_message_ids: ids, status: "completed", error: null,
    data: [{ type: "agent_response", event: { agent_response: answer, response_id: `r_${ids.join("_")}`, event_id: 1 } }],
  });
  const t = Math.floor(Date.now() / 1000);
  const signature = `t=${t},v0=${createHmac("sha256", SIGNING).update(`${t}.${raw}`).digest("hex")}`;
  return new Request("https://turnia.example/api/elevenlabs/canal", { method: "POST", body: raw, headers: { "elevenlabs-signature": signature } });
}

describe.runIf(baseUrl)("límites de Sofi", () => {
  let sql: typeof import("@/lib/db").sql;
  let inbound: typeof import("@/app/api/waha/webhook/route").POST;
  let reply: typeof import("@/app/api/elevenlabs/canal/route").POST;
  let tools: typeof import("@/app/api/agent/tools/[name]/route").POST;

  const send = async (request: Request) => (await inbound(request)).json();
  async function tool(name: string, input: Record<string, unknown>, phone: string, canal = "custom") {
    const request = new Request(`https://turnia.test/api/agent/tools/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-turnia-secret": SECRET },
      body: JSON.stringify({ clinic_id: CLINIC, patient_phone: phone, canal, ...input }),
    });
    return (await tools(request, { params: Promise.resolve({ name }) })).json();
  }
  const mute = async (phone: string) => (await sql`select reason, detail, until from chat_mutes where clinic_id = ${CLINIC} and phone = ${phone}`)[0];
  const usage = (phone: string, kind: string, n: number) =>
    sql`insert into chat_usage (clinic_id, phone, kind) select ${CLINIC}, ${phone}, ${kind} from generate_series(1, ${n})`;

  beforeAll(async () => {
    const url = await scratchDatabase(baseUrl!, "turnia_test_chat_limits");
    await resetTestDatabase(url);
    vi.stubEnv("DATABASE_URL", url);
    vi.stubEnv("AGENT_TOOLS_SECRET", SECRET);
    vi.stubEnv("ELEVENLABS_API_KEY", "clave-falsa");
    vi.stubEnv("WAHA_URL", `${WAHA}/`);
    vi.stubEnv("WAHA_API_KEY", API_KEY);
    vi.stubEnv("WAHA_SESSION", "default");
    vi.stubEnv("WAHA_WEBHOOK_HMAC", HMAC_KEY);
    vi.stubEnv("WAHA_SEND_DELAY_MS", "0");
    vi.stubEnv("WAHA_CONNECTIONS", "");
    vi.stubEnv("ELEVENLABS_CHANNEL_URL", CHANNEL);
    vi.stubEnv("ELEVENLABS_CHANNEL_SECRET", "secreto-entrada");
    vi.stubEnv("ELEVENLABS_CHANNEL_SIGNING_SECRET", SIGNING);
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
    ({ sql } = await import("@/lib/db"));
    await sql`update messaging_settings set active_channel = 'whatsapp' where id`;
    inbound = (await import("@/app/api/waha/webhook/route")).POST;
    reply = (await import("@/app/api/elevenlabs/canal/route")).POST;
    tools = (await import("@/app/api/agent/tools/[name]/route")).POST;
  }, 60000);

  afterAll(async () => {
    const { closeDb } = await import("@/lib/db");
    await closeDb();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    fake.calls = [];
    fake.audio = new Uint8Array([1, 2, 3, 4]);
    mocks.notifyN8n.mockClear();
  });

  it("un bot que contesta al instante queda en silencio 7 días y no le llega más nada a Sofi", async () => {
    const phone = "5491166600001";
    expect(await send(text("b1", phone, "Hola!"))).toMatchObject({ ok: true, conversation_id: `conv_${phone}` });
    // Sofi contesta y el otro le responde al instante, una y otra vez.
    for (let i = 2; i <= 4; i++) {
      await reply(replyRequest(`conv_${phone}`, [`b${i - 1}`], `respuesta ${i}`));
      expect(await send(text(`b${i}`, phone, `opción ${i}`))).toMatchObject({ ok: true, conversation_id: `conv_${phone}` });
    }
    await reply(replyRequest(`conv_${phone}`, ["b4"], "respuesta 5"));
    expect(await send(text("b5", phone, "opción 5"))).toMatchObject({ ok: true, conversation_id: null, limite: "bot" });
    expect(fake.channel()).toHaveLength(4);
    expect(await mute(phone)).toMatchObject({ reason: "bot", detail: expect.stringMatching(/menos de 3 segundos/) });
    expect(new Date((await mute(phone)).until).getTime()).toBeGreaterThan(Date.now() + 6.9 * 86400_000);
    // La charla quedó cerrada: una respuesta que estaba en camino no se entrega.
    expect(await (await reply(replyRequest(`conv_${phone}`, ["b5"], "tarde"))).json()).toMatchObject({ status: "inactive" });

    // Lo que siga mandando no gasta nada.
    fake.calls = [];
    expect(await send(text("b6", phone, "opción 6"))).toEqual({ ignored: "número en silencio" });
    expect(fake.calls).toHaveLength(0);
  });

  it("el mismo mensaje largo por tercera vez también es un bot", async () => {
    const phone = "5491166600002";
    const promo = "Hola! Somos Insumos Dentales SA, tenemos ofertas en guantes y barbijos.";
    expect(await send(text("p1", phone, promo))).toMatchObject({ ok: true });
    expect(await send(text("p2", phone, promo))).toMatchObject({ ok: true });
    expect(await send(text("p3", phone, promo))).toMatchObject({ limite: "bot" });
    expect(await mute(phone)).toMatchObject({ reason: "bot", detail: expect.stringMatching(/mismo mensaje/) });
  });

  it("quien escribe sin parar: avisa una vez, deja una tarea para recepción y pausa 12 horas", async () => {
    const phone = "5491166600003";
    await usage(phone, "mensaje", CHAT_LIMITS.burst.messages);
    expect(await send(text("e1", phone, "otra pregunta más"))).toMatchObject({ limite: "exceso" });
    expect(fake.channel()).toHaveLength(0);
    expect(fake.texts(`${phone}@c.us`)).toEqual([PAUSE_REPLY]);
    const pause = await mute(phone);
    expect(pause.reason).toBe("exceso");
    const hours = (new Date(pause.until).getTime() - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(11.9);
    expect(hours).toBeLessThan(12.1);
    const [task] = await sql`select type, title, details from tasks where clinic_id = ${CLINIC} and title like ${`%+${phone}%`}`;
    expect(task).toMatchObject({ type: "derivacion_humana", title: expect.stringMatching(/exceso de mensajes/), details: expect.stringMatching(/Reactivar/) });
    expect(mocks.notifyN8n).toHaveBeenCalledWith("tarea.creada", expect.objectContaining({ clinic_id: CLINIC }));

    // Desde el panel se reactiva y Sofi le vuelve a contestar.
    const { unmuteNumber } = await import("@/lib/chat-guard");
    await unmuteNumber(CLINIC, phone);
    await sql`delete from chat_usage where phone = ${phone}`;
    expect(await send(text("e2", phone, "¿me ayudás con el turno?"))).toMatchObject({ ok: true, conversation_id: `conv_${phone}` });
  });

  it("también hay tope por día", async () => {
    const phone = "5491166600004";
    await sql`insert into chat_usage (clinic_id, phone, kind, created_at) select ${CLINIC}, ${phone}, 'mensaje', now() - interval '5 hours' from generate_series(1, ${CHAT_LIMITS.daily})`;
    expect(await send(text("d1", phone, "hola de nuevo"))).toMatchObject({ limite: "exceso" });
    expect(await mute(phone)).toMatchObject({ detail: expect.stringMatching(/en el día/) });
  });

  it("el equipo del consultorio no tiene topes", async () => {
    const phone = "5491166600005";
    await sql`insert into clinic_staff_phones (clinic_id, phone, name) values (${CLINIC}, ${phone}, 'Recepción')`;
    await usage(phone, "mensaje", CHAT_LIMITS.daily + 5);
    const promo = "Mostrame la agenda de mañana completa, por favor, con todos los turnos";
    for (const id of ["s1", "s2", "s3"]) expect(await send(text(id, phone, promo))).toMatchObject({ ok: true, conversation_id: `conv_${phone}` });
    expect(await mute(phone)).toBeUndefined();
  });

  it("un mensaje larguísimo le llega recortado a Sofi", async () => {
    const phone = "5491166600006";
    await send(text("l1", phone, "x".repeat(9000)));
    const sent = (fake.channel()[0].body.data as { text: string }).text;
    expect(sent.length).toBeLessThan(CHAT_LIMITS.maxChars + CLIPPED_NOTE.length + 1);
    expect(sent.endsWith(CLIPPED_NOTE)).toBe(true);
  });

  it("un audio de más de 3 minutos no se transcribe: le pide uno más corto", async () => {
    const phone = "5491166600007";
    const audio = (id: string, data: Record<string, unknown>) => wahaRequest({
      id, from: `${phone}@c.us`, fromMe: false, body: "", hasMedia: true,
      media: { url: `${WAHA}/api/files/${id}.oga`, mimetype: "audio/ogg; codecs=opus" }, _data: data,
    });
    expect(await send(audio("a1", { message: { audioMessage: { seconds: 240 } } }))).toEqual({ ok: true, audio: "muy_largo" });
    expect(await send(audio("a2", { duration: "600" }))).toEqual({ ok: true, audio: "muy_largo" });
    // Sin duración informada, un archivo enorme también cuenta como largo.
    fake.audio = new Uint8Array(4 * 1024 * 1024);
    expect(await send(audio("a3", {}))).toEqual({ ok: true, audio: "muy_largo" });
    expect(fake.texts(`${phone}@c.us`)).toEqual([LONG_AUDIO_REPLY, LONG_AUDIO_REPLY, LONG_AUDIO_REPLY]);
    expect(fake.calls.some((c) => c.url.includes("speech-to-text"))).toBe(false);
  });

  it("a partir de la foto 11 del día, no la lee", async () => {
    const phone = "5491166600008";
    await usage(phone, "documento", CHAT_LIMITS.dailyDocuments);
    const photo = wahaRequest({
      id: "f1", from: `${phone}@c.us`, fromMe: false, body: "", hasMedia: true,
      media: { url: `${WAHA}/api/files/f1.jpeg`, mimetype: "image/jpeg" },
    });
    expect(await send(photo)).toEqual({ ok: true, media: "tope_del_dia" });
    expect(fake.texts(`${phone}@c.us`)).toEqual([DOCUMENTS_LIMIT_REPLY]);
    expect(fake.calls.some((c) => c.url.includes("anthropic") || c.url.includes("/api/files/"))).toBe(false);
  });

  it("silenciar_numero: Sofi silencia a un vendedor, nunca a un paciente ni al equipo, y solo por chat", async () => {
    const seller = "5491166600009";
    expect(await tool("silenciar_numero", { motivo: "vendedor", detalle: "Vende software de gestión" }, seller)).toMatchObject({ ok: true });
    expect(await mute(seller)).toMatchObject({ reason: "vendedor", detail: "Vende software de gestión" });
    fake.calls = [];
    expect(await send(text("v1", seller, "¿Pudiste ver la propuesta?"))).toEqual({ ignored: "número en silencio" });
    expect(fake.calls).toHaveLength(0);

    // María González es paciente de la clínica de prueba (tiene turnos).
    expect(await tool("silenciar_numero", { motivo: "bot" }, "5491155550001")).toMatchObject({ ok: false, error: expect.stringMatching(/paciente/) });
    expect(await tool("silenciar_numero", { motivo: "vendedor" }, "5491166600005")).toMatchObject({ ok: false, error: expect.stringMatching(/equipo/) });
    expect(await tool("silenciar_numero", { motivo: "vendedor" }, "5491166600010", "twilio")).toMatchObject({ ok: false, error: expect.stringMatching(/llamada/) });
    expect(await mute("5491166600010")).toBeUndefined();
  });

  it("fusible de chat: al pasar los 400 mensajes del día le avisa a Axel una sola vez", async () => {
    await sql`insert into chat_usage (clinic_id, phone, kind) select ${CLINIC}, '54911777' || g, 'mensaje' from generate_series(1, 400) g`;
    await send(text("z1", "5491166600011", "hola"));
    await send(text("z2", "5491166600012", "hola"));
    const notices = fake.texts(`${AXEL_WHATSAPP}@c.us`);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/mensajes de chat/);
    expect(mocks.notifyN8n).toHaveBeenCalledWith("clinica.fusible", expect.objectContaining({ clinic_id: CLINIC, tipo: "chat" }));
  });

  it("el agente propio de cada clínica corta las llamadas a los 8 minutos y tras 20 s de silencio; el general, que atiende chats, no", async () => {
    const { callLimits } = await import("@/lib/agent/setup");
    expect(callLimits(false)).toEqual({ conversation: { max_duration_seconds: 480 }, turn: { silence_end_call_timeout: 20 } });
    expect(callLimits(true)).toEqual({ conversation: { max_duration_seconds: 1200 } });
  });

  it("llamadas: si el agente propio la cortó a los 8 minutos, tarea para recepción; y fusible de minutos", async () => {
    const { recordConversation } = await import("@/lib/conversations");
    const own = "22222222-2222-4222-8222-222222222222";
    await sql`insert into clinics (id, name, elevenlabs_agent_id) values (${own}, 'Consultorio con agente propio', 'agent_propio')`;
    const call = (id: string, secs: number, agent = "agent_propio", clinic = own) => recordConversation({
      agent_id: agent, conversation_id: id, status: "done", user_id: "5491166600020",
      metadata: { call_duration_secs: secs, start_time_unix_secs: Math.floor(Date.now() / 1000) - secs, phone_call: { type: "twilio", external_number: "+5491166600020", direction: "inbound" } },
      analysis: { transcript_summary: "Quería mover el turno de la semana que viene." },
      conversation_initiation_client_data: { dynamic_variables: { clinic_id: clinic, patient_phone: "5491166600020", system__channel: "twilio" } },
    });
    await call("call_corta", 200);
    await call("call_tope", 480);
    await call("call_tope", 480); // ElevenLabs reenvía el webhook: una sola tarea.
    const tasks = await sql`select title, details, conversation_id from tasks where clinic_id = ${own}`;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ conversation_id: "call_tope", title: expect.stringMatching(/tope de 8 minutos/), details: expect.stringMatching(/mover el turno/) });

    // El agente general no corta a los 8 minutos: una llamada larga no es un corte.
    await call("call_general", 600, "agente-general-sin-clinica", CLINIC);
    expect(await sql`select 1 from tasks where conversation_id = 'call_general'`).toHaveLength(0);

    // 120 minutos de llamadas en el día: aviso a Axel, una sola vez.
    for (let i = 0; i < 14; i++) await call(`call_larga_${i}`, 480);
    const notices = fake.texts(`${AXEL_WHATSAPP}@c.us`).filter((t) => t.includes("minutos de llamadas"));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/Consultorio con agente propio/);
  });
});
