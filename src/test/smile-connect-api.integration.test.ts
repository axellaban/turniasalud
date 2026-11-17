import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDaysKey, localDateKey, zonedTimeToUtc } from "@/lib/time";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Smile Connect por API, contra un Smile Connect SIMULADO en memoria (nunca el real): la clave, la
// sincronización, la disponibilidad en vivo para Sofi y la escritura con su red de seguridad.
// Todos los datos y números son ficticios.

const mocks = vi.hoisted(() => ({ cookies: new Map<string, string>(), after: [] as Array<() => unknown> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.cookies.has(name) ? { value: mocks.cookies.get(name) } : undefined),
    set: (name: string, value: string) => mocks.cookies.set(name, value),
    delete: (name: string) => mocks.cookies.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); }, notFound: () => { throw new Error("notFound"); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (fn: () => unknown) => mocks.after.push(fn) }));
vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn(async () => {}) }));

const url = testDatabaseUrl();
const TZ = "America/Argentina/Buenos_Aires";
const secret = "turnia-test-secret";
const API = "https://smile.test/api/v1";
const KEY = "sc_live_00000000-0000-4000-8000-000000000000.clavedepruebaficticia";
const day = (offset: number) => addDaysKey(localDateKey(new Date(), TZ), offset);
const at = (offset: number, hhmm: string) => {
  const [y, m, d] = day(offset).split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  return zonedTimeToUtc(y, m, d, h, min, TZ).toISOString();
};
const patientPhone = "5491100006001";
const newPhone = "5491100006002";

// ── Smile Connect simulado ───────────────────────────────────────────────────
type Appt = { appointment_id: number; patient_id: number; start_date: string; end_date: string; box_id: number | null; professional_ids: number[]; attendance: string | null; cancelled: boolean };
type Pat = { patient_id: number; name: string; surname: string; id_number: string | null; email: string | null; phone_country_code: string | null; phone_number: string | null };
const fake = {
  appointments: new Map<number, Appt>(),
  patients: new Map<number, Pat>(),
  blocks: [] as Array<{ pro: number; start: string; end: string }>,
  calls: [] as Array<{ method: string; path: string; body?: unknown; idem?: string | null; professionalId?: string | null }>,
  idem: new Map<string, unknown>(),
  nextAppt: 90000,
  nextPatient: 7000,
  status: 200,
  notes: false,
  beforeCreate: undefined as (() => void) | undefined,
  createStatus: 201,
  dropCreateReply: false,
  dropMoveReply: false,
  dropCancelReply: false,
  whatsapps: [] as Array<{ chatId: string; text: string }>,
};
const PROS = [
  { professional_id: 334, name: "Mariano", surname: "Prueba", box_id: 189 },
  { professional_id: 335, name: "Emilia", surname: "Ficticia", box_id: 190 },
];
const writes = () => fake.calls.filter((c) => c.method !== "GET");

