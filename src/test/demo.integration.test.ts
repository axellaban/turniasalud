import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Lead magnet "Probá la demo con tu web" de punta a punta: pedido por WhatsApp,
// lectura de la web, perfil con Claude, clínica temporal y los tres modos.
// WAHA, ElevenLabs, Claude, el DNS y la web del interesado se simulan.

const mocks = vi.hoisted(() => ({
  notifyN8n: vi.fn(async () => {}),
  after: [] as Array<() => unknown>,
}));

vi.mock("@/lib/n8n", () => ({ notifyN8n: mocks.notifyN8n }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => mocks.after.push(fn),
}));
vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) => [{ address: host.includes("interno") ? "10.0.0.8" : "200.45.1.10", family: 4 }],
}));

const baseUrl = testDatabaseUrl();
const MAIN = "00000000-0000-4000-8000-000000000001";
const WAHA = "https://waha.test";
const CHANNEL = "https://api.elevenlabs.io/v1/convai/api-integrations/custom_channel/triggers/trig_1/async_message";
const HMAC_KEY = "clave-hmac-waha";
const SIGNING = "firma-canal";
const LEAD = "5491166667777";
const CHAT = `${LEAD}@c.us`;

const PROFILE = {
  nombre: "Odonto Sur",
  especialidad: "Odontología",
  descripcion: "Odontología integral en Banfield.",
  direccion: "Av. Alsina 123, Banfield",
  telefono: "+54 11 4242-0000",
  horario_texto: "Lunes a viernes de 9 a 19 h",
  horarios: [1, 2, 3, 4, 5].map((dia) => ({ dia, desde: "09:00", hasta: "19:00" })),
  coberturas: ["OSDE", "Swiss Medical", "Particular"],
  profesionales: [
    { nombre: "Dra. Ana Pérez", especialidad: "Odontología", dias: [1, 3], bio: "Implantes" },
    { nombre: "Dr. Luis Gil", especialidad: "Ortodoncia", dias: [], bio: null },
  ],
  prestaciones: [
    { nombre: "Primera consulta", especialidad: "odontología", duracion_min: 30, precio: 30000, indicaciones: null, primera_vez: true },
    { nombre: "Limpieza dental", especialidad: "Odontología", duracion_min: 40, precio: null, indicaciones: null, primera_vez: false },
    { nombre: "Blanqueamiento", especialidad: "Estética dental", duracion_min: 60, precio: null, indicaciones: null, primera_vez: false },
  ],
  preguntas_frecuentes: "- Hay estacionamiento en la esquina.",
  politicas: "Cancelar con 24 h de anticipación.",
};

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
const fake = {
  calls: [] as Call[],
  conversation: 0,
  reset() {
    this.calls = [];
  },
  texts() {
    return this.calls.filter((c) => c.url === `${WAHA}/api/sendText`).map((c) => (c.body as { text: string }).text);
  },
  channel() {
    return this.calls.filter((c) => c.url === CHANNEL).map((c) => c.body as { data: { text: string }; dynamic_variables: Record<string, string> });
  },
};

