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

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** Simula WAHA y ElevenLabs. Cada respuesta se puede cambiar por test. */
const fake = {
  calls: [] as Call[],
  nextConversation: "conv_wa_1",
  failSendText: false,
  transcript: "quiero sacar un turno para limpieza",
  lidPhone: "5491155550002@c.us" as string | null,
  reset() {
    this.calls = [];
    this.nextConversation = "conv_wa_1";
    this.failSendText = false;
    this.transcript = "quiero sacar un turno para limpieza";
    this.lidPhone = "5491155550002@c.us";
  },
  sent(kind: "channel" | "sendText") {
    return this.calls.filter((c) => (kind === "channel" ? c.url === CHANNEL : c.url === `${WAHA}/api/sendText`));
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
    if (url.startsWith(`${WAHA}/api/default/lids/`)) return json({ lid: "x@lid", pn: fake.lidPhone });
    if (url.startsWith(`${WAHA}/api/files/`)) return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "Content-Type": "audio/ogg" } });
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

  beforeEach(() => {
    fake.reset();
    mocks.notifyN8n.mockClear();
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
    expect((fake.sent("channel")[0].body as { data: { text: string } }).data.text).toBe("(audio) quiero sacar un turno para limpieza");

    fake.reset();
    const noMedia = textMessage("m8", "", "5491155550003@c.us", { hasMedia: true, media: { url: null, mimetype: "audio/ogg" } });
    await inbound(wahaRequest(noMedia));
    expect(fake.sent("channel")).toHaveLength(0);
    expect((fake.sent("sendText")[0].body as { text: string }).text).toContain("no pude escuchar tu audio");

    fake.reset();
    const photo = textMessage("m9", "", "5491155550003@c.us", { hasMedia: true, media: { url: null, mimetype: "image/jpeg" } });
    await inbound(wahaRequest(photo));
    expect(fake.sent("channel")).toHaveLength(0);
    expect((fake.sent("sendText")[0].body as { text: string }).text).toContain("no puedo ver fotos");
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