function availability(date: string, duration: number, pro?: number) {
  const [y, m, d] = date.split("-").map(Number);
  const open = zonedTimeToUtc(y, m, d, 9, 0, TZ).getTime();
  const close = zonedTimeToUtc(y, m, d, 18, 0, TZ).getTime();
  const slots = [];
  for (const p of PROS.filter((x) => !pro || x.professional_id === pro)) {
    for (let s = open; s + duration * 60_000 <= close; s += duration * 60_000) {
      const e = s + duration * 60_000;
      const taken = [...fake.appointments.values()].some((a) => !a.cancelled && a.professional_ids.includes(p.professional_id) && Date.parse(a.start_date) < e && Date.parse(a.end_date) > s)
        || fake.blocks.some((b) => b.pro === p.professional_id && Date.parse(b.start) < e && Date.parse(b.end) > s);
      if (!taken) slots.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString(), professionalId: p.professional_id });
    }
  }
  return slots;
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (u.href === "https://waha.test/api/sendText") {
    fake.whatsapps.push(JSON.parse(String(init.body)));
    return Response.json({ id: "mensaje-prueba" });
  }
  if (!u.href.startsWith(API)) return new Response(JSON.stringify({ error: "fuera del test" }), { status: 404 });
  const method = init.method ?? "GET";
  const path = u.pathname.replace("/api/v1", "");
  const headers = new Headers(init.headers);
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  fake.calls.push({ method, path, body, idem: headers.get("idempotency-key"), professionalId: u.searchParams.get("professional_id") });
  const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const err = (status: number, code: string) => ok({ error: { code, message: code, request_id: "test" } }, status);
  if (headers.get("authorization") !== `Bearer ${KEY}`) return err(401, "unauthorized");
  if (fake.status !== 200) return err(fake.status, "falla_simulada");
  const page = <T,>(rows: T[]) => {
    const limit = Number(u.searchParams.get("limit") ?? 50);
    const after = Number(u.searchParams.get("after") ?? 0);
    const slice = rows.slice(after, after + limit);
    return ok({ data: slice, next_cursor: after + limit < rows.length ? after + limit : null });
  };
  const idem = headers.get("idempotency-key");
  if (idem && fake.idem.has(`${method}${path}${idem}`)) return ok({ data: fake.idem.get(`${method}${path}${idem}`), replayed: true }, 201);
  let m: RegExpExecArray | null;
  if (path === "/clinic") return ok({ data: { clinic_id: 229, clinic_name: "Consultorio ficticio", timezone: TZ } });
  if (path === "/professionals") return page(PROS);
  if (path === "/boxes") return page([{ box_id: 189, name: "Consultorio 1" }, { box_id: 190, name: "Consultorio 2" }]);
  if (path === "/openapi") return ok({ paths: fake.notes ? { "/appointments": { post: { requestBody: { content: { "application/json": { schema: { properties: { notes: {} } } } } } } }, "/appointments/{id}": { patch: { requestBody: { content: { "application/json": { schema: { properties: { notes: {} } } } } } } } } : {} });
  if (path === "/availability") return ok({ data: { timezone: TZ, slots: availability(u.searchParams.get("date")!, Number(u.searchParams.get("duration_minutes")), u.searchParams.get("professional_id") ? Number(u.searchParams.get("professional_id")) : undefined) } });
  if (path === "/patients" && method === "GET") {
    const q = (u.searchParams.get("search") ?? "").toLowerCase();
    return page([...fake.patients.values()].filter((p) => !q || [p.name, p.surname, p.id_number, p.phone_number].some((v) => (v ?? "").toLowerCase().includes(q))));
  }
  if (path === "/patients" && method === "POST") {
    const p: Pat = { patient_id: fake.nextPatient++, name: body.name, surname: body.surname, id_number: body.id_number ?? null, email: body.email ?? null, phone_country_code: body.phone_country_code ?? null, phone_number: body.phone_number ?? null };
    fake.patients.set(p.patient_id, p);
    fake.idem.set(`${method}${path}${idem}`, { patient_id: p.patient_id });
    return ok({ data: { patient_id: p.patient_id }, replayed: false }, 201);
  }
  if ((m = /^\/patients\/(\d+)$/.exec(path))) return fake.patients.has(Number(m[1])) ? ok({ data: fake.patients.get(Number(m[1])) }) : err(404, "not_found");
  if (path === "/appointments" && method === "GET") {
    const s = Date.parse(u.searchParams.get("start")!);
    const e = Date.parse(u.searchParams.get("end")!);
    return page([...fake.appointments.values()].filter((a) => Date.parse(a.start_date) >= s && Date.parse(a.start_date) < e).sort((a, b) => a.appointment_id - b.appointment_id));
  }
  if (path === "/appointments" && method === "POST") {
    fake.beforeCreate?.();
    if (fake.createStatus !== 201) return err(fake.createStatus, "alta_simulada");
    if (!fake.patients.has(body.patient_id)) return err(400, "invalid_request");
    const a: Appt = { appointment_id: fake.nextAppt++, patient_id: body.patient_id, start_date: body.start_date, end_date: body.end_date, box_id: body.box_id, professional_ids: [body.professional_id], attendance: null, cancelled: false };
    fake.appointments.set(a.appointment_id, a);
    fake.idem.set(`${method}${path}${idem}`, { appointment_id: a.appointment_id });
    if (fake.dropCreateReply) {
      fake.dropCreateReply = false;
      return err(503, "respuesta_perdida");
    }
    return ok({ data: { appointment_id: a.appointment_id }, replayed: false }, 201);
  }
  if ((m = /^\/appointments\/(\d+)$/.exec(path))) {
    const a = fake.appointments.get(Number(m[1]));
    if (!a) return err(404, "not_found");
    if (method === "GET") return ok({ data: a });
    Object.assign(a, { start_date: body.start_date, end_date: body.end_date, box_id: body.box_id, professional_ids: [body.professional_id] });
    if (fake.dropMoveReply) {
      fake.dropMoveReply = false;
      return err(503, "respuesta_perdida");
    }
    return ok({ data: { appointment_id: a.appointment_id } });
  }
  if ((m = /^\/appointments\/(\d+)\/cancel$/.exec(path))) {
    const a = fake.appointments.get(Number(m[1]));
    if (!a) return err(404, "not_found");
    a.cancelled = true;
    if (fake.dropCancelReply) {
      fake.dropCancelReply = false;
      return err(503, "respuesta_perdida");
    }
    return ok({ data: { appointment_id: a.appointment_id } });
  }
  return err(404, "not_found");
}

type Result = Record<string, unknown> & { ok: boolean; error?: string; turno_id?: string; turnos?: Array<{ inicio: string; profesional_id: string }> };

