import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Audios de seguimiento: grabados una vez, salen como nota de voz desde el número de la
// prospección (WAHA simulado), de a uno, una sola vez por persona, dentro del horario y del tope
// del día, y cada envío cuenta como un mensaje de los tres.

const mocks = vi.hoisted(() => ({ capture: [] as Array<{ event: string; properties: Record<string, unknown> }> }));
vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn(async () => {}) }));
vi.mock("@/lib/analytics-server", () => ({
  captureLater: (event: string, _id: string, properties: Record<string, unknown> = {}) => mocks.capture.push({ event, properties }),
}));
vi.mock("@/lib/panel-clinic", () => ({ requireAdmin: async () => {} }));
vi.mock("@/lib/sheets/turnia-sheet", () => ({ queueTurniaSheetSync: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// Las pausas («grabando audio…») no esperan en el test.
vi.mock("node:timers/promises", () => ({ setTimeout: async () => {} }));

const base = testDatabaseUrl();
const calls: Array<{ path: string; body: Record<string, unknown> | null }> = [];
let session = { status: "WORKING", me: { id: "5492235000000@c.us" } };
let secondarySession: { status: string; me: { id: string } | null };
let exists = true;
let chatsStore = true;
let sendVoiceFails = false;

async function fakeWaha(input: RequestInfo | URL, init: RequestInit = {}) {
  const url = new URL(String(input));
  calls.push({ path: url.pathname, body: init.body ? JSON.parse(String(init.body)) : null });
  if (url.pathname === "/api/sessions/secondary") return Response.json(secondarySession);
  if (url.pathname === "/api/sessions/secondary/restart") {
    secondarySession = { status: "SCAN_QR_CODE", me: null };
    return Response.json(secondarySession);
  }
  if (url.pathname === "/api/secondary/auth/qr") return Response.json({ mimetype: "image/png", data: "aW1hZ2U=" });
  if (url.pathname === "/api/sessions/prospeccion") return Response.json(session);
  if (url.pathname === "/api/contacts/check-exists") return Response.json({ numberExists: exists, chatId: exists ? `${url.searchParams.get("phone")}@c.us` : null });
  if (url.pathname === "/api/prospeccion/chats") {
    if (!chatsStore) return new Response("Enable NOWEB store", { status: 400 });
    return url.searchParams.get("offset") === "0"
      ? Response.json([{ id: "5492236000001@c.us" }, { id: "99887766@lid" }, { id: "55443322@lid" }, { id: "11223344@lid" }, { id: "120363000000@g.us" }, { id: "5492236999999@c.us" }])
      : Response.json([]);
  }
  if (url.pathname === "/api/prospeccion/lids") return Response.json([{ lid: "99887766@lid", pn: "5492236000002@c.us" }]);
  // Uno que la lista general no trae: se resuelve de a uno.
  // Uno que WAHA solo conoce al revés, por el teléfono del contacto.
  if (url.pathname === "/api/prospeccion/lids/pn/5492236000003%40c.us") return Response.json({ lid: "11223344@lid", pn: "5492236000003@c.us" });
  if (url.pathname === "/api/prospeccion/lids/55443322%40lid") return Response.json({ lid: "55443322@lid", pn: "5492236000777@c.us" });
  if (url.pathname === "/api/prospeccion/media/convert/voice") {
    return Response.json({ data: Buffer.from("OggS...OpusHead").toString("base64") });
  }
  if (url.pathname === "/api/sendVoice" && sendVoiceFails) return new Response("timeout", { status: 503 });
  return Response.json({ id: "msg" });
}

describe.runIf(base)("audios de seguimiento", () => {
  let sql: typeof import("@/lib/db").sql;
  let voice: typeof import("@/lib/sales/voice-outreach");
  let actions: typeof import("@/app/panel/(app)/prospeccion/audio/actions");
  const id = async (code: string) => (await sql<Array<{ id: string }>>`select id from sales_outreach where code = ${code}`)[0].id;

  beforeAll(async () => {
    const url = await scratchDatabase(base!, "turnia_test_voice");
    await resetTestDatabase(url);
    for (const [key, value] of Object.entries({
      DATABASE_URL: url, SESSION_SECRET: "s", AGENT_TOOLS_SECRET: "t", APP_URL: "https://turnia.example",
      WAHA_PROSPECCION: JSON.stringify({ url: "https://waha.example/", apiKey: "clave-de-prueba", session: "prospeccion", phone: "5492235000000" }),
    })) vi.stubEnv(key, value);
    vi.stubGlobal("fetch", fakeWaha);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T13:00:00Z")); // 10:00 en Buenos Aires
    ({ sql } = await import("@/lib/db"));
    voice = await import("@/lib/sales/voice-outreach");
    actions = await import("@/app/panel/(app)/prospeccion/audio/actions");
    const rows: Array<[string, string, string, number, string | null, string | null]> = [
      ["noabrio-a1", "Ana Uno", "+5492236000001", 1, null, null],
      ["abrio-b2", "Beto Dos", "+5492236000002", 1, "2026-11-01", null],
      ["hablo-c3", "Caro Tres", "+5492236000003", 2, "2026-11-01", "2026-11-02"],
      ["tres-d4", "Dani Cuatro", "+5492236000004", 3, null, null],
    ];
    for (const [code, name, phone, touches, opened, demo] of rows) {
      await sql`insert into sales_outreach (code, name, greeting, phone, phone_kind, status, touches, first_contact_at, opened_at, demo_at)
                values (${code}, ${name}, ${name.split(" ")[0]}, ${phone}, 'movil', 'contactado', ${touches}, now() - interval '5 days', ${opened}, ${demo})`;
    }
    await sql`insert into sales_outreach (code, name, phone, phone_kind, status, touches) values ('baja-e5', 'Eva Baja', '+5492236000005', 'movil', 'contactado', 1)`;
    // «Habló con Sofi» es haber conversado en su demo (como en Chapa Labs), no solo tocar «Probar».
    const [clinic] = await sql<Array<{ id: string }>>`insert into clinics (name, is_demo) values ('Demo Caro', true) returning id`;
    const [lead] = await sql<Array<{ id: string }>>`insert into leads (name, email, source) values ('Demo Caro', 'caro@example.com', 'demo-web') returning id`;
    await sql`insert into demo_sessions (phone, chat_id, website, lead_id, clinic_id, status) values ('web:c3', 'web:c3', '', ${lead.id}, ${clinic.id}, 'eligiendo')`;
    await sql`insert into conversations (clinic_id, channel, transcript) values (${clinic.id}, 'web', ${sql.json([{ role: "agent", message: "¡Hola! Soy Sofi." }, { role: "user", message: "Quiero un turno" }])})`;
    await sql`update sales_outreach set lead_id = ${lead.id} where code = 'hablo-c3'`;
    // Tocó «Probar» pero no llegó a hablar: sigue en «la abrió».
    await sql`insert into sales_outreach (code, name, greeting, phone, phone_kind, status, touches, opened_at, demo_at)
              values ('toco-f6', 'Fede Seis', 'Fede', '+5492236000006', 'movil', 'contactado', 1, now(), now())`;
    await sql`insert into sales_suppressions (phone, reason) values ('+5492236000005', 'prueba')`;
    // Antes de la demo: una por saludar, un número compartido (se saluda una vez, por la de mejor
    // prioridad) y uno ya saludado al que le falta la demo.
    await sql`insert into sales_outreach (code, name, greeting, title, phone, phone_kind, status, touches, priority)
              values ('saludo-g7', 'Gabriela Siete', 'Gabi', 'Dra.', '+5492236000007', 'movil', 'por_contactar', 0, 1),
                     ('compartido-i9', 'Inés Nueve', 'Inés', '', '+5492236000009', 'movil', 'por_contactar', 0, 1),
                     ('compartido-j9', 'Juan Nueve', 'Juan', '', '+5492236000009', 'movil', 'por_contactar', 0, 2)`;
    await sql`insert into sales_outreach (code, name, greeting, phone, phone_kind, status, touches, greeted_at, first_contact_at)
              values ('saludado-h8', 'Hugo Ocho', 'Hugo', '+5492236000008', 'movil', 'contactado', 0, now() - interval '1 day', now() - interval '1 day')`;
  }, 60000);

  afterAll(async () => {
    await (await import("@/lib/db")).closeDb();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    calls.length = 0;
    session = { status: "WORKING", me: { id: "5492235000000@c.us" } };
    secondarySession = { status: "WORKING", me: { id: "5491130235483@c.us" } };
    exists = true;
    chatsStore = true;
    sendVoiceFails = false;
  });

  it("solo devuelve el QR del 5483 autorizado y recupera una sesión fallida sin cerrar una activa", async () => {
    const { GET, POST } = await import("@/app/api/prospeccion/audio/route");
    const { CHAPA_PROSPECTING_ORIGIN } = await import("@/lib/sales/chapa-voice");
    const { createProspectingVoiceToken } = await import("@/lib/session");
    const url = "https://turnia.example/api/prospeccion/audio";
    const headers = { Origin: CHAPA_PROSPECTING_ORIGIN, Authorization: `Bearer ${createProspectingVoiceToken()}` };
    const reconnect = (relink: boolean) => POST(new Request(url, {
      method: "POST", headers, body: JSON.stringify({ action: "reconnect", relink }),
    }));
    vi.stubEnv("WAHA_PROSPECCION_5483", JSON.stringify({
      url: "https://waha-secondary.example", apiKey: "clave-secundaria", session: "secondary", phone: "5491130235483",
    }));

    const qrUrl = url + "?view=connection";
    expect((await GET(new Request(qrUrl))).status).toBe(401);
    expect((await reconnect(true)).status).toBe(200);
    expect(calls.map((call) => call.path)).toEqual(["/api/sessions/secondary"]);

    secondarySession.status = "FAILED";
    expect((await reconnect(false)).status).toBe(200);
    const result = await GET(new Request(qrUrl, { headers }));
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(await result.json()).toEqual({ status: "SCAN_QR_CODE", ready: false, hasAccount: false, qr: "aW1hZ2U=" });
    expect(calls.map((call) => call.path)).toEqual([
      "/api/sessions/secondary", "/api/sessions/secondary", "/api/sessions/secondary/restart",
      "/api/sessions/secondary", "/api/secondary/auth/qr",
    ]);
  });

  it("sugiere contactos con chats, también los @lid, sin confirmar líneas ni mandar nada", async () => {
    expect(voice.phoneFromChatId("5492236000001@c.us")).toBe("+5492236000001");
    expect(voice.phoneFromChatId("120363000000@g.us")).toBeNull();
    const suggestions = await voice.suggestVoiceSendersFromWaha();
    expect(suggestions).toMatchObject({
      sender: "0000", chats: 6, matched: 3, inserted: 0, phones: 5,
      kinds: { numero: 2, lid: 3, lidSinNumero: 0, grupos: 1, otros: 0 },
    });
    expect(suggestions.suggestions.sort()).toEqual((await Promise.all([id("noabrio-a1"), id("abrio-b2"), id("hablo-c3")])).sort());
    expect((await voice.voiceCandidates("no_abrio", null))[0].senders).toEqual([]);
    expect(calls.some((c) => c.path.startsWith("/api/send"))).toBe(false);

    chatsStore = false;
    await expect(voice.suggestVoiceSendersFromWaha()).rejects.toThrow("store");
  });

  it("arma los tres grupos con las definiciones del embudo, sin baja ni quien ya usó los tres mensajes", async () => {
    expect(await voice.voiceGroupCounts()).toEqual({ saludo: 2, presentacion: 1, no_abrio: 1, abrio: 2, hablo: 1, no_interesa: 0 });
    expect((await voice.voiceCandidates("saludo", null)).map((c) => c.name).sort()).toEqual(["Gabriela Siete", "Inés Nueve"]);
    expect((await voice.voiceCandidates("presentacion", null)).map((c) => c.name)).toEqual(["Hugo Ocho"]);
    expect((await voice.voiceCandidates("hablo", null)).map((c) => c.name)).toEqual(["Caro Tres"]);
    expect((await voice.voiceCandidates("no_abrio", null)).map((c) => c.name)).toEqual(["Ana Uno"]);
  });

  it("sube el audio, lo prueba con un número propio y lo manda una sola vez a cada persona", async () => {
    const form = new FormData();
    form.set("label", "No abrieron · v1");
    form.set("audio", new File([Buffer.from("OggS-audio")], "nota.opus", { type: "" }));
    const up = await actions.uploadVoiceAction(undefined, form);
    expect(up).toMatchObject({ ok: true });
    const noteId = up.id!;

    expect(await actions.testVoiceAction(noteId, "223 6999999", "Hola Axel", 10)).toMatchObject({ ok: true });
    const testVoice = calls.find((c) => c.path === "/api/sendVoice")!;
    expect(testVoice.body).toMatchObject({ session: "prospeccion", chatId: "5492236999999@c.us", convert: false, file: { mimetype: "audio/ogg; codecs=opus" } });
    expect(await voice.voiceSentToday()).toBe(0);

    calls.length = 0;
    const ana = await id("noabrio-a1");
    expect(await actions.sendVoiceAction(noteId, ana, "Hola {saludo}! Tu demo: {link}", 12)).toMatchObject({ ok: true });
    const paths = calls.map((c) => c.path);
    expect(paths.indexOf("/api/sendText")).toBeLessThan(paths.indexOf("/api/sendVoice"));
    expect(calls.find((c) => c.path === "/api/sendText")!.body).toMatchObject({ chatId: "5492236000001@c.us", text: "Hola Ana! Tu demo: https://turnia.example/p/noabrio-a1" });
    expect(calls.some((c) => c.path === "/api/prospeccion/presence" && c.body?.presence === "recording")).toBe(true);

    // Cuenta como el segundo mensaje y queda en la historia.
    const [row] = await sql`select touches, next_action_on is not null as scheduled from sales_outreach where id = ${ana}`;
    expect(row).toEqual({ touches: 2, scheduled: true });
    const events = await sql`select kind, detail from sales_outreach_events where outreach_id = ${ana} order by created_at`;
    expect(events).toEqual([{ kind: "mensaje", detail: "seguimiento" }, { kind: "nota", detail: "Audio de seguimiento: «No abrieron · v1»" }]);
    expect(mocks.capture.at(-1)).toMatchObject({ event: "prospect_followup_sent", properties: { message_format: "audio" } });

    // El mismo audio no se repite.
    calls.length = 0;
    expect(await actions.sendVoiceAction(noteId, ana, "", 12)).toMatchObject({ ok: false });
    expect(calls.some((c) => c.path === "/api/sendVoice")).toBe(false);
    expect((await voice.voiceCandidates("no_abrio", noteId))[0].sent).toBe(true);

    // A quien pidió la baja o ya recibió los tres, no.
    expect(await actions.sendVoiceAction(noteId, await id("baja-e5"), "", 12)).toMatchObject({ ok: false });
    expect(await actions.sendVoiceAction(noteId, await id("tres-d4"), "", 12)).toMatchObject({ ok: false });
    expect(await voice.voiceSentToday()).toBe(1);
  });

  it("no manda si la sesión no es la del número de la prospección, si no tiene WhatsApp o fuera de horario", async () => {
    const [{ id: noteId }] = await sql<Array<{ id: string }>>`insert into sales_voice_notes (label, mimetype, audio) values ('v2', 'audio/mp4', ${Buffer.from("m4a")}) returning id`;
    const beto = await id("abrio-b2");

    session = { status: "WORKING", me: { id: "5491100000000@c.us" } };
    expect(await actions.sendVoiceAction(noteId, beto, "", 12)).toMatchObject({ ok: false, message: expect.stringContaining("no al 5492235000000") });

    session = { status: "SCAN_QR_CODE", me: null as unknown as { id: string } };
    expect(await actions.sendVoiceAction(noteId, beto, "", 12)).toMatchObject({ ok: false, message: expect.stringContaining("QR") });

    session = { status: "WORKING", me: { id: "5492235000000@c.us" } };
    exists = false;
    expect(await actions.sendVoiceAction(noteId, beto, "", 12)).toMatchObject({ ok: false, message: expect.stringContaining("no tiene WhatsApp") });
    // El error no lo deja marcado: se puede reintentar, y un .m4a pide conversión.
    exists = true;
    calls.length = 0;
    expect(await actions.sendVoiceAction(noteId, beto, "", 12)).toMatchObject({ ok: true });
    expect(calls.find((c) => c.path === "/api/sendVoice")!.body).toMatchObject({ convert: true, file: { mimetype: "audio/mp4" } });

    vi.setSystemTime(new Date("2026-11-06T01:30:00Z")); // 22:30 en Buenos Aires
    expect(await actions.sendVoiceAction(noteId, await id("hablo-c3"), "", 12)).toMatchObject({ ok: false, message: expect.stringContaining("de 8 a 21") });
    vi.setSystemTime(new Date("2026-11-05T13:00:00Z"));
  });

  it("Chapa requiere autorización, convierte la grabación una vez y verifica la etapa del destinatario", async () => {
    const { POST, OPTIONS } = await import("@/app/api/prospeccion/audio/route");
    const { CHAPA_PROSPECTING_ORIGIN } = await import("@/lib/sales/chapa-voice");
    const { createProspectingVoiceToken } = await import("@/lib/session");
    const url = "https://turnia.example/api/prospeccion/audio";
    const auth = { Origin: CHAPA_PROSPECTING_ORIGIN, Authorization: `Bearer ${createProspectingVoiceToken()}` };
    expect(OPTIONS(new Request(url, { headers: auth })).status).toBe(204);
    expect((await POST(new Request(url, { method: "POST", headers: { ...auth, Origin: "https://otro.example" } }))).status).toBe(401);

    const form = new FormData();
    form.set("label", "Grabación WebM");
    form.set("audio", new File(["WebM"], "nota.webm", { type: "audio/webm" }));
    const upload = await POST(new Request(url, { method: "POST", headers: auth, body: form }));
    expect(upload.status).toBe(201);
    const { id: note } = await upload.json();
    expect((await voice.voiceNoteAudio(note))?.mimetype).toBe("audio/ogg");
    expect(calls.filter((call) => call.path.endsWith("/media/convert/voice"))).toHaveLength(1);

    const send = (body: Record<string, unknown>) => POST(new Request(url, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ note, ...body }),
    }));
    expect((await send({ action: "send", group: "no_abrio", person: await id("hablo-c3"), text: "" })).status).toBe(422);
    expect(calls.some((call) => call.path === "/api/sendVoice")).toBe(false);

    const followup = { action: "send", group: "abrio", person: await id("toco-f6"), text: "" };
    const unverified = await send(followup);
    expect(await unverified.json()).toMatchObject({ error: expect.stringContaining("WhatsApp emisor") });
    expect((await send({ action: "source", person: followup.person, sender: "5483", confirmed: true })).status).toBe(200);
    expect((await send(followup)).status).toBe(422);
    expect(await voice.importVoiceSenders("0000", [
      { code: "toco-f6", phone: "+5492236000006" },
      { code: "hablo-c3", phone: "+5492236000006" },
    ])).toEqual({ matched: 1, inserted: 1 });
    expect(await voice.importVoiceSenders("0000", [{ code: "toco-f6", phone: "+5492236000006" }])).toEqual({ matched: 1, inserted: 0 });
    expect((await voice.voiceCandidates("abrio", note)).find((person) => person.id === followup.person)?.senders).toEqual([
      "5491130235483", "5492235000000",
    ]);
    await sql`update sales_voice_sends set created_at = now() - interval '4 minutes' where outreach_id is not null`;
    expect((await send(followup)).status).toBe(200);
    calls.length = 0;

    const count = await voice.voiceSentToday();
    expect((await send({ action: "test" })).status).toBe(200);
    expect(calls.find((call) => call.path === "/api/sendVoice")?.body).toMatchObject({
      chatId: "5491130235483@c.us", convert: false, file: { mimetype: "audio/ogg; codecs=opus" },
    });
    expect(await voice.voiceSentToday()).toBe(count);
  });

  it("comparte la pausa entre líneas y reserva para revisión una entrega sin confirmar", async () => {
    const { POST } = await import("@/app/api/prospeccion/audio/route");
    const { CHAPA_PROSPECTING_ORIGIN } = await import("@/lib/sales/chapa-voice");
    const { createProspectingVoiceToken } = await import("@/lib/session");
    vi.stubEnv("WAHA_PROSPECCION_5483", JSON.stringify({
      url: "https://waha-secondary.example", apiKey: "clave-secundaria", session: "secondary", phone: "5491130235483",
    }));
    const [{ id: note }] = await sql<Array<{ id: string }>>`
      insert into sales_voice_notes (label, mimetype, audio) values ('Pausa y revisión', 'audio/ogg', ${Buffer.from("ogg")}) returning id`;
    const other = await id("tres-d4");
    const person = await id("hablo-c3");
    await sql`insert into sales_voice_sends (voice_note_id, outreach_id, phone, status) values (${note}, ${other}, '+5492236000004', 'enviado')`;
    await voice.setVoiceSender(person, "5483", true);
    const send = () => POST(new Request("https://turnia.example/api/prospeccion/audio", {
      method: "POST", headers: { Origin: CHAPA_PROSPECTING_ORIGIN, Authorization: `Bearer ${createProspectingVoiceToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send", note, person, sender: "5483", group: "hablo", text: "" }),
    }));

    const wait = await send();
    expect(wait.status).toBe(429);
    expect(await wait.json()).toMatchObject({ retryAfter: expect.any(Number) });
    expect(calls.some((call) => call.path === "/api/sendVoice")).toBe(false);

    await sql`update sales_voice_sends set created_at = now() - interval '4 minutes' where outreach_id is not null`;
    sendVoiceFails = true;
    const uncertain = await send();
    expect(uncertain.status).toBe(422);
    expect(await uncertain.json()).toMatchObject({ error: expect.stringContaining("Revisá su chat") });
    expect(calls.find((call) => call.path === "/api/sendVoice")?.body).toMatchObject({ session: "secondary" });
    expect((await voice.voiceCandidates("hablo", note)).find((c) => c.id === person)).toMatchObject({ sent: true, needs_review: true });

    await sql`update sales_voice_sends set created_at = now() - interval '4 minutes' where outreach_id is not null`;
    calls.length = 0;
    sendVoiceFails = false;
    expect((await send()).status).toBe(422);
    expect(calls.some((call) => call.path === "/api/sendVoice")).toBe(false);
  });

  it("guarda reglas sin vincular una línea y aplica el cupo y la pausa configurados", async () => {
    const rules = await import("@/lib/sales/voice-rules");
    const original = await rules.voiceRules();
    const { GET, POST } = await import("@/app/api/prospeccion/audio/route");
    const { CHAPA_PROSPECTING_ORIGIN } = await import("@/lib/sales/chapa-voice");
    const { createProspectingVoiceToken } = await import("@/lib/session");
    const headers = { Origin: CHAPA_PROSPECTING_ORIGIN, Authorization: `Bearer ${createProspectingVoiceToken()}`, "Content-Type": "application/json" };
    const request = (body: Record<string, unknown>) => POST(new Request("https://turnia.example/api/prospeccion/audio", {
      method: "POST", headers, body: JSON.stringify(body),
    }));
    try {
      session = { status: "SCAN_QR_CODE", me: null as unknown as { id: string } };
      const custom = { dailyLimit: 75, batchSize: 7, pauseMinMinutes: 7, pauseMaxMinutes: 9 };
      expect((await request({ action: "rules", rules: custom })).status).toBe(200);
      expect(calls).toHaveLength(0);
      const current = await GET(new Request("https://turnia.example/api/prospeccion/audio?group=abrio&sender=0000", { headers }));
      expect(await current.json()).toMatchObject({ ready: false, rules: custom });
      expect(await rules.voiceRules()).toEqual(custom);

      session = { status: "WORKING", me: { id: "5492235000000@c.us" } };
      const [{ id: note }] = await sql<Array<{ id: string }>>`
        insert into sales_voice_notes (label, mimetype, audio) values ('Reglas configurables', 'audio/ogg', ${Buffer.from("ogg")}) returning id`;
      const person = await id("toco-f6");
      await voice.setVoiceSender(person, "0000", true);
      await sql`update sales_voice_sends set created_at = now() - interval '1 minute' where outreach_id is not null`;
      calls.length = 0;
      const payload = { action: "send", note, person, sender: "0000", group: "abrio", text: "" };
      const pause = await request(payload);
      expect(pause.status).toBe(429);
      expect((await pause.json()).retryAfter).toBeGreaterThan(300);
      expect(calls.some((call) => call.path === "/api/sendVoice")).toBe(false);

      await rules.saveVoiceRules({ ...custom, pauseMinMinutes: 10 / 60, pauseMaxMinutes: 20 / 60 });
      await sql`update sales_voice_sends set created_at = now() - interval '1 second' where outreach_id is not null`;
      const shortPause = await request(payload);
      expect(shortPause.status).toBe(429);
      expect((await shortPause.json()).retryAfter).toBeLessThanOrEqual(10);
      expect(calls.some((call) => call.path === "/api/sendVoice")).toBe(false);

      await rules.saveVoiceRules({ ...custom, dailyLimit: 1, batchSize: 1 });
      const capped = await request(payload);
      expect(capped.status).toBe(422);
      expect(await capped.json()).toMatchObject({ error: expect.stringContaining("1 envíos") });
      expect(calls.some((call) => call.path === "/api/sendVoice")).toBe(false);
    } finally {
      await rules.saveVoiceRules(original);
    }
  });

  it("frena al llegar al tope del día", async () => {
    const [{ id: noteId }] = await sql<Array<{ id: string }>>`insert into sales_voice_notes (label, mimetype, audio) values ('v3', 'audio/ogg', ${Buffer.from("ogg")}) returning id`;
    const filler = await id("tres-d4");
    for (let i = 0; i < voice.VOICE_DAILY_LIMIT; i++) {
      const [{ id: n }] = await sql<Array<{ id: string }>>`insert into sales_voice_notes (label, mimetype, audio) values (${`x${i}`}, 'audio/ogg', ${Buffer.from("x")}) returning id`;
      await sql`insert into sales_voice_sends (voice_note_id, outreach_id, phone, status) values (${n}, ${filler}, '+5492236000004', 'enviado')`;
    }
    expect(await actions.sendVoiceAction(noteId, await id("hablo-c3"), "", 12)).toMatchObject({ ok: false, message: expect.stringContaining("Seguí mañana") });
  });

  it("manda el saludo y la presentación como texto desde Chapa, sin audio ni link en el saludo", async () => {
    const { GET, POST } = await import("@/app/api/prospeccion/audio/route");
    const { CHAPA_PROSPECTING_ORIGIN } = await import("@/lib/sales/chapa-voice");
    const { createProspectingVoiceToken } = await import("@/lib/session");
    const url = "https://turnia.example/api/prospeccion/audio";
    const headers = { Origin: CHAPA_PROSPECTING_ORIGIN, Authorization: `Bearer ${createProspectingVoiceToken()}`, "Content-Type": "application/json" };
    const send = (body: Record<string, unknown>) => POST(new Request(url, { method: "POST", headers, body: JSON.stringify({ action: "send", ...body }) }));
    const rest = () => sql`update sales_voice_sends set created_at = now() - interval '1 day' where outreach_id is not null`;
    await rest(); // el tope del día de la prueba anterior y la pausa entre envíos
    const gabi = await id("saludo-g7");
    const hugo = await id("saludado-h8");

    const stage = await (await GET(new Request(`${url}?group=saludo&sender=0000`, { headers }))).json();
    expect(stage.stage).toMatchObject({ textOnly: true, needsSender: false, defaultText: "" });
    expect(stage.stage.panelTemplates).toHaveLength(2);
    expect(stage.people.map((p: { name: string }) => p.name).sort()).toEqual(["Gabriela Siete", "Inés Nueve"]);

    const [{ id: note }] = await sql<Array<{ id: string }>>`insert into sales_voice_notes (label, mimetype, audio) values ('Saludo', 'audio/ogg', ${Buffer.from("ogg")}) returning id`;
    expect(await (await send({ group: "saludo", note, person: gabi, text: "Hola" })).json()).toMatchObject({ error: expect.stringContaining("solo con texto") });
    expect(await (await send({ group: "saludo", person: gabi, text: "Hola! Tu demo: {link}" })).json()).toMatchObject({ error: expect.stringContaining("sin link") });
    expect(calls.some((c) => c.path.startsWith("/api/send") && c.path !== "/api/sendSeen")).toBe(false);

    // El primer chat: no hace falta confirmar la línea, y queda confirmada para lo que sigue.
    calls.length = 0;
    const greeted = await send({ group: "saludo", person: gabi, text: "Hola! ¿Este es el consultorio de {destinatario}?" });
    expect(greeted.status).toBe(200);
    expect(calls.find((c) => c.path === "/api/sendText")!.body).toMatchObject({ chatId: "5492236000007@c.us", text: "Hola! ¿Este es el consultorio de la Dra. Siete?" });
    expect(calls.some((c) => c.path === "/api/sendVoice")).toBe(false);
    const [row] = await sql`select status, touches, greeted_at is not null as greeted from sales_outreach where id = ${gabi}`;
    expect(row).toEqual({ status: "contactado", touches: 0, greeted: true });
    expect(mocks.capture.at(-1)).toMatchObject({ event: "prospect_greeting_sent", properties: { message_format: "texto", voice_stage: "saludo" } });
    expect((await voice.voiceCandidates("presentacion", null)).find((c) => c.id === gabi)?.senders).toEqual(["5492235000000"]);
    expect(await voice.voiceGroupCounts()).toMatchObject({ saludo: 1, presentacion: 2 });
    expect(await (await send({ group: "saludo", person: gabi, text: "Hola" })).json()).toMatchObject({
      error: expect.stringContaining("ya no le toca"), code: "recipient_ineligible",
    });

    // La presentación lleva el link; vacía, sale la del panel. A Hugo lo saludaron desde otra línea.
    await rest();
    expect(await (await send({ group: "presentacion", person: hugo, text: "Hola {saludo}, ¿cómo estás?" })).json()).toMatchObject({ error: expect.stringContaining("{link}") });
    expect(await (await send({ group: "presentacion", person: hugo, text: "" })).json()).toMatchObject({ error: expect.stringContaining("WhatsApp emisor") });
    calls.length = 0;
    expect((await send({ group: "presentacion", person: gabi, text: "" })).status).toBe(200);
    const pitch = String(calls.find((c) => c.path === "/api/sendText")!.body!.text);
    expect(pitch).toContain("Hola Gabi");
    expect(pitch).toContain("https://turnia.example/p/saludo-g7");
    expect((await sql`select touches from sales_outreach where id = ${gabi}`)[0].touches).toBe(1);
    expect(mocks.capture.at(-1)).toMatchObject({ event: "prospect_pitch_sent", properties: { message_format: "texto" } });
    // Una sola vez por etapa: ya está en el seguimiento.
    await rest();
    expect((await send({ group: "presentacion", person: gabi, text: "" })).status).toBe(422);

    // La prueba de un texto sale a tu número, con tus datos.
    calls.length = 0;
    const count = await voice.voiceSentToday();
    expect((await POST(new Request(url, { method: "POST", headers, body: JSON.stringify({ action: "test", text: "¿Hablo con {saludo}?" }) }))).status).toBe(200);
    expect(calls.find((c) => c.path === "/api/sendText")!.body).toMatchObject({ text: "¿Hablo con Axel?" });
    expect(await voice.voiceSentToday()).toBe(count);
  });

  it("a quien dijo que no le pide feedback una vez, sin sumar un mensaje, y lo pasa a «No le interesa»", async () => {
    const { POST } = await import("@/app/api/prospeccion/audio/route");
    const { CHAPA_PROSPECTING_ORIGIN } = await import("@/lib/sales/chapa-voice");
    const { createProspectingVoiceToken } = await import("@/lib/session");
    const url = "https://turnia.example/api/prospeccion/audio";
    const headers = { Origin: CHAPA_PROSPECTING_ORIGIN, Authorization: `Bearer ${createProspectingVoiceToken()}`, "Content-Type": "application/json" };
    const send = (body: Record<string, unknown>) => POST(new Request(url, { method: "POST", headers, body: JSON.stringify({ action: "send", group: "no_interesa", ...body }) }));
    await sql`update sales_voice_sends set created_at = now() - interval '1 day' where outreach_id is not null`;
    // Respondió que no (lo leyó la lectura diaria en la línea 0000), otro respondió otra cosa y otro ya estaba cerrado.
    await sql`insert into sales_outreach (code, name, greeting, phone, phone_kind, status, touches)
              values ('dijono-k1', 'Karina Diez', 'Kari', '+5492236000010', 'movil', 'respondio', 1),
                     ('gracias-l2', 'Luis Once', 'Luis', '+5492236000011', 'movil', 'respondio', 1),
                     ('cerrado-m3', 'Marta Doce', 'Marta', '+5492236000012', 'movil', 'no_interesa', 3)`;
    const kari = await id("dijono-k1");
    const marta = await id("cerrado-m3");
    await sql`insert into sales_whatsapp_chats (outreach_id, sender_phone, chat_id, sent, received, last_received_text, last_from_me)
              values (${kari}, '5492235000000', '5492236000010@c.us', 1, 1, 'No estamos interesados. Gracias.', false),
                     (${await id("gracias-l2")}, '5492235000000', '5492236000011@c.us', 1, 1, 'Gracias,', false)`;
    const people = await voice.voiceCandidates("no_interesa", null);
    expect(people.map((p) => p.name).sort()).toEqual(["Karina Diez", "Marta Doce"]);
    expect(people.find((p) => p.id === kari)).toMatchObject({ senders: ["5492235000000"], reply: "No estamos interesados. Gracias." });

    expect(await (await send({ person: kari, note: (await sql`select id from sales_voice_notes limit 1`)[0].id, text: "" })).json()).toMatchObject({ error: expect.stringContaining("solo con texto") });
    calls.length = 0;
    expect((await send({ person: kari, text: "" })).status).toBe(200);
    expect(calls.find((c) => c.path === "/api/sendText")!.body).toMatchObject({
      text: "Gracias por contestarme, Kari. No te escribo más. Si me decís en una línea por qué no te sirve, me ayudás un montón.",
    });
    const [row] = await sql`select status, touches from sales_outreach where id = ${kari}`;
    expect(row).toEqual({ status: "no_interesa", touches: 1 });
    expect((await sql`select detail from sales_outreach_events where outreach_id = ${kari} and kind = 'mensaje'`)[0].detail).toContain("Pedido de feedback");
    expect((await voice.voiceCandidates("no_interesa", null)).find((p) => p.id === kari)?.sent).toBe(true);
    await sql`update sales_voice_sends set created_at = now() - interval '1 day' where outreach_id is not null`;
    expect((await send({ person: kari, text: "" })).status).toBe(422);
    // A Marta no le escribimos desde esta línea: hay que confirmarla.
    expect(await (await send({ person: marta, text: "" })).json()).toMatchObject({ error: expect.stringContaining("WhatsApp emisor") });
  });

  it("recuerda por 24 horas un rechazo de WAHA en ambas líneas y no lo traslada a un teléfono corregido", async () => {
    const { GET, POST } = await import("@/app/api/prospeccion/audio/route");
    const { CHAPA_PROSPECTING_ORIGIN } = await import("@/lib/sales/chapa-voice");
    const { createProspectingVoiceToken } = await import("@/lib/session");
    const url = "https://turnia.example/api/prospeccion/audio";
    const headers = { Origin: CHAPA_PROSPECTING_ORIGIN, Authorization: `Bearer ${createProspectingVoiceToken()}` };
    const person = await id("compartido-i9");
    const send = (sender: string) => POST(new Request(url, {
      method: "POST", headers, body: JSON.stringify({ action: "send", group: "saludo", person, sender, text: "Hola" }),
    }));
    const list = async () => (await (await GET(new Request(`${url}?group=saludo&sender=5483`, { headers }))).json()).people;
    exists = false;
    const before = await voice.voiceSentToday();
    expect(await (await send("0000")).json()).toMatchObject({ code: "recipient_unavailable" });
    expect(await voice.voiceSentToday()).toBe(before);
    expect(await list()).toContainEqual(expect.objectContaining({ id: person, sent: false, whatsappUnavailable: true }));

    calls.length = 0;
    expect(await (await send("5483")).json()).toMatchObject({ code: "recipient_unavailable" });
    expect(calls).toHaveLength(0);

    await sql`update sales_outreach set phone = '+5492236000089' where id = ${person}`;
    expect(await list()).toContainEqual(expect.objectContaining({ id: person, whatsappUnavailable: false }));
    await sql`update sales_outreach set phone = '+5492236000009' where id = ${person}`;
    await sql`update sales_voice_sends set created_at = now() - interval '25 hours' where outreach_id = ${person}`;
    expect(await list()).toContainEqual(expect.objectContaining({ id: person, whatsappUnavailable: false }));
  });
});
