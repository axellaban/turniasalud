import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// La lectura diaria de WhatsApp: los chats de las dos líneas de la prospección (WAHA simulado) se
// cruzan con la base; una respuesta nueva pasa a «Respuestas para atender» una sola vez, lo que ya se
// está hablando o está cerrado solo queda en la historia, y no se manda nada.

vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn(async () => {}) }));
vi.mock("@/lib/analytics-server", () => ({ captureLater: () => {} }));
vi.mock("@/lib/sheets/turnia-sheet", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/sheets/turnia-sheet")>()), queueTurniaSheetSync: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: () => {} }));

const base = testDatabaseUrl();
const SECRET = "w".repeat(40);
const T = 1_762_000_000; // segundos
type Msg = { id: string; timestamp: number; fromMe: boolean; body?: string; hasMedia?: boolean; media?: { mimetype: string } };
const sent: string[] = [];
const messages: Record<string, Msg[]> = {
  // Ana: le escribimos y contestó (la última es de ella).
  "prospeccion/5492236000001@c.us": [
    { id: "a1", timestamp: T, fromMe: true, body: "Hola Ana" },
    { id: "a2", timestamp: T + 600, fromMe: false, body: "Hola, me interesa" },
  ],
  // Caro: dijo que no y está cerrada: solo queda en la historia.
  "prospeccion/5492236000003@c.us": [
    { id: "c1", timestamp: T, fromMe: true, body: "Hola Caro" },
    { id: "c2", timestamp: T + 60, fromMe: false, body: "No gracias" },
  ],
  // Dani: escribió antes por otra cosa; después le escribimos y no contestó.
  "prospeccion/5492236000004@c.us": [
    { id: "d1", timestamp: T - 9000, fromMe: false, body: "¿Atienden OSDE?" },
    { id: "d2", timestamp: T, fromMe: true, body: "Hola Dani" },
  ],
  // Eva: ya se habla (interesada) y mandó un audio.
  "prospeccion/5492236000005@c.us": [
    { id: "e1", timestamp: T, fromMe: true, body: "Hola Eva" },
    { id: "e2", timestamp: T + 100, fromMe: false, hasMedia: true, media: { mimetype: "audio/ogg; codecs=opus" } },
  ],
  // Fede: solo la respuesta automática de WhatsApp Business: no es una respuesta.
  "prospeccion/5492236000006@c.us": [
    { id: "f1", timestamp: T, fromMe: true, body: "Hola Fede" },
    { id: "f2", timestamp: T + 2, fromMe: false, body: "Gracias por comunicarte con el consultorio. Nuestro horario de atención es de 9 a 18 hs." },
  ],
  // Gabi: una lectura vieja la abrió por su respuesta automática; esta lo deshace.
  "prospeccion/5492236000007@c.us": [
    { id: "g1", timestamp: T, fromMe: true, body: "Hola Gabi" },
    { id: "g2", timestamp: T + 2, fromMe: false, body: "*Respuesta automática* En este momento no podemos atenderte." },
  ],
  // Beto, en el WhatsApp de Axel por @lid: le escribimos y todavía no contestó.
  "axel/77665544@lid": [{ id: "b1", timestamp: T, fromMe: true, body: "Hola Beto" }],
};

async function fakeWaha(input: RequestInfo | URL, init: RequestInit = {}) {
  const url = new URL(String(input));
  const path = decodeURIComponent(url.pathname);
  if ((init.method ?? "GET") !== "GET") sent.push(path);
  if (path === "/api/sessions/prospeccion") return Response.json({ status: "WORKING", me: { id: "5492235000000@c.us" } });
  if (path === "/api/sessions/axel") return Response.json({ status: "WORKING", me: { id: "5491130235483@c.us" } });
  if (path === "/api/prospeccion/chats") {
    return Response.json(url.searchParams.get("offset") === "0"
      ? ["5492236000001@c.us", "5492236000003@c.us", "5492236000004@c.us", "5492236000005@c.us", "5492236000006@c.us", "5492236000007@c.us", "5492299999999@c.us", "120363000000@g.us"].map((id) => ({ id }))
      : []);
  }
  if (path === "/api/axel/chats") return Response.json(url.searchParams.get("offset") === "0" ? [{ id: "77665544@lid" }] : []);
  if (path === "/api/axel/lids") return Response.json([{ lid: "77665544@lid", pn: "5492236000002@c.us" }]);
  const m = /^\/api\/([^/]+)\/chats\/(.+)\/messages$/.exec(path);
  if (m) return Response.json(messages[`${m[1]}/${m[2]}`] ?? []);
  return new Response("no", { status: 404 });
}

describe.runIf(base)("lectura diaria de WhatsApp", () => {
  let sql: typeof import("@/lib/db").sql;
  let route: typeof import("@/app/api/prospeccion/route");
  let wa: typeof import("@/lib/sales/whatsapp-sync");
  const sync = async () => {
    const res = await route.POST(new Request("https://turnia.example/api/prospeccion", {
      method: "POST", headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ by: "Lectura diaria", followup: { op: "whatsapp-sync" } }),
    }));
    return { status: res.status, body: (await res.json()) as { whatsapp: import("@/lib/sales/whatsapp-sync").SyncReport } };
  };
  const status = async (code: string) => (await sql<Array<{ status: string }>>`select status from sales_outreach where code = ${code}`)[0].status;
  const older = () => sql`update sales_whatsapp_syncs set started_at = started_at - interval '1 hour'`;

  beforeAll(async () => {
    const url = await scratchDatabase(base!, "turnia_test_whatsapp_sync");
    await resetTestDatabase(url);
    for (const [key, value] of Object.entries({
      DATABASE_URL: url, METRICS_SECRET: SECRET, APP_URL: "https://turnia.example",
      WAHA_PROSPECCION: JSON.stringify({ url: "https://waha.example", apiKey: "clave-de-prueba", session: "prospeccion", phone: "5492235000000" }),
      WAHA_PROSPECCION_5483: JSON.stringify({ url: "https://waha.example", apiKey: "clave-de-prueba", session: "axel", phone: "5491130235483" }),
    })) vi.stubEnv(key, value);
    vi.stubGlobal("fetch", fakeWaha);
    ({ sql } = await import("@/lib/db"));
    route = await import("@/app/api/prospeccion/route");
    wa = await import("@/lib/sales/whatsapp-sync");
    const people: Array<[string, string, string, string]> = [
      ["ana-a1", "Ana Uno", "+5492236000001", "contactado"],
      ["beto-b2", "Beto Dos", "+5492236000002", "contactado"],
      ["caro-c3", "Caro Tres", "+5492236000003", "no_interesa"],
      ["dani-d4", "Dani Cuatro", "+5492236000004", "contactado"],
      ["eva-e5", "Eva Cinco", "+5492236000005", "respondio"],
      ["fede-f6", "Fede Seis", "+5492236000006", "contactado"],
      ["gabi-g7", "Gabi Siete", "+5492236000007", "contactado"],
    ];
    for (const [code, name, phone, st] of people) {
      await sql`insert into sales_outreach (code, name, greeting, phone, phone_kind, status, touches, first_contact_at, last_contact_at)
                values (${code}, ${name}, ${name.split(" ")[0]}, ${phone}, 'movil', ${st}, 1, now() - interval '3 days', now() - interval '3 days')`;
    }
    const [eva] = await sql<Array<{ id: string }>>`select id from sales_outreach where code = 'eva-e5'`;
    await sql`insert into sales_followup_state (outreach_id, situation, situation_step) values (${eva.id}, 'interesado', 0)`;
    // Lo que había dejado la primera lectura, cuando todavía no distinguía las respuestas automáticas.
    const [gabi] = await sql<Array<{ id: string }>>`select id from sales_outreach where code = 'gabi-g7'`;
    await (await import("@/lib/sales/followup-queue")).incomingReply(gabi.id, "*Respuesta automática* En este momento no podemos atenderte.", "WhatsApp (lectura diaria)");
  }, 60000);

  afterAll(async () => {
    await (await import("@/lib/db")).closeDb();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("lee las dos líneas, abre las respuestas nuevas y no manda nada", async () => {
    const { status: code, body } = await sync();
    expect(code).toBe(200);
    const r = body.whatsapp;
    expect(r.lines).toEqual([
      expect.objectContaining({ line: "0000", status: "ok", chats: 8, prospects: 6, read: 6 }),
      expect.objectContaining({ line: "5483", status: "ok", chats: 1, prospects: 1, read: 1 }),
    ]);
    // Ana, Beto, Caro, Dani, Eva, Fede y Gabi tienen mensajes nuestros; contestaron Ana, Caro y Eva
    // (lo de Fede y Gabi es automático). Gabi vuelve a como estaba.
    expect(r.totals).toEqual({ conversaciones: 7, respondieron: 3, esperanRespuesta: 2, nuevas: 3, abiertas: 1, corregidas: 1 });
    expect(await status("fede-f6")).toBe("contactado");
    expect(await status("gabi-g7")).toBe("contactado");
    const gabi = await sql<Array<{ kind: string }>>`
      select e.kind from sales_outreach_events e join sales_outreach o on o.id = e.outreach_id where o.code = 'gabi-g7'`;
    expect(gabi).toEqual([]);
    expect(await sql`select 1 from sales_followup_state s join sales_outreach o on o.id = s.outreach_id where o.code = 'gabi-g7'`).toHaveLength(0);
    // De la más vieja a la más nueva.
    expect(r.pending.map((p) => [p.code, p.line, p.text])).toEqual([
      ["eva-e5", "0000", "Audio"],
      ["ana-a1", "0000", "Hola, me interesa"],
    ]);
    expect(await status("ana-a1")).toBe("respondio");
    expect(await status("dani-d4")).toBe("contactado");
    expect(await status("caro-c3")).toBe("no_interesa");
    expect(await status("beto-b2")).toBe("contactado");
    expect(sent).toEqual([]);

    // Ana pasa a «Respuestas para atender» con su texto, y la lectura viene con la cola.
    const res = await route.GET(new Request("https://turnia.example/api/prospeccion?vista=followup", { headers: { authorization: `Bearer ${SECRET}` } }));
    // (Fuera de horario va a las bloqueadas, con el mismo grupo.)
    type Item = { code: string; situation: string; group: string };
    const snap = (await res.json()) as { queue: Item[]; blocked: Item[]; whatsapp: { totals: { abiertas: number } } };
    expect([...snap.queue, ...snap.blocked].find((q) => q.code === "ana-a1")).toMatchObject({ situation: "neutro", group: "respuestas" });
    expect(snap.whatsapp.totals.abiertas).toBe(1);
    const audit = await sql<Array<{ new_value: string; actor: string }>>`
      select a.new_value, a.actor from sales_followup_audit a join sales_outreach o on o.id = a.outreach_id where o.code = 'eva-e5' and a.subject = 'reply'`;
    expect(audit).toEqual([{ new_value: "Audio", actor: wa.SYNC_ACTOR }]);
  });

  it("antes de 10 minutos devuelve la última lectura; después, no repite lo ya leído", async () => {
    const again = await sync();
    expect(again.body.whatsapp.reused).toBe(true);
    await older();
    const next = await sync();
    expect(next.body.whatsapp.reused).toBeUndefined();
    expect(next.body.whatsapp.totals).toMatchObject({ nuevas: 0, abiertas: 0, corregidas: 0, respondieron: 3 });
  });

  it("una respuesta nueva de Beto en el WhatsApp de Axel lo abre", async () => {
    messages["axel/77665544@lid"].push({ id: "b2", timestamp: T + 5000, fromMe: false, body: "¿Cuánto sale?" });
    await older();
    const r = (await sync()).body.whatsapp;
    expect(r.totals).toMatchObject({ nuevas: 1, abiertas: 1, respondieron: 4, esperanRespuesta: 3 });
    expect(await status("beto-b2")).toBe("respondio");
    expect(r.pending.find((p) => p.code === "beto-b2")).toMatchObject({ line: "5483", text: "¿Cuánto sale?" });
  });

  it("«Responder» de Chapa: por código, lo último que escribió en cada línea y la respuesta cargada a mano", async () => {
    const [dani] = await sql<Array<{ id: string }>>`select id from sales_outreach where code = 'dani-d4'`;
    // Una respuesta registrada a mano (por ejemplo, de una línea que no se lee).
    await (await import("@/lib/sales/followup-queue")).incomingReply(dani.id, "¿Es por un turno?", "Axel");
    const res = await route.GET(new Request("https://turnia.example/api/prospeccion?vista=filas", { headers: { authorization: `Bearer ${SECRET}` } }));
    type Inbox = { readAt: string | null; byCode: Record<string, import("@/lib/sales/whatsapp-sync").InboxEntry> };
    const { whatsappInbox: inbox } = (await res.json()) as { whatsappInbox: Inbox };
    expect(inbox.readAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(inbox.byCode["ana-a1"].chats).toEqual([expect.objectContaining({ line: "0000", inText: "Hola, me interesa", lastFromMe: false, received: 1, sent: 1, automatic: false })]);
    expect(inbox.byCode["ana-a1"].chats[0].inAt! > inbox.byCode["ana-a1"].chats[0].outAt!).toBe(true);
    expect(inbox.byCode["beto-b2"].chats).toEqual([expect.objectContaining({ line: "5483", inText: "¿Cuánto sale?", lastFromMe: false })]);
    // Lo de Fede era automático: no queda como respuesta.
    expect(inbox.byCode["fede-f6"].chats[0]).toMatchObject({ inText: null, received: 0, lastFromMe: true });
    expect(inbox.byCode["dani-d4"].manual).toMatchObject({ text: "¿Es por un turno?", by: "Axel" });
    // Lo que leyó la lectura no figura como «a mano».
    expect(inbox.byCode["ana-a1"].manual).toBeNull();
    // Si se cambió el número (una derivación), el chat del número anterior no se muestra.
    await sql`update sales_outreach set phone = '+5492236000099' where code = 'caro-c3'`;
    const again = (await (await route.GET(new Request("https://turnia.example/api/prospeccion?vista=filas", { headers: { authorization: `Bearer ${SECRET}` } }))).json()) as { whatsappInbox: Inbox };
    expect(again.whatsappInbox.byCode["caro-c3"]).toBeUndefined();
  });

  it("resume un chat: solo cuenta lo que llegó después de nuestro primer mensaje", () => {
    const s = wa.summarizeChat([
      { timestamp: 10, fromMe: false, body: "antes" },
      { timestamp: 20, fromMe: true, body: "hola" },
      { timestamp: 30, fromMe: false, body: "sí" },
      { timestamp: 40, fromMe: true, body: "genial" },
    ], 25);
    expect(s).toMatchObject({ sent: 2, received: 1, repliedAt: 30, lastFromMe: true, newReplies: [{ at: 30, text: "sí" }] });
    expect(wa.summarizeChat([{ timestamp: 10, fromMe: false, body: "hola" }], null).received).toBe(0);
    expect(wa.summarizeChat([{ timestamp: 10, fromMe: false, body: "hola" }], null, true).received).toBe(1);
    // Una respuesta automática no cuenta, ni para «el último mensaje es de ellos».
    const auto = wa.summarizeChat([
      { timestamp: 20, fromMe: true, body: "hola" },
      { timestamp: 21, fromMe: false, body: "¡Hola! Gracias por escribirnos a Odontología Luro. Actualmente nos encontramos fuera del horario." },
    ], null);
    expect(auto).toMatchObject({ received: 0, automatic: 1, lastFromMe: true });
  });

  it("distingue las respuestas automáticas de WhatsApp Business de las de una persona", () => {
    for (const t of [
      "Hola, gracias por su mensaje❗ En éste momento no podemos atenderla/o.",
      "Gracias por comunicarte con el Dr Miguel Gentili. Te responderemos a la brevedad. Muchas gracias",
      "Gracias por comunicarse con el Consultorio del Dr X. Nuestros horarios de atención son de lunes a viernes.",
      "Gracias por tu mensaje. En este momento no podemos responder, pero lo haremos lo antes posible.",
      // Las que se escapaban (09/11): cortas, de bienvenida o el aviso de Meta.
      "Gracias por comunicarte con Odontología Sur!",
      "Gracias por contactarte con Consultorio Pérez 🦷",
      "Esta empresa usa un servicio seguro de Meta para administrar este chat. Toca para obtener más información.",
      "¡Bienvenido a Odontología Integral Luro! ¿En qué podemos ayudarte?",
      "Hola! Nuestro horario es de lunes a viernes de 9 a 18 hs.",
    ]) expect(wa.isAutomaticReply(t)).toBe(true);
    for (const t of ["Gracias,", "No estamos interesados. Gracias.", "Gracias por escribir! Me interesa, ¿cuánto sale?", "en este momento estoy atendiendo, te escribo luego", "Audio",
      "Hola, sí, ¿es por un turno?", "Sí, es la recepción. ¿Quién habla?", "Bienvenido!", "Dale, pasame el link"]) {
      expect(wa.isAutomaticReply(t)).toBe(false);
    }
  });
});
