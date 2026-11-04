import { createHmac } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// WhatsApp por WAHA + Custom Channel de ElevenLabs, contra un Postgres real y
// descartable (su propia base, para correr en paralelo con los otros tests).
// WAHA y ElevenLabs se simulan interceptando fetch: no sale nada a internet.

const mocks = vi.hoisted(() => ({
  notifyN8n: vi.fn(async () => {}),
  session: undefined as string | undefined,
}));

vi.mock("@/lib/n8n", () => ({ notifyN8n: mocks.notifyN8n }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (mocks.session ? { value: mocks.session } : undefined), set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
  usePathname: () => "/panel",
  useRouter: () => ({ refresh: () => {} }),
}));

const baseUrl = testDatabaseUrl();
const CLINIC = "00000000-0000-4000-8000-000000000001";
const WAHA = "https://waha.test";
const CHANNEL = "https://api.elevenlabs.io/v1/convai/api-integrations/custom_channel/triggers/trig_1/async_message";
const HMAC_KEY = "clave-hmac-waha";
const SIGNING = "firma-canal";
const API_KEY = "waha-api-key-super-secreta";
const OWN_WAHA = "https://consultorio.test";
const OWN_CLINIC = "11111111-1111-4111-8111-111111111111";
const ownConnection = {
  id: "consultorio-prueba", clinicId: OWN_CLINIC, phone: "5491155559999", url: OWN_WAHA,
  apiKey: "api-key-consultorio-prueba", webhookHmac: "hmac-consultorio-prueba", session: "default", enabled: true, revision: 1,
};

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** Simula WAHA y ElevenLabs. Cada respuesta se puede cambiar por test. */
const fake = {
  calls: [] as Call[],
  nextConversation: "conv_wa_1",
  failSendText: false,
  failSendVoice: false,
  transcript: "quiero sacar un turno para limpieza",
  lidPhone: "5491155550002@c.us" as string | null,
  /** Una foto real (JPEG chico) para lo que devuelve WAHA, y lo que «lee» Claude. */
  photo: null as Buffer | null,
  reading: null as Record<string, unknown> | null,
  reset() {
    this.calls = [];
    this.nextConversation = "conv_wa_1";
    this.failSendText = false;
    this.failSendVoice = false;
    this.transcript = "quiero sacar un turno para limpieza";
    this.lidPhone = "5491155550002@c.us";
  },
  sent(kind: "channel" | "sendText" | "sendVoice") {
    return this.calls.filter((c) => (kind === "channel" ? c.url === CHANNEL : c.url === `${WAHA}/api/${kind}`));
  },
};

async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  let body: unknown = init.body;
  if (typeof init.body === "string") body = JSON.parse(init.body);
  fake.calls.push({ url, method: init.method ?? "GET", headers, body });
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

  if (url === CHANNEL) {
    if (headers["x-webhook-secret"] !== "secreto-entrada") return json({ detail: "bad secret" }, 401);
    return json({ conversation_id: fake.nextConversation, status: "queued" }, 202);
  }
  if (url.startsWith(WAHA)) {
    if (headers["x-api-key"] !== API_KEY) return json({ error: "unauthorized" }, 401);
    if (url === `${WAHA}/api/sendText`) return fake.failSendText ? json({ error: "session stopped" }, 500) : json({ id: "true_x@c.us_OUT" }, 201);
    if (url === `${WAHA}/api/sendVoice`) return json({ id: "true_x@c.us_VOICE" }, 201);
    if (url.startsWith(`${WAHA}/api/default/lids/`)) return json({ lid: "x@lid", pn: fake.lidPhone });
    if (url.startsWith(`${WAHA}/api/files/`) && url.endsWith(".jpeg")) return new Response(new Uint8Array(fake.photo!), { headers: { "Content-Type": "image/jpeg" } });
    if (url.startsWith(`${WAHA}/api/files/`)) return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "Content-Type": "audio/ogg" } });
  }
  if (url === `${OWN_WAHA}/api/sendText`) {
    expect(headers["x-api-key"]).toBe(ownConnection.apiKey);
    return json({ id: "sent_from_own_line" }, 201);
  }
  if (url === `${OWN_WAHA}/api/sendVoice`) {
    expect(headers["x-api-key"]).toBe(ownConnection.apiKey);
    return fake.failSendVoice ? json({ error: "voice unavailable" }, 500) : json({ id: "voice_from_own_line" }, 201);
  }
  if (url.startsWith("https://api.elevenlabs.io/v1/text-to-speech/")) {
    return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "Content-Type": "audio/ogg" } });
  }
  if (url.startsWith("https://api.anthropic.com/v1/messages")) {
    return json({
      id: "msg_foto", type: "message", role: "assistant", model: "claude-opus-5-5",
      content: [{ type: "text", text: JSON.stringify(fake.reading) }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
    });
  }
  if (url === "https://api.elevenlabs.io/v1/speech-to-text") {
    const form = init.body as FormData;
    expect(form.get("model_id")).toBe("scribe_v2");
    return json({ text: fake.transcript });
  }
  throw new Error(`fetch inesperado en el test: ${init.method ?? "GET"} ${url}`);
}