describe.runIf(url)("Smile Connect por API (simulado)", () => {
  let sql: typeof import("@/lib/db").sql;
  let handler: typeof import("@/app/api/agent/tools/[name]/route").POST;
  let link: typeof import("@/lib/smile-connect-link");
  let push: typeof import("@/lib/smile-connect-push");
  let clinicId: string, pro: string, consult: string;

  async function tool(name: string, input: Record<string, unknown>, phone = patientPhone): Promise<Result> {
    const request = new Request(`https://turnia.test/api/agent/tools/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-turnia-secret": secret },
      body: JSON.stringify({ clinic_id: clinicId, patient_phone: phone, canal: "whatsapp", conversation_id: `conv-${phone}`, ...input }),
    });
    return (await handler(request, { params: Promise.resolve({ name }) })).json();
  }
  const scAppt = (id: number, patient: number, offset: number, from: string, to: string, extra: Partial<Appt> = {}): Appt => ({
    appointment_id: id, patient_id: patient, start_date: at(offset, from), end_date: at(offset, to), box_id: 189, professional_ids: [334], attendance: null, cancelled: false, ...extra,
  });
  const smileSync = async (id: string) => (await sql`select smile_sync, smile_error, external_id, status from appointments where id = ${id}`)[0];

  beforeAll(async () => {
    const db = await scratchDatabase(url!, "turnia_smile_api_test");
    await resetTestDatabase(db);
    for (const [k, v] of Object.entries({ DATABASE_URL: db, AGENT_TOOLS_SECRET: secret, SESSION_SECRET: "test-session", APP_URL: "https://turnia.test", SMILE_CONNECT_API_URL: API })) vi.stubEnv(k, v);
    vi.stubGlobal("fetch", fakeFetch);
    ({ sql } = await import("@/lib/db"));
    ({ POST: handler } = await import("@/app/api/agent/tools/[name]/route"));
    link = await import("@/lib/smile-connect-link");
    push = await import("@/lib/smile-connect-push");
    [{ id: clinicId }] = await sql`insert into clinics (name, specialty, is_demo, retained_at) values ('Consultorio Smile de prueba', 'Odontología', true, now()) returning id`;
    [{ id: pro }] = await sql`insert into professionals (clinic_id, full_name, specialty) values (${clinicId}, 'Dr. Mariano Prueba', 'Odontología') returning id`;
    await sql`insert into schedules (professional_id, weekday, start_time, end_time) select ${pro}::uuid, d, '09:00', '18:00' from generate_series(0, 6) d`;
    [{ id: consult }] = await sql`insert into appointment_types (clinic_id, name, specialty, duration_min) values (${clinicId}, 'Consulta', 'Odontología', 30) returning id`;
    // Un paciente que ya está en Smile Connect (con su DNI) y que se registra con Sofi.
    fake.patients.set(5001, { patient_id: 5001, name: "Juana", surname: "Ficticia", id_number: "30111222", email: null, phone_country_code: "AR", phone_number: "1100006001" });
    fake.patients.set(5002, { patient_id: 5002, name: "Pedro", surname: "Inventado", id_number: "30111333", email: null, phone_country_code: "AR", phone_number: "1100006009" });
    await tool("registrar_paciente", { nombre_completo: "Juana Ficticia", dni: "30111222", cobertura: "Particular", fecha_nacimiento: "1990-05-20" });
  }, 60000);

  beforeEach(async () => {
    mocks.cookies.clear();
    mocks.cookies.set("turnia_session", (await import("@/lib/session")).createSessionToken());
    mocks.cookies.set("turnia_clinic", clinicId);
    mocks.after.length = 0;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await sql?.end();
  });

  it("la clave se prueba antes de guardarla y vincula a los profesionales por nombre", async () => {
    await expect(link.saveSmileApiKey(clinicId, "cualquier cosa")).rejects.toThrow("no parece una clave");
    await expect(link.saveSmileApiKey(clinicId, "sc_live_clave-equivocada-0000000000")).rejects.toThrow("rechazó la clave");
    const check = await link.saveSmileApiKey(clinicId, KEY);
    expect(check).toMatchObject({ clinicName: "Consultorio ficticio", smileClinicId: 229, supportsNotes: false });
    expect(check.professionals).toEqual([
      { smileId: 334, name: "Mariano Prueba", box: "Consultorio 1", turnia: "Dr. Mariano Prueba" },
      { smileId: 335, name: "Emilia Ficticia", box: "Consultorio 2", turnia: null },
    ]);
    const [p] = await sql`select smile_professional_id, smile_box_id from professionals where id = ${pro}`;
    expect(p).toEqual({ smile_professional_id: 334, smile_box_id: 189 });
    // Guardada cifrada y apagada.
    const conn = await link.getSmileApiConnection(clinicId);
    expect(conn).toMatchObject({ api_mode: "apagada", api_key_hint: KEY.slice(-4) });
    expect(conn!.api_key_encrypted).not.toContain("clavedeprueba");
  });

  it("apagada, no hace nada: ni lee la disponibilidad ni marca nada para escribir", async () => {
    fake.calls.length = 0;
    expect(await link.smileBusy(clinicId, [pro], new Date(at(2, "00:00")), new Date(at(3, "00:00")), { timeZone: TZ })).toEqual([]);
    expect(await link.runSmileConnect()).toEqual({});
    expect(fake.calls).toEqual([]);
  });

  it("solo lectura: trae los turnos y los pacientes nuevos, sin tocar los bloqueos del userscript", async () => {
    await link.setSmileMode(clinicId, "lectura");
    fake.appointments.set(80001, scAppt(80001, 5001, 2, "10:00", "10:30", { attendance: "Whatsapp Sent" }));
    fake.appointments.set(80002, scAppt(80002, 5002, 2, "11:00", "12:00"));
    fake.appointments.set(80003, scAppt(80003, 5002, 3, "09:00", "09:30", { cancelled: true, attendance: "Canceled with Notice" }));
    await sql`insert into schedule_blocks (clinic_id, professional_id, starts_at, ends_at, reason, external_id) values (${clinicId}, ${pro}, ${at(2, "15:00")}, ${at(2, "16:00")}, 'Bloqueo del userscript', 'sc:ev1')`;
    const r = await link.pullSmileConnect(clinicId, "cerca");
    expect(r).toMatchObject({ leidos: 3, appointmentsCreated: 3, pendientes: 0 });
    const rows = await sql`select external_id, status, source from appointments where clinic_id = ${clinicId} and external_id like 'sc:%' order by external_id`;
    expect(rows.map((x) => [x.external_id, x.status, x.source])).toEqual([
      ["sc:80001", "confirmado", "smile_connect"], ["sc:80002", "confirmado", "smile_connect"], ["sc:80003", "cancelado", "smile_connect"],
    ]);
    // Juana se vinculó con la ficha que ya tenía en Turnia; Pedro es nuevo.
    const links = await sql`select external_id, p.full_name from patient_external_ids x join patients p on p.id = x.patient_id where x.clinic_id = ${clinicId} order by external_id`;
    expect(links.map((l) => [l.external_id, l.full_name])).toEqual([["sc:5001", "Juana Ficticia"], ["sc:5002", "Pedro Inventado"]]);
    expect((await sql`select count(*)::int as n from patients where clinic_id = ${clinicId}`)[0].n).toBe(2);
    expect((await sql`select count(*)::int as n from schedule_blocks where external_id = 'sc:ev1'`)[0].n).toBe(1);
    // Lo que trajo la sincronización no queda para escribir en Smile Connect.
    expect((await sql`select count(*)::int as n from appointments where smile_sync is not null`)[0].n).toBe(0);
    expect((await link.getSmileApiConnection(clinicId))!.api_reads).toBeGreaterThan(0);
  });

  it("si de golpe desaparecen muchos turnos, no aplica nada y avisa", async () => {
    const saved = new Map(fake.appointments);
    for (let i = 0; i < 6; i++) fake.appointments.set(81000 + i, scAppt(81000 + i, 5002, 3, `1${i}:00`, `1${i}:30`));
    await link.pullSmileConnect(clinicId, "cerca");
    for (let i = 0; i < 6; i++) fake.appointments.delete(81000 + i);
    await expect(link.pullSmileConnect(clinicId, "cerca")).rejects.toThrow("dejó de mostrar 6 turnos");
    expect((await sql`select count(*)::int as n from appointments where external_id like 'sc:810%' and status = 'confirmado'`)[0].n).toBe(6);
    // Se borraron de verdad (de a uno, en la vida real): se limpia la prueba.
    await sql`delete from appointments where external_id like 'sc:810%'`;
    fake.appointments = saved;
  });

  it("Sofi no ofrece lo que está ocupado o bloqueado en Smile Connect, aunque Turnia no lo sepa", async () => {
    // Un bloqueo que solo está en Smile Connect (la API no da los bloqueos) toda la mañana del día 4.
    fake.blocks.push({ pro: 334, start: at(4, "09:00"), end: at(4, "13:00") });
    const r = await tool("consultar_disponibilidad", { tipo_turno_id: consult, desde: day(4), hasta: day(4) });
    expect(r.ok).not.toBe(false);
    const starts = (r.turnos ?? []).map((s) => s.inicio);
    expect(starts.length).toBeGreaterThan(0);
    expect(starts.every((s) => Date.parse(s) >= Date.parse(at(4, "13:00")))).toBe(true);
    // Al reservar, se vuelve a mirar en el momento: un turno recién dado en Smile Connect frena la reserva.
    fake.appointments.set(80010, scAppt(80010, 5002, 4, "13:00", "13:30"));
    const booked = await tool("reservar_turno", { tipo_turno_id: consult, profesional_id: pro, inicio: at(4, "13:00") });
    expect(booked).toMatchObject({ ok: false, error: expect.stringContaining("ya está ocupado") });
    fake.appointments.delete(80010);
  });

  it("solo lectura: lo que da Sofi no se escribe en Smile Connect", async () => {
    fake.calls.length = 0;
    const booked = await tool("reservar_turno", { tipo_turno_id: consult, profesional_id: pro, inicio: at(4, "14:00") });
    expect(booked.ok).toBe(true);
    expect((await smileSync(booked.turno_id!)).smile_sync).toBeNull();
    for (const fn of mocks.after.splice(0)) await fn();
    expect(writes()).toEqual([]);
    await tool("cancelar_turno", { turno_id: booked.turno_id });
  });

  it("una caída al confirmar deriva el pedido aunque haya disponibilidad anterior en caché", async () => {
    const input = { tipo_turno_id: consult, profesional_id: pro, inicio: at(12, "11:00") };
    const offer = await tool("consultar_disponibilidad", { tipo_turno_id: consult, desde: day(12), hasta: day(12) });
    expect(offer.ok).toBe(true);
    fake.appointments.set(81999, scAppt(81999, 5002, 12, "11:00", "11:30"));
    fake.status = 503;
    try {
      const result = await tool("reservar_turno", input);
      expect(result).toMatchObject({ ok: false, pendiente_recepcion: true, tarea_id: expect.any(String) });
      expect(await sql`select id from appointments where clinic_id = ${clinicId} and starts_at = ${input.inicio}`).toEqual([]);
      expect(await sql`select type from tasks where id = ${result.tarea_id as string}`).toEqual([{ type: "derivacion_humana" }]);
    } finally {
      fake.status = 200;
      fake.appointments.delete(81999);
    }
  });

  it("escritura de prueba: anota qué escribiría (con el paciente encontrado por DNI), sin escribir", async () => {
    await link.setSmileMode(clinicId, "sombra");
    fake.calls.length = 0;
    const booked = await tool("reservar_turno", { tipo_turno_id: consult, profesional_id: pro, inicio: at(4, "15:00") });
    expect((await smileSync(booked.turno_id!)).smile_sync).toBe("pendiente");
    expect(await push.pushPendingSmile(clinicId)).toMatchObject({ sombra: 1 });
    expect(writes()).toEqual([]);
    const [change] = await sql`select action, status, request from smile_connect_changes where appointment_id = ${booked.turno_id!}`;
    expect(change).toMatchObject({ action: "crear", status: "sombra", request: { patient_id: 5001, professional_id: 334, box_id: 189 } });
    expect(await smileSync(booked.turno_id!)).toMatchObject({ smile_sync: "ok", external_id: null });
  });

  it("«Crear, mover y cancelar» sin SMILE_CONNECT_WRITES=on en el servidor sigue siendo de prueba", async () => {
    await link.setSmileMode(clinicId, "completa");
    fake.calls.length = 0;
    const booked = await tool("reservar_turno", { tipo_turno_id: consult, profesional_id: pro, inicio: at(4, "15:30") });
    expect(await push.pushPendingSmile(clinicId)).toMatchObject({ sombra: 1 });
    expect(writes()).toEqual([]);
    await tool("cancelar_turno", { turno_id: booked.turno_id });
    await push.pushPendingSmile(clinicId);
  });

  describe("con la escritura real habilitada", () => {
    beforeAll(() => vi.stubEnv("SMILE_CONNECT_WRITES", "on"));

    it("activar la escritura no envía turnos que quedaron en la cola de pruebas", async () => {
      await link.setSmileMode(clinicId, "sombra");
      const booked = await tool("reservar_turno", { tipo_turno_id: consult, profesional_id: pro, inicio: at(13, "11:00") });
      expect(booked.ok).toBe(true);
      expect(await smileSync(booked.turno_id!)).toMatchObject({ smile_sync: "pendiente" });
      fake.calls.length = 0;
      await link.setSmileMode(clinicId, "crear");
      expect(await push.pushPendingSmile(clinicId)).toMatchObject({ ok: 0 });
      expect(writes()).toEqual([]);
      expect(await smileSync(booked.turno_id!)).toMatchObject({ smile_sync: "revisar", external_id: null });
    });

    it("confirma después de verificar el alta y crea el turno y el paciente una sola vez", async () => {
      await link.setSmileMode(clinicId, "crear");
      fake.calls.length = 0;
      const input = { tipo_turno_id: consult, profesional_id: pro, inicio: at(5, "10:00"), notas: "Le duele una muela" };
      const booked = await tool("reservar_turno", input);
      expect(booked.ok).toBe(true);
      expect(fake.calls.filter((c) => c.path === "/availability").map((c) => c.professionalId)).toEqual(["334", "334"]);
      expect(await tool("reservar_turno", input)).toMatchObject({ ok: true, turno_id: booked.turno_id });
      expect(await push.pushPendingSmile(clinicId)).toMatchObject({ ok: 0 });
      const row = await smileSync(booked.turno_id!);
      expect(row).toMatchObject({ status: "confirmado", smile_sync: "ok", external_id: expect.stringMatching(/^sc:\d+$/) });
      const created = fake.appointments.get(Number(row.external_id.slice(3)))!;
      expect(created).toMatchObject({ patient_id: 5001, professional_ids: [334], box_id: 189, start_date: at(5, "10:00"), end_date: at(5, "10:30") });
      expect(writes()).toEqual([expect.objectContaining({ method: "POST", path: "/appointments", idem: `turnia-turno-${booked.turno_id}` })]);
      // Sin notas: la API todavía no las acepta.
      expect(writes()[0].body).not.toHaveProperty("notes");

      // Paciente que no está en Smile Connect: se crea primero.
      await tool("registrar_paciente", { nombre_completo: "Lucía Nueva Inventada", dni: "30999000", cobertura: "Particular", fecha_nacimiento: "1985-01-02" }, newPhone);
      const other = await tool("reservar_turno", { tipo_turno_id: consult, profesional_id: pro, inicio: at(5, "11:00") }, newPhone);
      expect(other.ok).toBe(true);
      const lucia = [...fake.patients.values()].find((p) => p.id_number === "30999000");
      expect(lucia).toMatchObject({ name: "Lucía Nueva", surname: "Inventada", phone_country_code: "54", phone_number: "1100006002" });
      const otherRow = await smileSync(other.turno_id!);
      expect(fake.appointments.get(Number(otherRow.external_id.slice(3)))!.patient_id).toBe(lucia!.patient_id);
      const actions = await sql`select action, status from smile_connect_changes where status = 'hecho' order by created_at`;
      expect(actions.map((a) => a.action)).toEqual(["crear", "crear_paciente", "crear"]);

      // La próxima sincronización no lo duplica.
      await link.pullSmileConnect(clinicId, "lejos");
      expect((await sql`select count(*)::int as n from appointments where external_id = ${row.external_id}`)[0].n).toBe(1);
    });

    it("el modo completo mueve desde el panel el mismo turno de Smile Connect", async () => {
      await link.setSmileMode(clinicId, "completa");
      const { rescheduleClinicAppointment } = await import("@/lib/agent/service");
      const [orig] = await sql`select id, external_id from appointments where clinic_id = ${clinicId} and starts_at = ${at(5, "10:00")} and status = 'confirmado'`;
      fake.calls.length = 0;
      const moved = await rescheduleClinicAppointment(clinicId, orig.id, { nuevo_inicio: at(5, "16:00") });
      expect(moved.ok).toBe(true);
      expect(await push.pushPendingSmile(clinicId)).toMatchObject({ ok: 1 });
      const scId = Number(orig.external_id.slice(3));
      expect(fake.appointments.get(scId)).toMatchObject({ start_date: at(5, "16:00"), end_date: at(5, "16:30"), cancelled: false });
      expect(writes()).toEqual([expect.objectContaining({ method: "PATCH", path: `/appointments/${scId}` })]);
      expect(await smileSync(moved.turno_id!)).toMatchObject({ external_id: orig.external_id, smile_sync: "ok" });
      expect((await smileSync(orig.id)).external_id).toBeNull();
      // Queda registrado cómo estaba, para poder deshacerlo.
      const [change] = await sql`select before from smile_connect_changes where action = 'mover' and status = 'hecho'`;
      expect(change.before).toMatchObject({ appointment_id: scId, start_date: at(5, "10:00") });
      await link.pullSmileConnect(clinicId, "lejos");
      expect((await sql`select count(*)::int as n from appointments where external_id = ${orig.external_id} and status = 'confirmado'`)[0].n).toBe(1);
    });

    it("el modo completo cancela desde el panel un turno que vino de Smile Connect", async () => {
      const { cancelClinicAppointment } = await import("@/lib/agent/service");
      const [mine] = await sql`select id from appointments where clinic_id = ${clinicId} and external_id = 'sc:80001'`;
      fake.calls.length = 0;
      expect((await cancelClinicAppointment(clinicId, mine.id, "No puede ir")).ok).toBe(true);
      expect(await push.pushPendingSmile(clinicId)).toMatchObject({ ok: 1 });
      expect(fake.appointments.get(80001)!.cancelled).toBe(true);
      expect(writes()).toEqual([expect.objectContaining({ method: "POST", path: "/appointments/80001/cancel" })]);
    });

    it("si en Smile Connect el turno cambió mientras tanto, no lo toca y lo deja para revisar", async () => {
      const { cancelClinicAppointment } = await import("@/lib/agent/service");
      await sql`insert into clinic_notice_phones (clinic_id, phone, name) values (${clinicId}, '5491100006100', 'Recepción')`;
      const booked = await tool("reservar_turno", { tipo_turno_id: consult, profesional_id: pro, inicio: at(6, "10:00") });
      await push.pushPendingSmile(clinicId);
      const { external_id } = await smileSync(booked.turno_id!);
      // Recepción lo movió en Smile Connect antes de que Turnia se entere.
      Object.assign(fake.appointments.get(Number(external_id.slice(3)))!, { start_date: at(6, "12:00"), end_date: at(6, "12:30") });
      fake.calls.length = 0;
      await cancelClinicAppointment(clinicId, booked.turno_id!);
      expect(await push.pushPendingSmile(clinicId)).toMatchObject({ revisar: 1 });
      expect(writes()).toEqual([]);
      expect(fake.appointments.get(Number(external_id.slice(3)))!.cancelled).toBe(false);
      expect(await smileSync(booked.turno_id!)).toMatchObject({ smile_sync: "revisar", smile_error: expect.stringContaining("cambió de horario") });
      const [notice] = await sql`select kind, body from clinic_notices where appointment_id = ${booked.turno_id!} and kind = 'smile'`;
      expect(notice).toMatchObject({ kind: "smile", body: expect.stringContaining("Revisar en Smile Connect") });
      expect((await push.smileReviewList(clinicId)).map((r) => r.id)).toContain(booked.turno_id);
      await push.dismissSmileReview(clinicId, booked.turno_id!);
      expect((await push.smileReviewList(clinicId)).map((r) => r.id)).not.toContain(booked.turno_id);
    });

    it("si recepción toma el horario durante el alta, conserva el suyo y revierte solo el de Turnia", async () => {
      fake.calls.length = 0;
      fake.beforeCreate = () => { fake.appointments.set(80020, scAppt(80020, 5002, 6, "14:00", "14:30")); };
      try {
        const booked = await tool("reservar_turno", { tipo_turno_id: consult, profesional_id: pro, inicio: at(6, "14:00") });
        expect(booked).toMatchObject({ ok: false, pendiente_recepcion: true });
        const [row] = await sql`select status, smile_sync, smile_error, external_id from appointments where clinic_id = ${clinicId} and starts_at = ${at(6, "14:00")}`;
        expect(row).toMatchObject({ status: "cancelado", smile_sync: "revisar", smile_error: expect.stringContaining("Se revirtió") });
        expect(fake.appointments.get(80020)?.cancelled).toBe(false);
        expect(fake.appointments.get(Number(row.external_id.slice(3)))?.cancelled).toBe(true);
        expect(writes().map((w) => w.path)).toEqual(["/appointments", `/appointments/${row.external_id.slice(3)}/cancel`]);
      } finally {
        fake.beforeCreate = undefined;
      }
    });

    it("si el alta devuelve un resultado incierto, queda pendiente y reintentar el pedido no escribe otra vez", async () => {
      fake.calls.length = 0;
      fake.createStatus = 503;
      const input = { tipo_turno_id: consult, profesional_id: pro, inicio: at(6, "15:00") };
      try {
        expect(await tool("reservar_turno", input)).toMatchObject({ ok: false, pendiente_recepcion: true });
      } finally {
        fake.createStatus = 201;
      }
      const [row] = await sql`select id, status, smile_sync, external_id from appointments where clinic_id = ${clinicId} and starts_at = ${input.inicio}`;
      expect(row).toMatchObject({ status: "pendiente", smile_sync: "revisar", external_id: null });
      expect(await tool("reservar_turno", input)).toMatchObject({ ok: false, pendiente_recepcion: true });
      expect(await tool("confirmar_turno", { turno_id: row.id })).toMatchObject({ ok: false, pendiente_recepcion: true });
      expect(await push.pushPendingSmile(clinicId)).toMatchObject({ ok: 0, error: 0 });
      expect(writes().map((w) => w.path)).toEqual(["/appointments"]);
    });

    it("con «Crear turnos», Sofi manda a recepción los cambios y el original sigue reservado", async () => {
      await link.setSmileMode(clinicId, "crear");
      const booked = await tool("reservar_turno", { tipo_turno_id: consult, profesional_id: pro, inicio: at(7, "10:00") });
      fake.calls.length = 0;
      expect(await tool("reprogramar_turno", { turno_id: booked.turno_id, nuevo_inicio: at(7, "16:30") })).toMatchObject({ ok: false, pendiente_recepcion: true });
      expect(await tool("cancelar_turno", { turno_id: booked.turno_id })).toMatchObject({ ok: false, pendiente_recepcion: true });
      expect(writes()).toEqual([]);
      expect(await smileSync(booked.turno_id!)).toMatchObject({ status: "confirmado", smile_sync: "ok" });

      const [second] = await sql`insert into appointment_types (clinic_id, name, specialty, duration_min)
        values (${clinicId}, 'Limpieza', 'Odontología', 30) returning id`;
      const combined = await tool("reservar_turno", {
        tipo_turno_id: consult, segundo_tipo_turno_id: second.id, profesional_id: pro, inicio: at(7, "13:00"),
      });
      expect(combined).toMatchObject({ ok: false, pendiente_recepcion: true });
      expect(writes()).toEqual([]);
    });

    it("si Smile Connect falla, reintenta; con demasiados cambios en una hora, se frena sola", async () => {
      await link.setSmileMode(clinicId, "completa");
      vi.stubEnv("SMILE_CONNECT_WRITES", "");
      // Una fila de la cola anterior sigue siendo reintentable con la clave idempotente.
      const booked = await tool("reservar_turno", { tipo_turno_id: consult, profesional_id: pro, inicio: at(7, "11:00") });
      vi.stubEnv("SMILE_CONNECT_WRITES", "on");
      fake.status = 503;
      expect(await push.pushPendingSmile(clinicId)).toMatchObject({ error: 1 });
      expect(await smileSync(booked.turno_id!)).toMatchObject({ smile_sync: "error" });
      fake.status = 200;
      expect(await push.pushPendingSmile(clinicId)).toMatchObject({ ok: 1 });

      await sql`
        insert into smile_connect_changes (clinic_id, action, status)
        select ${clinicId}, 'crear', 'hecho' from generate_series(1, 15)`;
      fake.calls.length = 0;
      const next = await tool("reservar_turno", { tipo_turno_id: consult, profesional_id: pro, inicio: at(7, "12:00") });
      expect(next).toMatchObject({ ok: false, pendiente_recepcion: true });
      expect(await push.pushPendingSmile(clinicId)).toMatchObject({ frenado: expect.stringContaining("Se frenó la escritura") });
      expect(writes()).toEqual([]);
      await push.resumeSmileWrites(clinicId);
      await sql`delete from smile_connect_changes where appointment_id is null`;
      expect(await push.pushPendingSmile(clinicId)).toMatchObject({ ok: 0 });
    });

    it("cuando la API acepte notas, manda el motivo del turno", async () => {
      fake.notes = true;
      await link.saveSmileApiKey(clinicId, KEY);
      fake.calls.length = 0;
      await tool("reservar_turno", { tipo_turno_id: consult, profesional_id: pro, inicio: at(8, "10:00"), notas: "Control de ortodoncia" });
      await push.pushPendingSmile(clinicId);
      expect(writes()[0].body).toMatchObject({ notes: expect.stringContaining("Consulta · Control de ortodoncia") });
      fake.notes = false;
    });
  });

  it("la copia diaria guarda pacientes y turnos, y quitar la clave apaga todo", async () => {
    const r = await link.backupSmileConnect(clinicId);
    expect(r.pacientes).toBe(fake.patients.size);
    expect(r.turnos).toBeGreaterThan(0);
    expect((await sql`select count(*)::int as n from smile_connect_backups where clinic_id = ${clinicId}`)[0].n).toBe(1);
    await link.removeSmileApiKey(clinicId);
    expect(await link.getSmileApiConnection(clinicId)).toMatchObject({ api_key_encrypted: null, api_mode: "apagada" });
    expect((await sql`select count(*)::int as n from appointments where smile_sync in ('pendiente', 'error')`)[0].n).toBe(0);
  });

  describe("confirmación diferida de Guerra–Mininni", () => {
    const gm = "67c3954a-8df8-46c2-a604-f818832bee36";
    let gmPro: string, gmConsult: string;
    const book = (offset: number) => tool("reservar_turno", {
      clinic_id: gm, profesional_id: gmPro, tipo_turno_id: gmConsult, inicio: at(offset, "10:00"),
    });
    const send = async () => (await import("@/lib/clinic-notices")).sendPendingNotices(gm);

    beforeAll(async () => {
      vi.stubEnv("SMILE_CONNECT_WRITES", "on");
      vi.stubEnv("WAHA_CONNECTIONS", JSON.stringify([{
        id: "guerra-mininni", clinicId: gm, phone: "5491100006666", url: "https://waha.test/",
        apiKey: "clave-ficticia-abc", webhookHmac: "firma-ficticia-abc", enabled: true, revision: 1,
      }]));
      await sql`insert into clinics (id, name, specialty, address) values (${gm}, 'Guerra Mininni de prueba', 'Odontología', 'Dirección ficticia')`;
      [{ id: gmPro }] = await sql`insert into professionals (clinic_id, full_name, specialty)
        values (${gm}, 'Dr. Mariano Prueba', 'Odontología') returning id`;
      [{ id: gmConsult }] = await sql`insert into appointment_types (clinic_id, name, specialty, duration_min)
        values (${gm}, 'Control', 'Odontología', 30) returning id`;
      await sql`insert into schedules (professional_id, weekday, start_time, end_time)
        select ${gmPro}::uuid, d, '09:00', '18:00' from generate_series(0, 6) d`;
      await link.saveSmileApiKey(gm, KEY);
      await link.setSmileMode(gm, "crear");
      await tool("registrar_paciente", { clinic_id: gm, nombre_completo: "Juana Ficticia", dni: "30111222", cobertura: "Particular" });
    });

    it("solo ofrece horarios verificados en la consulta actual", async () => {
      const args = { clinic_id: gm, tipo_turno_id: gmConsult, profesional_id: gmPro, desde: day(20), hasta: day(20) };
      expect(await tool("consultar_disponibilidad", args)).toMatchObject({ ok: true, turnos: expect.any(Array) });
      fake.status = 503;
      try {
        expect(await tool("consultar_disponibilidad", args)).toMatchObject({ ok: false, pendiente_recepcion: true });
      } finally {
        fake.status = 200;
      }
    });

    it("recupera un alta cuya respuesta se perdió y envía una sola confirmación", async () => {
      fake.calls.length = 0;
      const [a, b] = await Promise.all([book(20), book(20)]);
      expect(a).toMatchObject({ ok: false, pendiente_confirmacion: true });
      expect(b).toMatchObject({ turno_id: a.turno_id, pendiente_confirmacion: true });
      expect(writes()).toEqual([]);
      fake.dropCreateReply = true;
      expect(await push.pushPendingSmile(gm, a.turno_id)).toMatchObject({ error: 1 });
      expect(await smileSync(a.turno_id!)).toMatchObject({ status: "pendiente", smile_sync: "error" });
      expect(fake.whatsapps).toHaveLength(0);
      const outcomes = await Promise.all([push.pushPendingSmile(gm, a.turno_id), push.pushPendingSmile(gm, a.turno_id)]);
      expect(outcomes.reduce((n, o) => n + Number(o.ok), 0)).toBe(1);
      expect(await smileSync(a.turno_id!)).toMatchObject({ status: "confirmado", smile_sync: "ok", external_id: expect.stringMatching(/^sc:/) });
      expect(writes().filter((w) => w.path === "/appointments")).toHaveLength(1);
      await Promise.all([send(), send()]);
      expect(fake.whatsapps).toEqual([expect.objectContaining({
        chatId: `${patientPhone}@c.us`, text: expect.stringContaining("Turno confirmado"),
      })]);
    });

    it("si recepción se adelanta, libera el pedido local y avisa que puede buscar otro horario", async () => {
      const pending = await book(21);
      const other = scAppt(80500, 5002, 21, "10:00", "10:30");
      fake.appointments.set(other.appointment_id, other);
      fake.calls.length = 0;
      await push.pushPendingSmile(gm, pending.turno_id);
      expect(await smileSync(pending.turno_id!)).toMatchObject({ status: "cancelado", external_id: null });
      expect(other.cancelled).toBe(false);
      expect(writes()).toEqual([]);
      await send();
      expect(fake.whatsapps.at(-1)?.text).toContain("ya no está disponible");
    });

    it("si vence el tercer intento, deja una sola tarea de recepción y el turno sin confirmar", async () => {
      const pending = await book(22);
      fake.status = 503;
      try {
        for (let i = 0; i < 4; i++) await push.pushPendingSmile(gm, pending.turno_id);
      } finally {
        fake.status = 200;
      }
      expect(await smileSync(pending.turno_id!)).toMatchObject({ status: "pendiente", smile_sync: "revisar" });
      const [tasks] = await sql`select count(*)::int as n from tasks where clinic_id = ${gm}
        and details like ${`%${pending.turno_id}%`}`;
      expect(tasks.n).toBe(1);
      await send();
      expect(fake.whatsapps.at(-1)?.text).toContain("sigue pendiente");
    });

    it("mueve el mismo turno y después lo cancela, verificando los dos cambios aun sin respuesta de escritura", async () => {
      await link.setSmileMode(gm, "completa");
      const booking = await book(23);
      await push.pushPendingSmile(gm, booking.turno_id);
      await send();
      fake.whatsapps.length = 0;
      fake.calls.length = 0;
      const before = await smileSync(booking.turno_id!);
      const remoteId = Number(before.external_id.slice(3));
      const move = { clinic_id: gm, turno_id: booking.turno_id, nuevo_inicio: at(23, "11:00"), profesional_id: gmPro };
      const replies = await Promise.all([tool("reprogramar_turno", move), tool("reprogramar_turno", move)]);
      for (const r of replies) expect(r).toMatchObject({ ok: false, pendiente_confirmacion: true, turno_id: booking.turno_id });
      expect(await smileSync(booking.turno_id!)).toMatchObject({ status: "confirmado" });
      expect(fake.appointments.get(remoteId)?.start_date).toBe(at(23, "10:00"));
      fake.dropMoveReply = true;
      expect(await push.pushPendingSmile(gm, booking.turno_id)).toMatchObject({ error: 1 });
      expect(await smileSync(booking.turno_id!)).toMatchObject({ status: "confirmado", smile_sync: "error" });
      expect(fake.whatsapps).toHaveLength(0);
      expect(await push.pushPendingSmile(gm, booking.turno_id)).toMatchObject({ ok: 1 });
      const [moved] = await sql`select id, starts_at, status from appointments where clinic_id = ${gm} and external_id = ${before.external_id}`;
      expect(moved).toMatchObject({ starts_at: at(23, "11:00"), status: "confirmado" });
      expect(await smileSync(booking.turno_id!)).toMatchObject({ status: "reprogramado", external_id: null });
      expect(writes().map((w) => [w.method, w.path])).toEqual([["PATCH", `/appointments/${remoteId}`]]);
      await Promise.all([send(), send()]);
      expect(fake.whatsapps.map((w) => w.text)).toEqual([expect.stringContaining("Reprogramación confirmada")]);

      const result = await tool("cancelar_turno", { clinic_id: gm, turno_id: moved.id, motivo: "Prueba" });
      expect(result).toMatchObject({ ok: false, pendiente_confirmacion: true });
      expect(await smileSync(moved.id)).toMatchObject({ status: "confirmado" });
      fake.dropCancelReply = true;
      expect(await push.pushPendingSmile(gm, moved.id)).toMatchObject({ error: 1 });
      expect(await smileSync(moved.id)).toMatchObject({ status: "confirmado" });
      expect(await push.pushPendingSmile(gm, moved.id)).toMatchObject({ ok: 1 });
      expect(await smileSync(moved.id)).toMatchObject({ status: "cancelado", external_id: before.external_id });
      expect(fake.appointments.get(remoteId)?.cancelled).toBe(true);
      expect(writes().filter((w) => w.path.endsWith("/cancel"))).toHaveLength(1);
      await send();
      expect(fake.whatsapps.map((w) => w.text)).toEqual([expect.stringContaining("Reprogramación confirmada"), expect.stringContaining("Cancelación confirmada")]);
    });

    it("conserva el turno original si recepción ocupa el destino y mantiene las restricciones de reprogramación", async () => {
      const booking = await book(24);
      await push.pushPendingSmile(gm, booking.turno_id);
      const before = await smileSync(booking.turno_id!);
      const target = { clinic_id: gm, turno_id: booking.turno_id, nuevo_inicio: at(24, "11:00"), profesional_id: gmPro };
      await sql`update clinics set reception_only_terms = 'implante' where id = ${gm}`;
      await sql`update appointments set title = 'Colocación de implante' where id = ${booking.turno_id!}`;
      expect(await tool("reprogramar_turno", target)).toMatchObject({ ok: false, error: expect.stringContaining("coordina recepción") });
      await sql`update appointments set title = null where id = ${booking.turno_id!}`;
      expect(await tool("reprogramar_turno", target)).toMatchObject({ pendiente_confirmacion: true });
      fake.appointments.set(80504, scAppt(80504, 5002, 24, "11:00", "11:30"));
      fake.calls.length = 0;
      await push.pushPendingSmile(gm, booking.turno_id);
      expect(await smileSync(booking.turno_id!)).toMatchObject({ status: "confirmado", external_id: before.external_id });
      expect(writes()).toEqual([]);
      await send();
      expect(fake.whatsapps.at(-1)?.text).toContain("El turno original sigue reservado");
    });
  });
});
