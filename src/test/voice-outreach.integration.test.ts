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
let exists = true;
let chatsStore = true;
let sendVoiceFails = false;

async function fakeWaha(input: RequestInfo | URL, init: RequestInit = {}) {
  const url = new URL(String(input));
  calls.push({ path: url.pathname, body: init.body ? JSON.parse(String(init.body)) : null });
  if (url.pathname === "/api/sessions/secondary") return Response.json({ status: "WORKING", me: { id: "5491130235483@c.us" } });
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
    exists = true;
    chatsStore = true;
    sendVoiceFails = false;
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
    expect(await voice.voiceGroupCounts()).toEqual({ no_abrio: 1, abrio: 2, hablo: 1 });
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
});