function wahaRequest(event: unknown, opts: { key?: string } = {}) {
  const raw = JSON.stringify(event);
  const hmac = createHmac("sha512", opts.key ?? HMAC_KEY).update(raw).digest("hex");
  return new Request("https://turnia.example/api/waha/webhook", {
    method: "POST",
    body: raw,
    headers: { "x-webhook-hmac": hmac, "x-webhook-hmac-algorithm": "sha512", "content-type": "application/json" },
  });
}

function textMessage(id: string, body: string, from = "5491155550001@c.us", extra: Record<string, unknown> = {}) {
  return { event: "message", session: "default", engine: "NOWEB", payload: { id, from, fromMe: false, body, hasMedia: false, ...extra } };
}

function replyRequest(reply: unknown, secret = SIGNING) {
  const raw = JSON.stringify(reply);
  const t = Math.floor(Date.now() / 1000);
  const signature = `t=${t},v0=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;
  return new Request("https://turnia.example/api/elevenlabs/canal", { method: "POST", body: raw, headers: { "elevenlabs-signature": signature } });
}

const agentSays = (conversationId: string, ids: string[], text: string, end = false) => ({
  version: "1",
  conversation_id: conversationId,
  user_message_ids: ids,
  status: "completed",
  data: [
    { type: "agent_response", event: { agent_response: text, response_id: `r_${ids.join("_")}`, event_id: 1 } },
    ...(end ? [{ type: "agent_tool_response", event: { tool_name: "end_call", tool_type: "system", status: "success", event_id: 1 } }] : []),
  ],
  error: null,
});

describe.runIf(baseUrl)("WhatsApp por WAHA + Custom Channel", () => {
  let sql: typeof import("@/lib/db").sql;
  let inbound: typeof import("@/app/api/waha/webhook/route").POST;
  let reply: typeof import("@/app/api/elevenlabs/canal/route").POST;

  beforeAll(async () => {
    const url = await scratchDatabase(baseUrl!, "turnia_test_waha");
    await resetTestDatabase(url);
    vi.stubEnv("DATABASE_URL", url);
    vi.stubEnv("AGENT_TOOLS_SECRET", "secreto-de-prueba");
    vi.stubEnv("SESSION_SECRET", "sesion-de-prueba");
    vi.stubEnv("ELEVENLABS_API_KEY", "clave-falsa");
    vi.stubEnv("ELEVENLABS_VOICE_ID", "voz-de-sofi");
    vi.stubEnv("WAHA_URL", `${WAHA}/`);
    vi.stubEnv("WAHA_API_KEY", API_KEY);
    vi.stubEnv("WAHA_SESSION", "default");
    vi.stubEnv("WAHA_WEBHOOK_HMAC", HMAC_KEY);
    vi.stubEnv("WAHA_SEND_DELAY_MS", "0");
    vi.stubEnv("ELEVENLABS_CHANNEL_URL", CHANNEL);
    vi.stubEnv("ELEVENLABS_CHANNEL_SECRET", "secreto-entrada");
    vi.stubEnv("ELEVENLABS_CHANNEL_SIGNING_SECRET", SIGNING);
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
    ({ sql } = await import("@/lib/db"));
    await sql`update messaging_settings set active_channel = 'whatsapp' where id`;
    inbound = (await import("@/app/api/waha/webhook/route")).POST;
    reply = (await import("@/app/api/elevenlabs/canal/route")).POST;
    const { createSessionToken } = await import("@/lib/session");
    mocks.session = createSessionToken();
  }, 60000);

  afterAll(async () => {
    const { closeDb } = await import("@/lib/db");
    await closeDb();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  beforeEach(async () => {
    fake.reset();
    mocks.notifyN8n.mockClear();
    vi.stubEnv("WAHA_CONNECTIONS", "");
    await sql`update messaging_settings set active_channel = 'whatsapp' where id`;
  });

  it("rechaza webhooks sin firma válida y avisa si falta la clave", async () => {
    expect((await inbound(wahaRequest(textMessage("m0", "hola"), { key: "otra" }))).status).toBe(401);
    vi.stubEnv("WAHA_WEBHOOK_HMAC", "");
    expect((await inbound(wahaRequest(textMessage("m0", "hola")))).status).toBe(500);
    vi.stubEnv("WAHA_WEBHOOK_HMAC", HMAC_KEY);
    expect((await reply(replyRequest(agentSays("conv_x", ["m0"], "hola"), "otra")))).toHaveProperty("status", 401);
    expect(fake.calls).toHaveLength(0);
  });

  it("un mensaje de texto abre una conversación con todas las variables del paciente", async () => {
    const res = await inbound(wahaRequest(textMessage("m1", "Hola, quiero un turno")));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, conversation_id: "conv_wa_1", continued: false });

    const [call] = fake.sent("channel");
    const body = call.body as { data: { text: string; user_identifier: string }; user_message_id: string; conversation_id?: string; dynamic_variables: Record<string, string> };
    expect(body.data).toEqual({ type: "user_message", text: "Hola, quiero un turno", user_identifier: "5491155550001" });
    expect(body.user_message_id).toBe("m1");
    expect(body.conversation_id).toBeUndefined();
    for (const key of [
      "clinic_id", "clinic_name", "agent_name", "clinic_info", "clinic_catalog", "urgency_instructions",
      "patient_phone", "patient_name", "patient_context", "conversation_context", "campaign_id",
    ]) {
      expect(body.dynamic_variables[key], key).toBeTruthy();
    }
    expect(body.dynamic_variables.patient_name).toBe("María González");
    expect(body.dynamic_variables.campaign_id).toBe("ninguna");

    // WAHA reintenta el mismo mensaje: no se manda dos veces al agente.
    expect(await (await inbound(wahaRequest(textMessage("m1", "Hola, quiero un turno")))).json()).toEqual({ duplicate: true });
    expect(fake.sent("channel")).toHaveLength(1);

    // Ignora mensajes propios, grupos y otros eventos sin llamar a nadie.
    for (const event of [
      textMessage("m_own", "x", "5491155550001@c.us", { fromMe: true }),
      textMessage("m_group", "x", "1203630@g.us"),
      { event: "message.ack", session: "default", payload: { id: "m_ack", from: "5491155550001@c.us" } },
    ]) {
      expect(await (await inbound(wahaRequest(event))).json()).toHaveProperty("ignored");
    }
    expect(fake.sent("channel")).toHaveLength(1);
  });

  it("el segundo mensaje sigue la misma conversación y la respuesta del agente llega por WAHA", async () => {
    await inbound(wahaRequest(textMessage("m2", "Para limpieza, a la mañana")));
    const [call] = fake.sent("channel");
    expect((call.body as { conversation_id?: string }).conversation_id).toBe("conv_wa_1");

    const res = await reply(replyRequest(agentSays("conv_wa_1", ["m2"], "Tengo el **martes 10:00** con la Dra. Ruiz. ¿Te sirve?")));
    expect(res.status).toBe(200);
    const [sent] = fake.sent("sendText");
    expect(sent.body).toEqual({ session: "default", chatId: "5491155550001@c.us", text: "Tengo el *martes 10:00* con la Dra. Ruiz. ¿Te sirve?" });
    expect(sent.headers["x-api-key"]).toBe(API_KEY);

    // ElevenLabs reintenta: no se duplica el mensaje al paciente.
    expect(await (await reply(replyRequest(agentSays("conv_wa_1", ["m2"], "Tengo el **martes 10:00** con la Dra. Ruiz. ¿Te sirve?")))).json()).toMatchObject({
      status: "duplicate",
    });
    expect(fake.sent("sendText")).toHaveLength(1);

    // Queda en el panel como conversación de WhatsApp, con la transcripción.
    const [conv] = await sql<Array<{ channel: string; direction: string; status: string; patient_id: string; transcript: Array<{ role: string; message: string }> }>>`
      select channel, direction, status, patient_id, transcript from conversations where elevenlabs_conversation_id = 'conv_wa_1'`;
    expect(conv).toMatchObject({ channel: "whatsapp", direction: "entrante", status: "in-progress", patient_id: "00000000-0000-4000-8000-0000000000c1" });
    expect(conv.transcript.map((t) => t.role)).toEqual(["user", "user", "agent"]);
  });

  it("si WAHA falla, responde error para que ElevenLabs reintente, y el reintento entrega", async () => {
    await inbound(wahaRequest(textMessage("m3", "Sí, el martes")));
    fake.failSendText = true;
    expect((await reply(replyRequest(agentSays("conv_wa_1", ["m3"], "Listo, reservado.")))).status).toBe(502);
    fake.failSendText = false;
    expect((await reply(replyRequest(agentSays("conv_wa_1", ["m3"], "Listo, reservado.")))).status).toBe(200);
    expect(fake.sent("sendText").filter((c) => (c.body as { text: string }).text === "Listo, reservado.")).toHaveLength(2);
    // Una respuesta de una conversación que todavía no registramos pide reintento.
    expect((await reply(replyRequest(agentSays("conv_desconocida", ["mz"], "hola")))).status).toBe(409);
  });

  it("cuando el agente cierra la conversación, el próximo mensaje abre otra", async () => {
    const res = await reply(replyRequest(agentSays("conv_wa_1", ["m4"], "¡Gracias por escribirnos!", true)));
    expect(await res.json()).toMatchObject({ status: "sent", ended: true });
    const [closed] = await sql<Array<{ closed_at: string | null }>>`select closed_at from channel_conversations where elevenlabs_conversation_id = 'conv_wa_1'`;
    expect(closed.closed_at).not.toBeNull();
    expect(mocks.notifyN8n).toHaveBeenCalledWith("conversacion.finalizada", expect.objectContaining({ conversation_id: "conv_wa_1", channel: "whatsapp" }));

    fake.nextConversation = "conv_wa_2";
    await inbound(wahaRequest(textMessage("m5", "Otra consulta")));
    expect((fake.sent("channel")[0].body as { conversation_id?: string }).conversation_id).toBeUndefined();
  });

  it("después de 15 minutos sin mensajes arranca una conversación nueva", async () => {
    await sql`update channel_conversations set last_activity_at = now() - interval '20 minutes' where elevenlabs_conversation_id = 'conv_wa_2'`;
    fake.nextConversation = "conv_wa_3";
    await inbound(wahaRequest(textMessage("m6", "Hola de nuevo")));
    expect((fake.sent("channel")[0].body as { conversation_id?: string }).conversation_id).toBeUndefined();
    const open = await sql<Array<{ elevenlabs_conversation_id: string }>>`
      select elevenlabs_conversation_id from channel_conversations where phone = '5491155550001' and closed_at is null`;
    expect(open.map((r) => r.elevenlabs_conversation_id)).toEqual(["conv_wa_3"]);
  });

  it("transcribe audios; si no se puede bajar o escuchar, le pide al paciente que escriba", async () => {
    const audio = textMessage("m7", "", "5491155550003@c.us", { hasMedia: true, media: { url: "http://localhost:3000/api/files/default/m7.oga", mimetype: "audio/ogg; codecs=opus" } });
    expect((await inbound(wahaRequest(audio))).status).toBe(200);
    expect(fake.calls.some((c) => c.url === `${WAHA}/api/files/default/m7.oga`)).toBe(true);
    // Lo transcripto llega al agente, con el aviso de que su respuesta va a salir como nota de voz.
    expect((fake.sent("channel")[0].body as { data: { text: string } }).data.text).toBe(
      "(audio) quiero sacar un turno para limpieza\n[Canal: esta respuesta se enviará como nota de voz. Respondé a lo que pide con frases breves para escuchar.]",
    );

    fake.reset();
    const noMedia = textMessage("m8", "", "5491155550003@c.us", { hasMedia: true, media: { url: null, mimetype: "audio/ogg" } });
    await inbound(wahaRequest(noMedia));
    expect(fake.sent("channel")).toHaveLength(0);
    expect((fake.sent("sendText")[0].body as { text: string }).text).toContain("no pude escuchar tu audio");

    fake.reset();
    const photo = textMessage("m9", "", "5491155550003@c.us", { hasMedia: true, media: { url: null, mimetype: "image/jpeg" } });
    await inbound(wahaRequest(photo));
    expect(fake.sent("channel")).toHaveLength(0);
    expect((fake.sent("sendText")[0].body as { text: string }).text).toContain("No pude ver esa foto");
  });

  it("a quien le habla por audio, Sofi le contesta con nota de voz; al texto, con texto", async () => {
    fake.nextConversation = "conv_voz";
    const audio = textMessage("v1", "", "5491155550004@c.us", { hasMedia: true, media: { url: "http://localhost:3000/api/files/default/v1.oga", mimetype: "audio/ogg; codecs=opus" } });
    expect((await inbound(wahaRequest(audio))).status).toBe(200);
    // El agente sabe que su respuesta se va a escuchar.
    expect((fake.sent("channel")[0].body as { data: { text: string } }).data.text).toContain("se enviará como nota de voz");

    // La respuesta al audio sale como nota de voz (Ogg Opus sin convertir); el link va además por escrito.
    expect((await reply(replyRequest(agentSays("conv_voz", ["v1"], "Te reservé el **martes 10:00**. Confirmá acá: https://turnia.example/c/1")))).status).toBe(200);
    const [voice] = fake.sent("sendVoice");
    expect(voice.body).toMatchObject({ session: "default", chatId: "5491155550004@c.us", convert: false, file: { mimetype: "audio/ogg; codecs=opus" } });
    const tts = fake.calls.find((c) => c.url.includes("/text-to-speech/"))!;
    expect(tts.url).toContain("/text-to-speech/voz-de-sofi?");
    expect((tts.body as { text: string }).text).toBe("Te reservé el martes 10:00. Confirmá acá: el enlace del mensaje escrito");
    expect((fake.sent("sendText")[0].body as { text: string }).text).toContain("https://turnia.example/c/1");

    // Si después escribe, la respuesta vuelve a ser texto.
    fake.reset();
    await inbound(wahaRequest(textMessage("v2", "Gracias", "5491155550004@c.us")));
    await reply(replyRequest(agentSays("conv_voz", ["v2"], "¡De nada!")));
    expect(fake.sent("sendVoice")).toHaveLength(0);
    expect((fake.sent("sendText")[0].body as { text: string }).text).toBe("¡De nada!");
  });

  it("la plantilla de la ficha de salud llega en un mensaje aparte, para copiarla sola", async () => {
    fake.nextConversation = "conv_ficha";
    await inbound(wahaRequest(textMessage("f1", "Quiero una consulta", "5491155550009@c.us")));
    const plantilla = "📋 FICHA DE SALUD\nCopiar este mensaje…\n\nAnemia:\nDiabetes:";
    const res = await reply(replyRequest(agentSays("conv_ficha", ["f1"], `Listo: tu consulta quedó **confirmada**.\nPodés adelantarte completando la ficha por acá.\n\n${plantilla}`)));
    expect(res.status).toBe(200);
    expect(fake.sent("sendText").map((c) => (c.body as { text: string }).text)).toEqual([
      "Listo: tu consulta quedó *confirmada*.\nPodés adelantarte completando la ficha por acá.",
      plantilla,
    ]);
  });

  it("lee la foto de la credencial: el agente recibe lo que dice y queda en la ficha del paciente", async () => {
    const sharp = (await import("sharp")).default;
    fake.photo = await sharp({ create: { width: 40, height: 25, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
    fake.reading = {
      tipo: "credencial", legible: true, cobertura: "OSDE", plan: "210", numero_afiliado: "61 234567 8 01", titular: "Lucía Paz",
      practica: null, profesional: null, fecha: null, diagnostico: null, medicamentos: null, resumen: "Credencial de OSDE",
    };
    vi.stubEnv("ANTHROPIC_API_KEY", "clave-falsa");
    try {
      const photo = textMessage("m_foto1", "", "5491155550006@c.us", { hasMedia: true, media: { url: "http://localhost:3000/api/files/default/m_foto1.jpeg", mimetype: "image/jpeg" } });
      expect((await inbound(wahaRequest(photo))).status).toBe(200);
      const toClaude = fake.calls.find((c) => c.url.startsWith("https://api.anthropic.com/v1/messages"))!.body as { messages: Array<{ content: Array<{ type: string; source?: { media_type: string } }> }> };
      expect(toClaude.messages[0].content[0]).toMatchObject({ type: "image", source: { media_type: "image/jpeg" } });
      const text = (fake.sent("channel")[0].body as { data: { text: string } }).data.text;
      expect(text).toContain("(foto de la credencial) cobertura: «OSDE», plan: «210», número de afiliado: «61 234567 8 01»");

      const [doc] = await sql<Array<{ id: string; kind: string; channel: string; mimetype: string }>>`
        select id, kind, channel, mimetype from patient_documents where phone = '5491155550006'`;
      expect(doc).toMatchObject({ kind: "credencial", channel: "whatsapp", mimetype: "image/jpeg" });

      // En el panel: aparece en la ficha y se abre la foto.
      const [p] = await sql<Array<{ id: string }>>`insert into patients (clinic_id, phone, full_name) values (${CLINIC}, '5491155550006', 'Lucía Paz') returning id`;
      const page = (await import("@/app/panel/(app)/pacientes/[id]/page")).default;
      const html = renderToStaticMarkup(await page({ params: Promise.resolve({ id: p.id }), searchParams: Promise.resolve({}) } as never));
      expect(html).toContain("Fotos y documentos que mandó");
      expect(html).toContain(`/panel/pacientes/${p.id}/documentos/${doc.id}`);
      const { GET } = await import("@/app/panel/(app)/pacientes/[id]/documentos/[doc]/route");
      const res = await GET(new Request("https://turnia.example/x"), { params: Promise.resolve({ id: p.id, doc: doc.id }) } as never);
      expect(res.headers.get("content-type")).toBe("image/jpeg");
      expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(100);
      // De otro paciente, no.
      const [other] = await sql<Array<{ id: string }>>`insert into patients (clinic_id, phone, full_name) values (${CLINIC}, '5491155550007', 'Otro') returning id`;
      expect((await GET(new Request("https://turnia.example/x"), { params: Promise.resolve({ id: other.id, doc: doc.id }) } as never)).status).toBe(404);

      // Al borrar la ficha se borra también la foto.
      const { deletePatients } = await import("@/lib/patients");
      await deletePatients(CLINIC, [p.id]);
      expect(await sql`select 1 from patient_documents where id = ${doc.id}`).toHaveLength(0);
    } finally {
      vi.stubEnv("ANTHROPIC_API_KEY", "");
    }
  });

  it("chats @lid: busca el teléfono en WAHA y responde al mismo chat", async () => {
    fake.nextConversation = "conv_lid";
    await inbound(wahaRequest(textMessage("m10", "Hola", "987654321@lid")));
    expect(fake.calls.some((c) => c.url === `${WAHA}/api/default/lids/987654321%40lid`)).toBe(true);
    const body = fake.sent("channel")[0].body as { data: { user_identifier: string }; dynamic_variables: Record<string, string> };
    expect(body.data.user_identifier).toBe("5491155550002");
    expect(body.dynamic_variables.patient_name).toBe("Jorge Pérez");
    await reply(replyRequest(agentSays("conv_lid", ["m10"], "¡Hola Jorge!")));
    expect(fake.sent("sendText")[0].body).toMatchObject({ chatId: "987654321@lid", text: "¡Hola Jorge!" });

    fake.reset();
    fake.lidPhone = null;
    expect(await (await inbound(wahaRequest(textMessage("m11", "Hola", "111@lid")))).json()).toEqual({ ignored: "sin teléfono" });
    expect(fake.sent("channel")).toHaveLength(0);
  });

  it("las campañas salen por WAHA y la respuesta del paciente llega con el contexto de la campaña", async () => {
    const { createCampaign, sendCampaign } = await import("@/lib/campaigns");
    const tomorrow = new Date(Date.now() + 24 * 3600_000);
    await sql`
      insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, source)
      values (${CLINIC}, '00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000b5',
        ${tomorrow}, ${new Date(tomorrow.getTime() + 40 * 60_000)}, 'confirmado', 'panel')`;

    // Con Meta sin configurar no se puede enviar; con WAHA sí.
    const campaign = await createCampaign({ clinicId: CLINIC, name: "Recordatorios WAHA", type: "recordatorio", templateName: "recordatorio" });
    await expect(sendCampaign(campaign.id)).rejects.toThrow("ID del número de WhatsApp");
    await sql`update clinics set whatsapp_provider = 'waha' where id = ${CLINIC}`;
    vi.stubEnv("WAHA_API_KEY", "");
    await expect(sendCampaign(campaign.id)).rejects.toThrow("Faltan variables de WAHA en Vercel: WAHA_API_KEY.");
    vi.stubEnv("WAHA_API_KEY", API_KEY);

    const result = await sendCampaign(campaign.id);
    expect(result).toMatchObject({ sent: 1, failed: 0 });
    const [sent] = fake.sent("sendText");
    expect((sent.body as { chatId: string }).chatId).toBe("5491155550004@c.us");
    expect((sent.body as { text: string }).text).toMatch(/^¡Hola Lucas! Te recordamos tu turno el .+ con Dra\. .+\. ¿Nos confirmás si venís\?/);
    expect((sent.body as { text: string }).text).not.toContain("BAJA");
    expect(fake.sent("channel")).toHaveLength(0);

    // El paciente responde horas después: el agente recibe el contexto y la campaña.
    await sql`update channel_conversations set last_activity_at = now() - interval '3 hours' where phone = '5491155550004'`;
    fake.nextConversation = "conv_campana";
    await inbound(wahaRequest(textMessage("m12", "Sí, voy", "5491155550004@c.us")));
    const vars = (fake.sent("channel")[0].body as { dynamic_variables: Record<string, string>; conversation_id?: string }).dynamic_variables;
    expect(vars.campaign_id).toBe(campaign.id);
    expect(vars.conversation_context).toContain("Recordatorio del turno");
    expect(vars.conversation_context).toContain("Ya le mandamos este mensaje por WhatsApp");

    await reply(replyRequest(agentSays("conv_campana", ["m12"], "¡Gracias Lucas! Te esperamos.", true)));
    const [recipient] = await sql<Array<{ status: string }>>`select status from campaign_recipients where campaign_id = ${campaign.id}`;
    expect(recipient.status).toBe("respondio");
    const [conv] = await sql<Array<{ direction: string; campaign_id: string }>>`select direction, campaign_id from conversations where elevenlabs_conversation_id = 'conv_campana'`;
    expect(conv).toEqual({ direction: "saliente", campaign_id: campaign.id });

    // Los mensajes que el paciente no pidió llevan cómo darse de baja.
    const { renderTemplate } = await import("@/lib/whatsapp");
    expect(renderTemplate("reactivacion", ["Ana", "Centro Médico Plaza"], { optOutFooter: true })).toContain("respondé BAJA");
  });

  it("responder un pedido desde el panel le escribe al paciente por WAHA", async () => {
    const service = await import("@/lib/agent/service");
    const { resolveTask } = await import("@/lib/tasks");
    const c = { clinicId: CLINIC, patientPhone: "5491155550003", channel: "custom_channel", conversationId: "conv_x" };
    const { tarea_id } = await service.createTask(c, { tipo: "receta", titulo: "Renovar receta" });
    const result = await resolveTask(CLINIC, tarea_id, "Ya está lista, la retirás en recepción.");
    expect(result).toMatchObject({ ok: true, notified: true });
    expect(fake.sent("sendText")[0].body).toMatchObject({
      chatId: "5491155550003@c.us",
      text: "Hola Ana, te escribimos por tu pedido: Ya está lista, la retirás en recepción. Si necesitás algo más, respondé este mensaje.",
    });
  });

  it("una línea propia usa su clínica y devuelve la respuesta por su instancia con Telegram general activo", async () => {
    await sql`insert into clinics (id, name, is_demo, retained_at) values (${OWN_CLINIC}, 'Consultorio de prueba', true, now())`;
    vi.stubEnv("WAHA_CONNECTIONS", JSON.stringify([ownConnection]));
    await sql`update messaging_settings set active_channel = 'telegram' where id`;
    const ownInbound = (await import("@/app/api/waha/webhook/[connection]/route")).POST;
    const context = { params: Promise.resolve({ connection: ownConnection.id }) };
    const event = { ...textMessage("own1", "Quiero probar la demo"), me: { id: `${ownConnection.phone}@c.us` } };
    fake.nextConversation = "conv_own";
    const res = await ownInbound(wahaRequest(event, { key: ownConnection.webhookHmac }), context);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ conversation_id: "conv_own" });
    const vars = (fake.sent("channel")[0].body as { dynamic_variables: Record<string, string> }).dynamic_variables;
    expect(vars.clinic_id).toBe(OWN_CLINIC);
    expect(JSON.stringify(vars)).toContain("Consultorio de prueba");
    const [conv] = await sql`select clinic_id, waha_connection_id from channel_conversations where elevenlabs_conversation_id = 'conv_own'`;
    expect(conv).toMatchObject({ clinic_id: OWN_CLINIC, waha_connection_id: ownConnection.id });
    await reply(replyRequest(agentSays("conv_own", ["own1"], "¿En qué puedo ayudar?")));
    expect(fake.calls.filter((c) => c.url === `${OWN_WAHA}/api/sendText`)).toHaveLength(1);
    expect(fake.sent("sendText")).toHaveLength(0);
    const { selectMessagingChannel } = await import("@/lib/messaging-settings");
    await selectMessagingChannel("pausado");
    const [stillOpen] = await sql`select closed_at from channel_conversations where elevenlabs_conversation_id = 'conv_own'`;
    expect(stillOpen.closed_at).toBeNull();
    // Una configuración eliminada o reasignada no cae en el número general.
    for (const config of [[], [{ ...ownConnection, clinicId: CLINIC }], [{ ...ownConnection, enabled: false }], [{ ...ownConnection, revision: 2 }]]) {
      vi.stubEnv("WAHA_CONNECTIONS", JSON.stringify(config));
      const out = await reply(replyRequest(agentSays("conv_own", ["own2"], "No debe enviarse")));
      expect(await out.json()).toMatchObject({ status: "inactive" });
    }
    expect(fake.calls.filter((c) => c.url.endsWith("/api/sendText"))).toHaveLength(1);
  });

  it("envía audio con la voz del consultorio solo para el mensaje que lo pidió, y usa texto si falla", async () => {
    await sql`
      insert into clinics (id, name, elevenlabs_voice_id) values (${OWN_CLINIC}, 'Consultorio de prueba', 'voz-propia')
      on conflict (id) do update set elevenlabs_voice_id = excluded.elevenlabs_voice_id`;
    vi.stubEnv("WAHA_CONNECTIONS", JSON.stringify([ownConnection]));
    await sql`update messaging_settings set active_channel = 'telegram' where id`;
    const ownInbound = (await import("@/app/api/waha/webhook/[connection]/route")).POST;
    const send = (id: string, text: string) => ownInbound(
      wahaRequest(textMessage(id, text, "5491155550040@c.us"), { key: ownConnection.webhookHmac }),
      { params: Promise.resolve({ connection: ownConnection.id }) },
    );
    fake.nextConversation = "conv_own_voice";
    expect((await send("voice1", "¿Me podés recordar el turno pero en audio?")).status).toBe(200);
    expect((await send("text2", "No tengo audio, prefiero por escrito")).status).toBe(200);
    expect(fake.sent("channel")[0].body).toMatchObject({ data: { text: expect.stringContaining("se enviará como nota de voz") } });
    await reply(replyRequest(agentSays("conv_own_voice", ["text2"], "Este va por escrito.")));
    await reply(replyRequest(agentSays("conv_own_voice", ["voice1"], "Su turno es el miércoles.")));

    const voices = () => fake.calls.filter((c) => c.url === `${OWN_WAHA}/api/sendVoice`);
    const texts = () => fake.calls.filter((c) => c.url === `${OWN_WAHA}/api/sendText`);
    expect(voices()).toHaveLength(1);
    expect(voices()[0].body).toMatchObject({ chatId: "5491155550040@c.us", convert: false });
    expect(texts()).toHaveLength(1);
    expect(fake.calls.some((c) => c.url.includes("/text-to-speech/voz-propia?"))).toBe(true);

    fake.failSendVoice = true;
    expect((await send("voice3", "Pero envíamelo en audio")).status).toBe(200);
    await reply(replyRequest(agentSays("conv_own_voice", ["voice3"], "Atendemos de lunes a jueves.")));
    expect(voices()).toHaveLength(2);
    expect(texts().map((c) => c.body)).toEqual([
      expect.objectContaining({ text: "Este va por escrito." }),
      expect.objectContaining({ text: "Atendemos de lunes a jueves." }),
    ]);
  });

  it("la firma de otra instancia, otro número o sesión no alcanzan al agente", async () => {
    vi.stubEnv("WAHA_CONNECTIONS", JSON.stringify([ownConnection]));
    const ownInbound = (await import("@/app/api/waha/webhook/[connection]/route")).POST;
    const context = { params: Promise.resolve({ connection: ownConnection.id }) };
    const event = { ...textMessage("wrong-own", "Hola"), me: { id: "5491155558888@c.us" } };
    expect((await ownInbound(wahaRequest(event), context)).status).toBe(401);
    expect(await (await ownInbound(wahaRequest(event, { key: ownConnection.webhookHmac }), context)).json()).toMatchObject({ ignored: "otro número" });
    expect(await (await ownInbound(wahaRequest({ ...event, session: "otra" }, { key: ownConnection.webhookHmac }), context)).json()).toMatchObject({ ignored: "otra sesión" });
    expect((await ownInbound(wahaRequest(event), { params: Promise.resolve({ connection: "desconocida" }) })).status).toBe(404);
    expect(fake.sent("channel")).toHaveLength(0);
  });

  it("si Sofi ofreció horarios y el paciente no contesta, le vuelve a escribir con los que siguen libres (hasta 2 veces)", async () => {
    const service = await import("@/lib/agent/service");
    const { sendOfferFollowups } = await import("@/lib/followups");
    const LIMPIEZA = "00000000-0000-4000-8000-0000000000b5";
    // Mediodía de Buenos Aires dentro de `days` días: siempre en el horario en que se escribe.
    const noon = (days: number) =>
      new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(Date.now() + days * 86400_000))}T12:00:00-03:00`);
    const offer = async (phone: string, conversation: string, messageId: string) => {
      fake.nextConversation = conversation;
      await inbound(wahaRequest(textMessage(messageId, "Hola, quiero un turno para limpieza", `${phone}@c.us`)));
      const c = { clinicId: CLINIC, patientPhone: phone, conversationId: conversation, channel: "whatsapp" };
      const { turnos } = await service.checkAvailability(c, { tipo_turno_id: LIMPIEZA });
      await reply(replyRequest(agentSays(conversation, [messageId], `Tengo el ${turnos[0].cuando}. ¿Te sirve?`)));
      return c;
    };
    await sql`update clinics set whatsapp_provider = 'waha', followup_attempts = 2, followup_delay_hours = 2 where id = ${CLINIC}`;
    try {
      const c = await offer("5491155550077", "conv_seguimiento", "seg1");
      await service.registerPatient(c, { nombre_completo: "Paula Pendiente" });
      fake.calls = [];

      // Recién ofrecido, todavía no.
      expect(await sendOfferFollowups()).toMatchObject({ enviados: 0 });
      // Mañana al mediodía: el primero, con los horarios libres de ese momento y desde el mismo chat.
      expect(await sendOfferFollowups(noon(1))).toMatchObject({ enviados: 1 });
      const [first] = fake.sent("sendText");
      expect(first.body).toMatchObject({ chatId: "5491155550077@c.us" });
      expect((first.body as { text: string }).text).toMatch(/^Hola Paula, sobre el turno de limpieza dental: todavía hay lugar el .+ a las \d{2}:\d{2}( o el .+)?\. ¿(Reservamos alguno|Lo reservamos)\?$/);
      // Otra corrida en el mismo momento no lo repite.
      expect(await sendOfferFollowups(noon(1))).toMatchObject({ enviados: 0 });
      // Al otro día, el segundo y último.
      expect(await sendOfferFollowups(noon(2))).toMatchObject({ enviados: 1 });
      expect((fake.sent("sendText")[1].body as { text: string }).text).toMatch(/^Hola Paula, retomo lo del turno de limpieza dental/);
      expect(await sendOfferFollowups(noon(3))).toMatchObject({ enviados: 0 });
      expect(fake.sent("sendText")).toHaveLength(2);

      // Si contesta, el agente sabe por qué le escribimos y que tiene que volver a mirar la agenda.
      fake.nextConversation = "conv_seguimiento_respuesta";
      await inbound(wahaRequest(textMessage("seg2", "Sí, el primero", "5491155550077@c.us")));
      const answer = fake.sent("channel").at(-1)!.body as { conversation_id?: string; dynamic_variables: Record<string, string> };
      expect(answer.conversation_id).toBeUndefined();
      expect(answer.dynamic_variables.conversation_context).toContain("Seguimiento automático: le ofreciste turno para Limpieza dental y no respondió");
      expect(answer.dynamic_variables.conversation_context).toContain("volvé a consultar la disponibilidad antes de reservar");
      expect(answer.dynamic_variables.conversation_context).toContain("retomo lo del turno de limpieza dental");

      // Quien contestó algo después de los horarios (aunque sea «lo pienso») no recibe seguimiento.
      await offer("5491155550078", "conv_lo_pienso", "seg3");
      await inbound(wahaRequest(textMessage("seg4", "Lo pienso y te aviso", "5491155550078@c.us")));
      // Con 0 intentos elegidos en el panel, tampoco.
      await sql`update clinics set followup_attempts = 0 where id = ${CLINIC}`;
      await offer("5491155550079", "conv_sin_seguimiento", "seg5");
      fake.calls = [];
      expect(await sendOfferFollowups(noon(1))).toMatchObject({ enviados: 0 });
      expect(fake.sent("sendText")).toHaveLength(0);
      const open = await sql`select patient_phone from agent_offers where closed_at is null`;
      expect(open).toHaveLength(0);
    } finally {
      await sql`update clinics set followup_attempts = 1, followup_delay_hours = 2 where id = ${CLINIC}`;
    }
  });

  it("Sistema muestra el proveedor y qué variables faltan, sin mostrar valores", async () => {
    const actions = await import("@/app/panel/actions");
    const page = (await import("@/app/panel/(app)/sistema/page")).default;
    vi.stubEnv("ELEVENLABS_CHANNEL_SIGNING_SECRET", "");
    const html = renderToStaticMarkup((await page()) as React.ReactElement);
    vi.stubEnv("ELEVENLABS_CHANNEL_SIGNING_SECRET", SIGNING);
    expect(html).toContain("WhatsApp por WAHA");
    expect(html).toContain("Falta</span></span><code class=\"text-xs\">ELEVENLABS_CHANNEL_SIGNING_SECRET</code>");
    expect(html).toContain("/api/waha/webhook");
    expect(html).toContain("/api/elevenlabs/canal");
    expect(html).not.toContain(API_KEY);
    expect(html).not.toContain(HMAC_KEY);

    const form = new FormData();
    form.set("name", "Centro Médico Plaza (demo)");
    form.set("agent_name", "Sofi");
    form.set("whatsapp_provider", "meta");
    await actions.saveClinic(form);
    const [clinic] = await sql<Array<{ whatsapp_provider: string }>>`select whatsapp_provider from clinics where id = ${CLINIC}`;
    expect(clinic.whatsapp_provider).toBe("waha"); // Guardar el contexto conserva la conexión.

    const { GET } = await import("@/app/api/health/route");
    expect((await (await GET()).json()).configured).toMatchObject({ waha: true });
  });
});
