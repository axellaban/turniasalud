import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Pausa automática: si el equipo le contesta a un paciente desde el WhatsApp del consultorio, Sofi deja
// de contestarle unas horas. Lo que manda Turnia, los automáticos de WhatsApp Business y lo que va al
// equipo no la activan. Apagada por defecto. Datos ficticios.

const url = testDatabaseUrl();
const noWait = async () => {};

describe.runIf(url)("pausa automática cuando contesta el equipo", () => {
  let sql: typeof import("@/lib/db").sql;
  let own: typeof import("@/lib/waha-own");
  let sent: typeof import("@/lib/waha-sent");
  let isMuted: typeof import("@/lib/chat-guard").isMuted;
  let clinicId: string;
  const patient = "5491100005001";
  const chatId = `${patient}@c.us`;
  const msg = (id: string, text: string, extra: Partial<import("@/lib/waha-sent").OwnMessage> = {}) => ({ id, chatId, text, hasMedia: false, source: null, ...extra });
  const clinic = () => ({ id: clinicId, auto_pause_on_staff_reply: true });

  beforeAll(async () => {
    const db = await scratchDatabase(url!, "turnia_own_messages_test");
    await resetTestDatabase(db);
    vi.stubEnv("DATABASE_URL", db);
    ({ sql } = await import("@/lib/db"));
    own = await import("@/lib/waha-own");
    sent = await import("@/lib/waha-sent");
    ({ isMuted } = await import("@/lib/chat-guard"));
    [{ id: clinicId }] = await sql`insert into clinics (name, specialty) values ('Consultorio con pausa', 'Odontología') returning id`;
    await sql`insert into clinic_staff_phones (clinic_id, phone, name) values (${clinicId}, '5491100005099', 'Dra. Equipo')`;
  });

  afterAll(async () => {
    await (await import("@/lib/db")).closeDb();
    vi.unstubAllEnvs();
  });

  it("apagada por defecto: no hace nada", async () => {
    const [row] = await sql`select auto_pause_on_staff_reply from clinics where id = ${clinicId}`;
    expect(row.auto_pause_on_staff_reply).toBe(false);
    expect(await own.handleOwnMessage({ id: clinicId, auto_pause_on_staff_reply: false }, msg("m0", "Hola"), patient, { wait: noWait })).toBe("apagado");
    expect(await isMuted(clinicId, patient)).toBe(false);
  });

  it("lo que manda Turnia no la activa: por el texto anotado, por el id o porque WAHA dice que salió por la API", async () => {
    await sent.noteOutgoingText(chatId, "Tu turno quedó para el martes a las 10.");
    expect(await own.handleOwnMessage(clinic(), msg("m1", "Tu turno quedó para el martes a las 10."), patient, { wait: noWait })).toBe("de-turnia");
    await sent.noteOutgoingId("true_5491100005001@c.us_ABC");
    expect(await own.handleOwnMessage(clinic(), msg("true_5491100005001@c.us_ABC", "texto cambiado en el camino"), patient, { wait: noWait })).toBe("de-turnia");
    expect(await own.handleOwnMessage(clinic(), msg("m2", "Otro texto", { source: "api" }), patient, { wait: noWait })).toBe("de-turnia");
    // Una nota de voz de Sofi (sin texto) recién mandada.
    await sent.noteOutgoingVoice(chatId);
    expect(await own.handleOwnMessage(clinic(), msg("m3", "", { hasMedia: true }), patient, { wait: noWait })).toBe("de-turnia");
    expect(await isMuted(clinicId, patient)).toBe(false);
  });

  it("no la activan los mensajes al equipo, a la propia línea ni los automáticos de WhatsApp Business", async () => {
    expect(await own.handleOwnMessage(clinic(), { ...msg("m4", "Te paso el resumen"), chatId: "5491100005099@c.us" }, "5491100005099", { wait: noWait })).toBe("equipo");
    expect(await own.handleOwnMessage(clinic(), msg("m5", "Nota para mí"), "5491100005555", { wait: noWait, linePhone: "5491100005555" })).toBe("propia-linea");
    // El paciente acaba de escribir y el celular contesta solo («Gracias por escribirnos…»).
    await sql`insert into chat_usage (clinic_id, phone, kind) values (${clinicId}, ${patient}, 'mensaje')`;
    expect(await own.handleOwnMessage(clinic(), msg("m6", "¡Gracias por escribirnos! Ya te respondemos."), patient, { wait: noWait })).toBe("automatico");
    expect(await isMuted(clinicId, patient)).toBe(false);
  });

  it("si contesta el equipo desde el celular, Sofi se pausa en ese chat y se puede reactivar", async () => {
    await sql`delete from chat_usage where clinic_id = ${clinicId}`;
    expect(await own.handleOwnMessage(clinic(), msg("m7", "Hola Ana, soy Laura de recepción, te llamo en un rato."), patient, { wait: noWait })).toBe("pausado");
    expect(await isMuted(clinicId, patient)).toBe(true);
    const [m] = await sql`select reason, until > now() + interval '3 hours' and until < now() + interval '5 hours' as ok from chat_mutes where clinic_id = ${clinicId} and phone = ${patient}`;
    expect(m).toEqual({ reason: "equipo", ok: true });
    const { unmuteNumber } = await import("@/lib/chat-guard");
    await unmuteNumber(clinicId, patient);
    expect(await isMuted(clinicId, patient)).toBe(false);
  });

  it("lee bien los mensajes propios de WAHA y deja afuera grupos y los que no son propios", async () => {
    const { parseOwnMessage, parseWahaEvent } = await import("@/lib/waha");
    const event = (payload: Record<string, unknown>, ev = "message.any") => ({ event: ev, session: "default", payload: { id: "x1", from: "5491100005555@c.us", to: chatId, fromMe: true, body: " Hola ", ...payload } });
    expect(parseOwnMessage(event({}))).toEqual({ id: "x1", chatId, text: "Hola", hasMedia: false, source: null });
    expect(parseOwnMessage(event({ source: "app" }))?.source).toBe("app");
    expect(parseOwnMessage(event({ to: "5491100005001@s.whatsapp.net" }))?.chatId).toBe(chatId);
    expect(parseOwnMessage(event({ to: "120363@g.us" }))).toBeNull();
    expect(parseOwnMessage(event({ fromMe: false }))).toBeNull();
    expect(parseOwnMessage(event({}, "message.ack"))).toBeNull();
    // Un message.any entrante no se procesa dos veces: parseWahaEvent solo atiende «message».
    expect(parseWahaEvent({ event: "message.any", payload: { id: "y", from: chatId, fromMe: false, body: "Hola" } })).toMatchObject({ kind: "ignore" });
  });
});