const html = (title: string, body: string) =>
  new Response(`<html><head><title>${title}</title></head><body>${body}</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });

async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const headers = Object.fromEntries(new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined)).entries());
  const raw = init.body ?? (input instanceof Request ? await input.clone().text() : undefined);
  let body: unknown = raw;
  if (typeof raw === "string") body = JSON.parse(raw);
  fake.calls.push({ url, method: init.method ?? (input instanceof Request ? input.method : "GET"), headers, body });
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

  if (url === `${WAHA}/api/sendText` || url === `${WAHA}/api/sendVoice`) return json({ id: "out" }, 201);
  if (url === CHANNEL) return json({ conversation_id: `conv_demo_${++fake.conversation}`, status: "queued" }, 202);
  if (url === "https://odontosur.com.ar/") return html("Odonto Sur | Banfield", `<a href="/equipo">Equipo</a><p>Odontología integral</p>`);
  if (url === "https://odontosur.com.ar/equipo") return html("Equipo", "<p>Dra. Ana Pérez · Dr. Luis Gil</p>");
  if (url.startsWith("https://api.anthropic.com/v1/messages")) {
    return json({
      id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5",
      content: [{ type: "text", text: JSON.stringify(PROFILE) }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
    });
  }
  if (url === "https://api.elevenlabs.io/v1/convai/agents/agent_test") return json({ conversation_config: { tts: { voice_id: "voz_sofi" } } });
  if (url.startsWith("https://api.elevenlabs.io/v1/text-to-speech/voz_sofi")) return new Response(new Uint8Array([79, 103, 103, 83]));
  if (url.startsWith("https://api.elevenlabs.io/v1/convai/conversation/token")) return json({ token: "tok_voz" });
  throw new Error(`fetch inesperado en el test: ${init.method ?? "GET"} ${url}`);
}

let messageId = 0;
function whatsapp(text: string) {
  const raw = JSON.stringify({ event: "message", session: "default", payload: { id: `d${++messageId}`, from: CHAT, fromMe: false, body: text, hasMedia: false } });
  const hmac = createHmac("sha512", HMAC_KEY).update(raw).digest("hex");
  return new Request("https://turnia.example/api/waha/webhook", { method: "POST", body: raw, headers: { "x-webhook-hmac": hmac, "x-webhook-hmac-algorithm": "sha512" } });
}

function agentReply(conversationId: string, text: string) {
  const raw = JSON.stringify({
    conversation_id: conversationId, user_message_ids: [`d${messageId}`], status: "completed",
    data: [{ type: "agent_response", event: { agent_response: text } }],
  });
  const t = Math.floor(Date.now() / 1000);
  return new Request("https://turnia.example/api/elevenlabs/canal", {
    method: "POST", body: raw,
    headers: { "elevenlabs-signature": `t=${t},v0=${createHmac("sha256", SIGNING).update(`${t}.${raw}`).digest("hex")}` },
  });
}

describe.runIf(baseUrl)("Demo del lead magnet por WhatsApp", () => {
  let sql: typeof import("@/lib/db").sql;
  let inbound: typeof import("@/app/api/waha/webhook/route").POST;
  let reply: typeof import("@/app/api/elevenlabs/canal/route").POST;
  let callRoute: typeof import("@/app/api/demo/llamada/route").POST;

  const send = async (text: string) => {
    const res = await inbound(whatsapp(text));
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, unknown>;
  };
  const runAfter = async () => {
    const pending = mocks.after.splice(0);
    for (const fn of pending) await fn();
  };
  const session = async () => (await sql<Array<{ status: string; clinic_id: string | null; call_token: string | null; lead_id: string }>>`
    select status, clinic_id, call_token, lead_id from demo_sessions where phone = ${LEAD} order by created_at desc limit 1`)[0];

  beforeAll(async () => {
    const url = await scratchDatabase(baseUrl!, "turnia_test_demo");
    await resetTestDatabase(url);
    vi.stubEnv("DATABASE_URL", url);
    vi.stubEnv("AGENT_TOOLS_SECRET", "secreto-de-prueba");
    vi.stubEnv("ELEVENLABS_API_KEY", "clave-falsa");
    vi.stubEnv("ANTHROPIC_API_KEY", "clave-claude-falsa");
    vi.stubEnv("ELEVENLABS_VOICE_ID", "");
    vi.stubEnv("ELEVENLABS_PHONE_NUMBER_ID", "");
    vi.stubEnv("APP_URL", "https://turnia.example");
    vi.stubEnv("WAHA_URL", WAHA);
    vi.stubEnv("WAHA_API_KEY", "waha-key");
    vi.stubEnv("WAHA_WEBHOOK_HMAC", HMAC_KEY);
    vi.stubEnv("ELEVENLABS_CHANNEL_URL", CHANNEL);
    vi.stubEnv("ELEVENLABS_CHANNEL_SECRET", "secreto-entrada");
    vi.stubEnv("ELEVENLABS_CHANNEL_SIGNING_SECRET", SIGNING);
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
    ({ sql } = await import("@/lib/db"));
    await sql`update clinics set elevenlabs_agent_id = 'agent_test', whatsapp_provider = 'waha' where id = ${MAIN}`;
    inbound = (await import("@/app/api/waha/webhook/route")).POST;
    reply = (await import("@/app/api/elevenlabs/canal/route")).POST;
    callRoute = (await import("@/app/api/demo/llamada/route")).POST;
  }, 60000);

  afterAll(async () => {
    const { closeDb } = await import("@/lib/db");
    await closeDb();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    fake.reset();
    mocks.notifyN8n.mockClear();
  });

  it("lee la web, arma la clínica de la demo y ofrece llamada, audio o chat", async () => {
    expect(await send("¡Hola! Quiero probar la demo de Turnia. Te paso mi web: https://odontosur.com.ar/")).toEqual({ ok: true, demo: "analizando" });
    expect(fake.texts()[0]).toContain("Estoy leyendo *odontosur.com.ar*");
    expect(mocks.notifyN8n).toHaveBeenCalledWith("lead.nuevo", expect.objectContaining({ lead: expect.objectContaining({ telefono: LEAD, origen: "demo-whatsapp" }) }));
    const [lead] = await sql`select name, email, phone, source from leads where phone = ${LEAD}`;
    expect(lead).toEqual({ name: `WhatsApp +${LEAD}`, email: null, phone: LEAD, source: "demo-whatsapp" });

    // Mientras lee, un mensaje no se pierde ni va a la clínica de siempre.
    expect(await send("hola?")).toEqual({ ok: true, demo: "analizando" });
    expect(fake.texts()[1]).toContain("Sigo leyendo");

    fake.reset();
    await runAfter();
    const claude = fake.calls.find((c) => c.url.startsWith("https://api.anthropic.com/v1/messages"))!;
    expect(claude.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    const request = claude.body as { model: string; fallbacks: string; output_config: { effort: string; format: { type: string } }; messages: Array<{ content: string }> };
    expect(request).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", output_config: { effort: "low", format: { type: "json_schema" } } });
    expect(request.messages[0].content).toContain("Dra. Ana Pérez · Dr. Luis Gil");

    const s = await session();
    expect(s.status).toBe("eligiendo");
    const [clinic] = await sql`select name, is_demo, hours_text, accepted_coverages from clinics where id = ${s.clinic_id}`;
    expect(clinic).toEqual({ name: "Odonto Sur", is_demo: true, hours_text: "Lunes a viernes de 9 a 19 h", accepted_coverages: ["OSDE", "Swiss Medical", "Particular"] });
    // Cada tipo de turno tiene un profesional de su especialidad (y al revés).
    const unmatched = await sql`
      select t.name from appointment_types t where t.clinic_id = ${s.clinic_id}
        and not exists (select 1 from professionals p where p.clinic_id = t.clinic_id and p.specialty = t.specialty)`;
    expect(unmatched).toEqual([]);
    const pros = await sql<Array<{ full_name: string; days: number[] }>>`
      select p.full_name, array_agg(s.weekday order by s.weekday)::int[] as days from professionals p join schedules s on s.professional_id = p.id
      where p.clinic_id = ${s.clinic_id} group by p.full_name order by p.full_name`;
    expect(pros).toEqual([
      { full_name: "Dr. Luis Gil", days: [1, 2, 3, 4, 5] },
      { full_name: "Dra. Ana Pérez", days: [1, 3] },
      { full_name: "Equipo de Estética dental", days: [1, 2, 3, 4, 5] },
    ]);
    const [options] = fake.texts();
    expect(options).toContain("Ya conozco *Odonto Sur*: 3 profesionales, 4 tipos de turno y 2 coberturas");
    expect(options).toContain("1️⃣ *Llamada de voz*");

    // La clínica de la demo nunca reemplaza a la clínica real.
    const { whatsappClinic } = await import("@/lib/channel");
    expect((await whatsappClinic()).id).toBe(MAIN);
  });

  it("en modo chat el agente atiende como la recepcionista de esa clínica", async () => {
    expect(await send("algo")).toEqual({ ok: true, demo: "eligiendo" });
    expect(fake.texts()[0]).toContain("Respondé con el número");
    expect(await send("3")).toEqual({ ok: true, demo: "chat" });
    expect(fake.texts()[1]).toContain("Desde ahora te atiende *Sofi*, la recepcionista de *Odonto Sur*");

    fake.reset();
    expect(await send("Hola, quiero un turno para limpieza")).toEqual({ ok: true, demo: "chat" });
    const [msg] = fake.channel();
    const s = await session();
    expect(msg.data.text).toBe("Hola, quiero un turno para limpieza");
    expect(msg.dynamic_variables).toMatchObject({ clinic_id: s.clinic_id, clinic_name: "Odonto Sur", patient_phone: LEAD });
    expect(msg.dynamic_variables.conversation_context).toMatch(/^DEMO DE TURNIA/);
    expect(msg.dynamic_variables.clinic_catalog).toContain("Limpieza dental");

    const res = await reply(agentReply(`conv_demo_${fake.conversation}`, "¡Hola! Tengo el lunes a las **10:00**."));
    expect(res.status).toBe(200);
    expect(fake.texts()).toEqual(["¡Hola! Tengo el lunes a las *10:00*."]);
  });

  it("en modo audio contesta con notas de voz y MENU vuelve a las opciones", async () => {
    expect(await send("MENU")).toEqual({ ok: true, demo: "eligiendo" });
    expect(await send("audio")).toEqual({ ok: true, demo: "audio" });
    fake.reset();
    expect(await send("Quiero un turno")).toEqual({ ok: true, demo: "audio" });
    // Arranca una conversación nueva con el agente (la del chat quedó cerrada).
    expect(fake.calls.find((c) => c.url === CHANNEL)?.body).not.toHaveProperty("conversation_id");
    fake.reset();
    expect((await reply(agentReply(`conv_demo_${fake.conversation}`, "Dale, **¿a nombre de quién?**"))).status).toBe(200);
    const tts = fake.calls.find((c) => c.url.includes("/v1/text-to-speech/"))!;
    expect(tts.url).toContain("output_format=opus_48000_64");
    expect((tts.body as { text: string }).text).toBe("Dale, ¿a nombre de quién?");
    const voice = fake.calls.find((c) => c.url === `${WAHA}/api/sendVoice`)!;
    expect(voice.body).toMatchObject({ chatId: CHAT, convert: true, file: { mimetype: "audio/ogg; codecs=opus", data: "T2dnUw==" } });
    expect(fake.texts()).toEqual([]);
  });

  it("en modo llamada sin número manda un link para hablar por la web", async () => {
    await send("menu");
    expect(await send("1")).toEqual({ ok: true, demo: "llamada" });
    const s = await session();
    expect(s.call_token).toBeTruthy();
    expect(fake.texts().at(-1)).toContain(`https://turnia.example/probar-demo/llamada/${s.call_token}`);

    const res = await callRoute(new Request("https://turnia.example/api/demo/llamada", { method: "POST", body: JSON.stringify({ token: s.call_token }) }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; clinicName: string; dynamicVariables: Record<string, string> };
    expect(body).toMatchObject({ token: "tok_voz", clinicName: "Odonto Sur" });
    expect(body.dynamicVariables.clinic_id).toBe(s.clinic_id);
    const bad = await callRoute(new Request("https://turnia.example/api/demo/llamada", { method: "POST", body: JSON.stringify({ token: "x".repeat(24) }) }));
    expect(bad.status).toBe(404);
  });

  it("SALIR termina la demo y lo que sigue va a la clínica de siempre", async () => {
    const { call_token } = await session();
    expect(await send("salir")).toEqual({ ok: true, demo: "terminada" });
    expect(fake.texts()[0]).toContain("¡Gracias por probar Turnia!");
    // El link de llamada deja de servir.
    const res = await callRoute(new Request("https://turnia.example/api/demo/llamada", { method: "POST", body: JSON.stringify({ token: call_token }) }));
    expect(res.status).toBe(404);

    fake.reset();
    const after = await send("hola");
    expect(after).not.toHaveProperty("demo");
    expect(fake.channel()[0].dynamic_variables.clinic_id).toBe(MAIN);
  });

  it("si la web no se puede leer avisa, y alcanza con mandar la dirección corregida", async () => {
    await send("quiero probar la demo: www.sitio-interno.com");
    fake.reset();
    await runAfter();
    expect((await session()).status).toBe("error");
    expect(fake.texts()[0]).toContain("No pude abrir *sitio-interno.com*");
    expect(fake.calls.some((c) => c.url.includes("sitio-interno"))).toBe(false);

    fake.reset();
    expect(await send("odontosur.com.ar")).toEqual({ ok: true, demo: "analizando" });
    // Tercera demo del día: después de esta, se corta.
    await runAfter();
    expect(await send("quiero probar la demo con odontosur.com.ar")).toEqual({ ok: true, demo: "terminada" });
    expect(fake.texts().at(-1)).toContain("Ya probaste varias demos hoy");
  });
});
