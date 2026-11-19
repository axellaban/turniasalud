import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDaysKey, localDateKey, zonedTimeToUtc } from "@/lib/time";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Smile Connect por API, contra un Smile Connect SIMULADO en memoria (nunca el real): la clave, la
// sincronización, la disponibilidad en vivo para Sofi y la escritura con su red de seguridad.
// Todos los datos y números son ficticios.

const mocks = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  after: [] as Array<() => unknown>,
  axel: [] as string[],
  axelOk: true,
}));
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
// Los avisos a Axel por WhatsApp se anotan acá en vez de salir.
vi.mock("@/lib/chat-guard", async (original) => ({
  ...(await original<typeof import("@/lib/chat-guard")>()),
  notifyAxel: async (text: string) => {
    if (!mocks.axelOk) return false;
    mocks.axel.push(text);
    return true;
  },
}));

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
type Appt = { appointment_id: number; patient_id: number; start_date: string; end_date: string; box_id: number | null; professional_ids: number[]; attendance: string | null; cancelled: boolean; notes?: string | null; service_id?: number | null };
type Ev = { event_id: number; type: "vacation" | "outOfService" | "other"; name: string | null; start_date: string; end_date: string; professional_id: number; box_id: number | null; notes: string | null };
/** Celdas cada 30 minutos de `from` a `to` (sin incluir `to`), como las devuelve Smile Connect. */
const cells = (from: string, to: string) => {
  const out: string[] = [];
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  for (let x = m(from); x < m(to); x += 30) out.push(`${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`);
  return out;
};
/** El horario de siempre de los profesionales simulados: todos los días de 9 a 18 (igual que la disponibilidad). */
const allWeek = () => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), cells("09:00", "18:00")]));
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
  /** Días (YYYY-MM-DD) en que /availability falla, como si Smile Connect tardara de más. */
  failDates: new Set<string>(),
  notes: false,
  beforeCreate: undefined as (() => void) | undefined,
  createStatus: 201,
  dropCreateReply: false,
  dropMoveReply: false,
  rateLimitAfterMove: null as string | null,
  appointmentListRetryAfter: null as string | null,
  dropCancelReply: false,
  whatsapps: [] as Array<{ chatId: string; text: string }>,
  /** Horario semanal por profesional (si no está, todos los días de 9 a 18). */
  hours: new Map<number, Record<string, string[]>>(),
  events: [] as Ev[],
  /** Simula un rechazo de permisos al leer los bloqueos. */
  eventsScope: false,
  eventsStatus: 200,
  /** La API con `updated_since` (todavía no existe en la real) y cuándo cambió cada turno y paciente. */
  delta: false,
  changedAt: new Map<number, number>(),
  patientChangedAt: new Map<number, number>(),
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
  if ((m = /^\/professionals\/(\d+)\/hours$/.exec(path))) {
    const id = Number(m[1]);
    return ok({ data: { professional_id: id, timezone: TZ, interval_minutes: 30, hours: fake.hours.get(id) ?? allWeek() } });
  }
  if (path === "/events") {
    if (fake.eventsStatus !== 200) return err(fake.eventsStatus, "events_unavailable");
    if (!fake.eventsScope) return err(403, "insufficient_scope");
    const s = Date.parse(u.searchParams.get("start")!);
    const e = Date.parse(u.searchParams.get("end")!);
    return page(fake.events.filter((x) => Date.parse(x.start_date) >= s && Date.parse(x.start_date) < e));
  }
  if (path === "/services") return page([{ service_id: 12, name: "Limpieza", prices: [] }]);
  if (path === "/boxes") return page([{ box_id: 189, name: "Consultorio 1" }, { box_id: 190, name: "Consultorio 2" }]);
  if (path === "/openapi") {
    const notesBody = { requestBody: { content: { "application/json": { schema: { properties: { notes: {} } } } } } };
    const deltaGet = { get: { parameters: [{ name: "limit" }, { name: "after" }, { name: "updated_since" }] } };
    return ok({ paths: {
      "/appointments": { ...(fake.notes && { post: notesBody }), ...(fake.delta && deltaGet) },
      "/appointments/{id}": { ...(fake.notes && { patch: notesBody }) },
      "/patients": { ...(fake.delta && deltaGet) },
    } });
  }
  if (path === "/availability" && fake.failDates.has(u.searchParams.get("date")!)) return err(503, "falla_simulada");
  if (path === "/availability") return ok({ data: { timezone: TZ, slots: availability(u.searchParams.get("date")!, Number(u.searchParams.get("duration_minutes")), u.searchParams.get("professional_id") ? Number(u.searchParams.get("professional_id")) : undefined) } });
  if (path === "/patients" && method === "GET" && u.searchParams.has("updated_since")) {
    if (!fake.delta) return err(400, "invalid_request");
    const since = Date.parse(u.searchParams.get("updated_since")!);
    const limit = Number(u.searchParams.get("limit") ?? 50);
    const after = Number(u.searchParams.get("after") ?? 0);
    const rows = [...fake.patients.values()].filter((p) => (fake.patientChangedAt.get(p.patient_id) ?? 0) >= since && p.patient_id > after).sort((a, b) => a.patient_id - b.patient_id);
    const slice = rows.slice(0, limit);
    return ok({ data: slice, next_cursor: rows.length > limit ? slice[slice.length - 1].patient_id : null });
  }
  if (path === "/patients" && method === "GET") {
    const q = (u.searchParams.get("search") ?? "").toLowerCase();
    // Como la API real: pagina por id (after = el último id de la página anterior).
    const limit = Number(u.searchParams.get("limit") ?? 50);
    const after = Number(u.searchParams.get("after") ?? 0);
    const rows = [...fake.patients.values()]
      .filter((p) => !q || [p.name, p.surname, p.id_number, p.phone_number].some((v) => (v ?? "").toLowerCase().includes(q)))
      .filter((p) => p.patient_id > after)
      .sort((a, b) => a.patient_id - b.patient_id);
    const slice = rows.slice(0, limit);
    return ok({ data: slice, next_cursor: rows.length > limit ? slice[slice.length - 1].patient_id : null });
  }
  if (path === "/patients" && method === "POST") {
    const p: Pat = { patient_id: fake.nextPatient++, name: body.name, surname: body.surname, id_number: body.id_number ?? null, email: body.email ?? null, phone_country_code: body.phone_country_code ?? null, phone_number: body.phone_number ?? null };
    fake.patients.set(p.patient_id, p);
    fake.idem.set(`${method}${path}${idem}`, { patient_id: p.patient_id });
    return ok({ data: { patient_id: p.patient_id }, replayed: false }, 201);
  }
  if ((m = /^\/patients\/(\d+)$/.exec(path))) return fake.patients.has(Number(m[1])) ? ok({ data: fake.patients.get(Number(m[1])) }) : err(404, "not_found");
  if (path === "/appointments" && method === "GET") {
    const retry = fake.appointmentListRetryAfter;
    if (retry !== null) {
      fake.appointmentListRetryAfter = null;
      return Response.json({ error: { code: "rate_limited" } }, { status: 429, headers: { "retry-after": retry } });
    }
    if (u.searchParams.has("updated_since")) {
      if (!fake.delta) return err(400, "invalid_request");
      const since = Date.parse(u.searchParams.get("updated_since")!);
      return page([...fake.appointments.values()].filter((a) => (fake.changedAt.get(a.appointment_id) ?? 0) >= since).sort((a, b) => a.appointment_id - b.appointment_id));
    }
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
    fake.appointmentListRetryAfter = fake.rateLimitAfterMove;
    fake.rateLimitAfterMove = null;
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
    beforeAll(async () => {
      vi.stubEnv("SMILE_CONNECT_WRITES", "on");
      // Estas pruebas cubren la confirmación dentro de la reserva (api_deferred = false). La diferida,
      // que es la de toda clínica nueva, está en «confirmación diferida» más abajo.
      await sql`update smile_connect_connections set api_deferred = false where clinic_id = ${clinicId}`;
    });

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
      await sql`insert into clinics (id, name, specialty, address, verify_appointment_access) values (${gm}, 'Guerra Mininni de prueba', 'Odontología', 'Dirección ficticia', true)`;
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

    it("un día que Smile Connect no confirma no se da por lleno: Sofi sabe cuál fue y vuelve a buscar", async () => {
      const [full, failing, free] = [41, 42, 43];
      const args = { clinic_id: gm, tipo_turno_id: gmConsult, profesional_id: gmPro };
      fake.blocks.push({ pro: 334, start: at(full, "00:00"), end: at(full + 1, "00:00") });
      fake.failDates.add(day(failing));
      try {
        // El único otro día buscado está lleno: no dice «no hay turnos», dice qué día no revisó.
        const none = await tool("consultar_disponibilidad", { ...args, desde: day(full), hasta: day(failing) });
        expect(none).toMatchObject({ ok: true, turnos: [], dias_sin_revisar: [day(failing)] });
        expect(none.mensaje).toContain(`desde=${day(failing)}`);
        expect(none.mensaje).not.toContain("No hay turnos libres");
        // Con lugar en otro día, ofrece ese y avisa del que no pudo revisar.
        const some = await tool("consultar_disponibilidad", { ...args, desde: day(failing), hasta: day(free) });
        const offered = some.turnos ?? [];
        expect(offered.length).toBeGreaterThan(0);
        for (const t of offered) expect(t.inicio >= at(free, "00:00")).toBe(true);
        expect(some).toMatchObject({ dias_sin_revisar: [day(failing)], aviso_agenda: expect.stringContaining(day(failing)) });
      } finally {
        fake.blocks.pop();
        fake.failDates.clear();
      }
    });

    it("a Smile Connect solo le pregunta por los días en que el profesional atiende", async () => {
      const offset = 45;
      const weekday = new Date(`${day(offset)}T12:00:00Z`).getUTCDay();
      await sql`delete from schedules where professional_id = ${gmPro} and weekday = ${weekday}`;
      try {
        fake.calls.length = 0;
        await tool("consultar_disponibilidad", { clinic_id: gm, tipo_turno_id: gmConsult, profesional_id: gmPro, desde: day(offset), hasta: day(offset + 1) });
        const asked = fake.calls.filter((c) => c.path === "/availability").length;
        expect(asked).toBe(1);
      } finally {
        await sql`insert into schedules (professional_id, weekday, start_time, end_time) values (${gmPro}, ${weekday}, '09:00', '18:00')`;
      }
    });

    it("verifica la hora exacta antes del límite de opciones y ofrece alternativas si Smile la ocupa", async () => {
      const offset = 37;
      const args = { clinic_id: gm, profesional_id: gmPro, desde: day(offset), hasta: day(offset) };
      const exact = { ...args, hora_exacta: "15:00" };
      const expectedSlot = { inicio: at(offset, "15:00"), profesional_id: gmPro };
      const general = await tool("consultar_disponibilidad", { ...args, tipo_turno_id: gmConsult });
      expect(general.turnos).toHaveLength(2);
      expect(general.turnos).not.toContainEqual(expect.objectContaining(expectedSlot));
      expect(await tool("consultar_disponibilidad", { ...exact, tipo_turno_id: gmConsult })).toMatchObject({
        ok: true, hora_solicitada: { hora: "15:00", disponible: true }, turnos: [expect.objectContaining(expectedSlot)],
      });

      await link.setSmileMode(gm, "completa");
      const booking = await book(offset);
      await push.pushPendingSmile(gm, booking.turno_id);
      const move = { ...exact, turno_id: booking.turno_id };
      expect(await tool("consultar_disponibilidad", move)).toMatchObject({
        ok: true, hora_solicitada: { hora: "15:00", disponible: true }, turnos: [expect.objectContaining(expectedSlot)],
      });

      fake.appointments.set(80537, scAppt(80537, 5002, offset, "15:00", "15:30"));
      try {
        const unavailable = await tool("consultar_disponibilidad", move);
        expect(unavailable).toMatchObject({ ok: true, hora_solicitada: { hora: "15:00", disponible: false } });
        expect(unavailable.turnos).toHaveLength(2);
        expect(unavailable.turnos).not.toContainEqual(expect.objectContaining(expectedSlot));
        expect(await smileSync(booking.turno_id!)).toMatchObject({ status: "confirmado" });
      } finally {
        fake.appointments.delete(80537);
        await tool("cancelar_turno", { clinic_id: gm, turno_id: booking.turno_id });
        await push.pushPendingSmile(gm, booking.turno_id);
        await send();
        fake.whatsapps.length = 0;
        await link.setSmileMode(gm, "crear");
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

    it("en «Crear, mover y cancelar» Sofi cancela en Smile Connect, pero las visitas combinadas van a recepción", async () => {
      await link.setSmileMode(gm, "completa");
      const booking = await book(26);
      await push.pushPendingSmile(gm, booking.turno_id);
      await send();
      const [first] = await sql`select * from appointments where id = ${booking.turno_id!}`;
      // Otra práctica de la misma visita, justo a continuación.
      const [{ id: second }] = await sql`
        insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, source)
        values (${gm}, ${first.patient_id}, ${gmPro}, ${gmConsult}, ${first.ends_at}, ${new Date(Date.parse(first.ends_at) + 30 * 60_000)}, 'confirmado', 'whatsapp')
        returning id`;
      const tasks = async () => (await sql`select count(*)::int as n from tasks where clinic_id = ${gm} and title = 'Revisar turno en Smile Connect'`)[0].n;
      const before = await tasks();
      expect(await tool("cancelar_turno", { clinic_id: gm, turno_id: booking.turno_id, motivo: "No puedo" })).toMatchObject({ ok: false, pendiente_recepcion: true });
      expect(await tool("cancelar_turno", { clinic_id: gm, turno_id: second, motivo: "No puedo" })).toMatchObject({ ok: false, pendiente_recepcion: true });
      expect(await tasks()).toBe(before + 2);
      expect((await sql`select smile_management from appointments where id = ${booking.turno_id!}`)[0].smile_management).toBeNull();
      // Sin la otra práctica, es un turno simple: lo cancela Sofi, verificando en Smile Connect.
      await sql`delete from appointments where id = ${second}`;
      expect(await tool("cancelar_turno", { clinic_id: gm, turno_id: booking.turno_id, motivo: "No puedo" })).toMatchObject({ ok: false, pendiente_confirmacion: true });
      expect(await push.pushPendingSmile(gm, booking.turno_id)).toMatchObject({ ok: 1 });
      expect(await smileSync(booking.turno_id!)).toMatchObject({ status: "cancelado" });
      await send();
    });

    it("retoma una reprogramación tras el límite de Smile y avisa una sola vez en la corrida de calendario", async () => {
      await link.setSmileMode(gm, "completa");
      const booking = await book(38);
      await push.pushPendingSmile(gm, booking.turno_id);
      await send();
      fake.whatsapps.length = 0;
      fake.calls.length = 0;
      const before = await smileSync(booking.turno_id!);
      const remoteId = Number(before.external_id.slice(3));
      const move = { clinic_id: gm, turno_id: booking.turno_id, nuevo_inicio: at(38, "15:00"), profesional_id: gmPro };
      expect(await tool("reprogramar_turno", move)).toMatchObject({ pendiente_confirmacion: true });

      fake.rateLimitAfterMove = "47";
      const started = Date.now();
      const limited = await push.pushPendingSmile(gm, booking.turno_id);
      expect(limited).toMatchObject({ reintentar_en: expect.any(String), revisar: 0, error: 0 });
      expect(Date.parse(String(limited.reintentar_en))).toBeGreaterThanOrEqual(started + 47_000);
      expect(fake.appointments.get(remoteId)?.start_date).toBe(move.nuevo_inicio);
      const [pending] = await sql`select status, smile_sync, smile_attempts, smile_management from appointments where id = ${booking.turno_id!}`;
      expect(pending).toMatchObject({
        status: "confirmado", smile_sync: "pendiente", smile_attempts: 0,
        smile_management: { operation: "mover", startsAt: move.nuevo_inicio },
      });
      const callsBeforeRetry = fake.calls.length;
      await Promise.all([
        push.pushPendingSmile(gm, booking.turno_id),
        push.pushPendingSmile(gm),
        link.runSmileConnect(),
      ]);
      expect(fake.calls).toHaveLength(callsBeforeRetry);
      expect(fake.whatsapps).toHaveLength(0);

      await sql`update smile_connect_connections set api_retry_at = now() - interval '1 second',
        api_near_pull_at = now(), api_wide_pull_at = now(), api_backup_at = now() where clinic_id = ${gm}`;
      const { POST } = await import("@/app/api/automations/[job]/route");
      const runCalendar = () => POST(new Request("https://turnia.test/api/automations/calendario", {
        method: "POST",
        headers: { "x-turnia-secret": secret },
      }), { params: Promise.resolve({ job: "calendario" }) });
      expect((await runCalendar()).status).toBe(200);
      expect((await runCalendar()).status).toBe(200);
      const [moved] = await sql`select id, starts_at, status from appointments where clinic_id = ${gm} and external_id = ${before.external_id}`;
      expect(moved).toMatchObject({ starts_at: move.nuevo_inicio, status: "confirmado" });
      expect(await smileSync(booking.turno_id!)).toMatchObject({ status: "reprogramado", external_id: null });
      expect(writes().map((w) => [w.method, w.path])).toEqual([["PATCH", `/appointments/${remoteId}`]]);
      expect(fake.whatsapps.map((w) => w.text)).toEqual([expect.stringContaining("Reprogramación confirmada")]);

      await tool("cancelar_turno", { clinic_id: gm, turno_id: moved.id });
      await push.pushPendingSmile(gm, moved.id);
      await send();
      fake.whatsapps.length = 0;
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

    it("retoma la automatización después de una sincronización manual exitosa", async () => {
      const actions = await import("@/app/panel/smile-api-actions");
      mocks.cookies.set("turnia_clinic", gm);
      const retryAt = new Date(Date.now() + 60 * 60_000).toISOString();
      const f = new FormData();
      f.set("clinic_id", gm);
      await sql`update smile_connect_connections set api_retry_at = ${retryAt}, api_near_pull_at = null where clinic_id = ${gm}`;

      fake.status = 503;
      try {
        expect(await actions.syncSmileNowAction({}, f)).toMatchObject({ ok: false, message: expect.stringContaining("503") });
        expect(await link.getSmileApiConnection(gm)).toMatchObject({ api_retry_at: retryAt });
      } finally {
        fake.status = 200;
      }
      // La misma sincronización puede volver a probar bloqueos con la clave vigente: no exige renovarla.
      await sql`update smile_connect_connections set api_events_ok = false, api_events_status = 403, api_events_checked_at = now() where clinic_id = ${gm}`;
      fake.eventsScope = true;
      try {
        const synced = await actions.syncSmileNowAction({}, f);
        expect(synced, synced.message).toMatchObject({ ok: true });
        expect(await link.getSmileApiConnection(gm)).toMatchObject({ api_retry_at: null, api_events_ok: true, api_events_status: 200 });
      } finally {
        fake.eventsScope = false;
      }

      const later = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
      await sql`update smile_connect_connections set api_retry_at = ${later} where clinic_id = ${gm}`;
      await link.clearSmileRetryAfterSync(gm, retryAt);
      expect(await link.getSmileApiConnection(gm)).toMatchObject({ api_retry_at: later });
    });
  });

  describe("Smile Connect como fuente de la verdad", () => {
    let T: string, emilia: string, mariano: string;

    beforeAll(async () => {
      [{ id: T }] = await sql`insert into clinics (name, specialty, is_demo, retained_at) values ('Consultorio espejo de prueba', 'Odontología', true, now()) returning id`;
      [{ id: emilia }] = await sql`insert into professionals (clinic_id, full_name, specialty) values (${T}, 'Dra. Emilia Ficticia', 'Odontología') returning id`;
      [{ id: mariano }] = await sql`insert into professionals (clinic_id, full_name, specialty) values (${T}, 'Dr. Mariano Prueba', 'Odontología') returning id`;
      await sql`insert into schedules (professional_id, weekday, start_time, end_time, urgent_only)
        values (${emilia}, 1, '10:00', '12:00', false), (${emilia}, 2, '08:00', '09:00', true)`;
      await sql`insert into appointment_types (clinic_id, name, specialty, duration_min) values (${T}, 'Consulta', 'Odontología', 30)`;
      await link.saveSmileApiKey(T, KEY);
      await link.setSmileMode(T, "lectura");
    });

    it("copia el horario de Smile Connect a quien ya atiende en Turnia, sin tocar las franjas especiales", async () => {
      const linked = await sql`select full_name, smile_professional_id from professionals where clinic_id = ${T} order by smile_professional_id`;
      expect(linked.map((p) => [p.full_name, p.smile_professional_id])).toEqual([["Dr. Mariano Prueba", 334], ["Dra. Emilia Ficticia", 335]]);
      fake.hours.set(335, { "1": cells("10:00", "17:30"), "2": [...cells("10:00", "11:00"), ...cells("14:00", "15:00")] });
      const r = await link.syncSmileHours(T);
      expect(r.cambiados).toEqual(["Dra. Emilia Ficticia: antes lun 10:00–12:00; ahora lun 10:00–17:30, mar 10:00–11:00, mar 14:00–15:00."]);
      // Mariano atiende en Smile Connect, pero en Turnia no tiene horarios: no se habilita solo, queda para revisar.
      expect(r.revisar).toEqual([expect.stringContaining("Dr. Mariano Prueba: atiende en Smile Connect")]);
      const rows = await sql`select weekday, start_time::text as s, end_time::text as e, urgent_only from schedules where professional_id = ${emilia} order by weekday, start_time`;
      expect(rows.map((x) => [x.weekday, x.s.slice(0, 5), x.e.slice(0, 5), x.urgent_only])).toEqual([
        [1, "10:00", "17:30", false], [2, "08:00", "09:00", true], [2, "10:00", "11:00", false], [2, "14:00", "15:00", false],
      ]);
      expect((await sql`select count(*)::int as n from schedules where professional_id = ${mariano}`)[0].n).toBe(0);
      // Sin cambios en Smile Connect no toca nada y sigue mostrando el último cambio.
      expect((await link.syncSmileHours(T)).cambiados).toEqual([]);
      expect((await link.getSmileApiConnection(T))!.api_hours_note).toMatch(/^Horarios copiados de Smile Connect el .*Emilia/);
      // Si Smile Connect no devuelve horario para alguien, no se le borra nada.
      fake.hours.set(335, {});
      expect((await link.syncSmileHours(T)).cambiados).toEqual([]);
      expect((await sql`select count(*)::int as n from schedules where professional_id = ${emilia} and not urgent_only`)[0].n).toBe(3);
      fake.hours.set(335, { "1": cells("10:00", "17:30"), "2": [...cells("10:00", "11:00"), ...cells("14:00", "15:00")] });
      // Cada 6 horas también se revisa si la API ya acepta el motivo del turno (sin esperar a la copia diaria).
      fake.notes = true;
      try {
        await link.syncSmileHours(T);
        expect((await link.getSmileApiConnection(T))!.api_supports_notes).toBe(true);
      } finally {
        fake.notes = false;
      }
      await link.syncSmileHours(T);
      expect((await link.getSmileApiConnection(T))!.api_supports_notes).toBe(false);
    });

    it("sin el permiso events:read no toca los bloqueos ni avisa a nadie; con el permiso los trae de Smile Connect", async () => {
      await sql`insert into schedule_blocks (clinic_id, professional_id, starts_at, ends_at, reason, external_id)
        values (${T}, ${emilia}, ${at(2, "15:00")}, ${at(2, "16:00")}, 'Bloqueo viejo', 'sc:499')`;
      fake.events = [
        { event_id: 501, type: "vacation", name: "Vacaciones", start_date: at(2, "09:00"), end_date: at(2, "13:00"), professional_id: 335, box_id: null, notes: null },
        // De un profesional que Smile Connect ya no lista: en Turnia sería un bloqueo de toda la clínica.
        { event_id: 502, type: "other", name: "Ya no está", start_date: at(3, "09:00"), end_date: at(3, "10:00"), professional_id: 999, box_id: null, notes: null },
      ];
      const blocks = async () => (await sql`select external_id, professional_id, reason from schedule_blocks where clinic_id = ${T} order by external_id`)
        .map((b) => [b.external_id, b.professional_id, b.reason]);
      await link.pullSmileConnect(T, "cerca");
      expect(await link.getSmileApiConnection(T)).toMatchObject({ api_events_ok: false, api_error: null });
      expect(await blocks()).toEqual([["sc:499", emilia, "Bloqueo viejo"]]);
      expect((await sql`select count(*)::int as n from clinic_notices where clinic_id = ${T}`)[0].n).toBe(0);
      // Le suman el permiso a la clave: se vuelve a probar al día siguiente.
      fake.eventsScope = true;
      await link.pullSmileConnect(T, "cerca");
      expect(await blocks()).toEqual([["sc:499", emilia, "Bloqueo viejo"]]);
      await sql`update smile_connect_connections set api_events_checked_at = now() - interval '25 hours' where clinic_id = ${T}`;
      await link.pullSmileConnect(T, "cerca");
      expect(await blocks()).toEqual([["sc:501", emilia, "Vacaciones"]]);
      expect((await link.getSmileApiConnection(T))!.api_events_ok).toBe(true);
      fake.eventsScope = false;
      fake.events = [];
    });

    it("un 404 de la ruta de bloqueos no se diagnostica como falta de permisos ni borra bloqueos", async () => {
      const before = await sql`select external_id from schedule_blocks where clinic_id = ${T} order by external_id`;
      fake.eventsStatus = 404;
      fake.eventsScope = true;
      await sql`update smile_connect_connections set api_events_ok = null, api_events_checked_at = null where clinic_id = ${T}`;
      try {
        await link.pullSmileConnect(T, "cerca");
        expect(await link.getSmileApiConnection(T)).toMatchObject({ api_events_ok: null, api_events_status: 404 });
        expect(await sql`select external_id from schedule_blocks where clinic_id = ${T} order by external_id`).toEqual(before);
      } finally {
        fake.eventsStatus = 200;
        fake.eventsScope = false;
        await sql`update smile_connect_connections set api_events_ok = null, api_events_checked_at = null where clinic_id = ${T}`;
      }
    });

    it("puede volver a verificar bloqueos con la misma clave aunque el rechazo anterior sea reciente", async () => {
      const before = (await link.getSmileApiConnection(T))!.api_key_hint;
      await sql`update smile_connect_connections set api_events_ok = false, api_events_status = 403, api_events_checked_at = now() where clinic_id = ${T}`;
      fake.eventsScope = true;
      fake.calls.length = 0;
      try {
        await link.pullSmileConnect(T, "cerca", new Date(), { recheckEvents: true });
        expect(fake.calls.some((c) => c.path === "/events")).toBe(true);
        expect(await link.getSmileApiConnection(T)).toMatchObject({ api_events_ok: true, api_events_status: 200, api_key_hint: before });
      } finally {
        fake.eventsScope = false;
        await sql`update smile_connect_connections set api_events_ok = null, api_events_checked_at = null where clinic_id = ${T}`;
      }
    });

    it("las notas y la prestación de Smile Connect llegan al turno de Turnia", async () => {
      fake.appointments.set(95010, scAppt(95010, 5002, 3, "15:00", "15:30", { professional_ids: [335], box_id: 190, notes: "Control de brackets", service_id: 12 }));
      await link.pullSmileConnect(T, "cerca");
      const [a] = await sql`select notes, professional_id from appointments where clinic_id = ${T} and external_id = 'sc:95010'`;
      expect(a).toMatchObject({ notes: expect.stringContaining("Limpieza · Control de brackets"), professional_id: emilia });

      // Un turno que dio Sofi y recepción copió en Smile Connect con sus propias notas: el motivo del
      // paciente (que usa el resumen de las 10) no se pisa, ni al vincularlo ni en las vueltas siguientes.
      const [{ patient_id: pedro }] = await sql`select patient_id from patient_external_ids where clinic_id = ${T} and external_id = 'sc:5002'`;
      const [{ id: sofi }] = await sql`
        insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, source, notes)
        select ${T}, ${pedro}, ${emilia}, id, ${at(3, "16:00")}, ${at(3, "16:30")}, 'confirmado', 'whatsapp', 'Le duele una muela'
        from appointment_types where clinic_id = ${T} and name = 'Consulta' returning id`;
      fake.appointments.set(95011, scAppt(95011, 5002, 3, "16:00", "16:30", { professional_ids: [335], box_id: 190, notes: "Consulta" }));
      await link.pullSmileConnect(T, "cerca");
      await link.pullSmileConnect(T, "cerca");
      expect((await sql`select external_id, notes from appointments where id = ${sofi}`)[0]).toEqual({ external_id: "sc:95011", notes: "Le duele una muela" });
      fake.appointments.delete(95011);
      await sql`update appointments set status = 'cancelado' where id = ${sofi}`;
    });

    it("un turno que recepción movió fuera de la ventana no se da de baja: se pregunta por él y se actualiza", async () => {
      const row = async (ext: string) => (await sql`select status, starts_at from appointments where clinic_id = ${T} and external_id = ${ext}`)[0];
      fake.appointments.set(95030, scAppt(95030, 5002, 2, "10:00", "10:30", { professional_ids: [335] }));
      fake.appointments.set(95031, scAppt(95031, 5002, 2, "11:00", "11:30", { professional_ids: [335] }));
      await link.pullSmileConnect(T, "cerca");
      expect((await row("sc:95030")).status).toBe("confirmado");
      // 95030 pasa a la semana siguiente (fuera de la ventana cercana); 95031 se borra de verdad.
      fake.appointments.set(95030, { ...fake.appointments.get(95030)!, start_date: at(10, "10:00"), end_date: at(10, "10:30") });
      fake.appointments.delete(95031);
      fake.calls.length = 0;
      await link.pullSmileConnect(T, "cerca");
      const moved = await row("sc:95030");
      expect(moved.status).toBe("confirmado");
      expect(new Date(moved.starts_at).toISOString()).toBe(at(10, "10:00"));
      expect((await row("sc:95031")).status).toBe("cancelado");
      expect(fake.calls.filter((c) => /^\/appointments\/\d+$/.test(c.path)).map((c) => c.path).sort()).toEqual(["/appointments/95030", "/appointments/95031"]);
      fake.appointments.delete(95030);
      await sql`update appointments set status = 'cancelado' where clinic_id = ${T} and external_id = 'sc:95030'`;
    });

    it("la copia diaria pasa a Turnia la asistencia cargada tarde, los turnos lejanos y lo que cambió de cada paciente", async () => {
      const [pedro] = await sql`select patient_id from patient_external_ids where clinic_id = ${T} and external_id = 'sc:5002'`;
      // Un turno de hace 10 días que Turnia trajo sin marca: recepción lo marcó como ausente días después.
      fake.appointments.set(95020, scAppt(95020, 5002, -10, "10:00", "10:30", { professional_ids: [335], attendance: "Did not attend" }));
      await sql`
        insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, source, external_id)
        select ${T}, ${pedro.patient_id}, ${emilia}, id, ${at(-10, "10:00")}, ${at(-10, "10:30")}, 'confirmado', 'smile_connect', 'sc:95020'
        from appointment_types where clinic_id = ${T} and name = 'Consulta'`;
      // Un turno a 90 días (fuera de la sincronización frecuente) y una paciente nueva sin turnos.
      fake.appointments.set(95021, scAppt(95021, 5002, 90, "10:00", "10:30", { professional_ids: [335] }));
      fake.patients.set(5003, { patient_id: 5003, name: "Lucía", surname: "Nueva", id_number: "30111444", email: null, phone_country_code: "AR", phone_number: "1100006011" });
      // Lo que Sofi sabe de Juana (su WhatsApp) no se pisa con el dato viejo de Smile Connect la primera vez.
      await link.pullSmileConnect(T, "cerca");
      const status = async (ext: string) => (await sql`select status from appointments where clinic_id = ${T} and external_id = ${ext}`)[0]?.status;

      await link.backupSmileConnect(T);
      const first = await link.mirrorSmileBackup(T);
      expect(first.pacientes).toMatchObject({ actualizados: 0 });
      expect(await status("sc:95020")).toBe("ausente");
      expect(await status("sc:95021")).toBe("confirmado");
      const [lucia] = await sql`select p.full_name, p.dni from patient_external_ids x join patients p on p.id = x.patient_id where x.clinic_id = ${T} and x.external_id = 'sc:5003'`;
      expect(lucia).toEqual({ full_name: "Lucía Nueva", dni: "30111444" });

      // Recepción le cambia el apellido y el celular a Pedro en Smile Connect.
      const [before] = await sql`select full_name, phone from patients where id = ${pedro.patient_id}`;
      const saved = fake.patients.get(5002)!;
      fake.patients.set(5002, { ...saved, surname: "Inventado Gómez", phone_number: "1100006012" });
      // Los cambios de los pacientes que ya existían llegan con la lista completa (dos veces por semana).
      await sql`update smile_connect_connections set api_patients_full_at = now() - interval '4 days' where clinic_id = ${T}`;
      await link.backupSmileConnect(T);
      const second = await link.mirrorSmileBackup(T);
      expect(second.pacientes).toMatchObject({ actualizados: 1 });
      const [after] = await sql`select full_name, phone from patients where id = ${pedro.patient_id}`;
      expect(after).toEqual({ full_name: "Pedro Inventado Gómez", phone: before.phone.replace(/6009$/, "6012") });
      // El celular anterior lo sigue identificando cuando escribe.
      expect((await sql`select patient_id from patient_phones where clinic_id = ${T} and phone = ${before.phone}`)[0]?.patient_id).toBe(pedro.patient_id);
      expect((await link.getSmileApiConnection(T))!.api_mirror_at).not.toBeNull();

      fake.patients.set(5002, saved);
      fake.patients.delete(5003);
      fake.appointments.delete(95010);
      fake.appointments.delete(95020);
      fake.appointments.delete(95021);
    });

    it("la copia lee todos los días solo los pacientes nuevos y la lista completa dos veces por semana", async () => {
      await sql`update smile_connect_connections set api_patients_full_at = null, api_patients_last_id = null where clinic_id = ${T}`;
      const first = await link.backupSmileConnect(T);
      expect(first).toMatchObject({ completa: true, pacientes: fake.patients.size });
      const lastId = Math.max(...fake.patients.keys());
      expect((await link.getSmileApiConnection(T))!.api_patients_last_id).toBe(lastId);
      // Al día siguiente: un paciente nuevo en Smile Connect. Se lee solo ese (la API pagina por id).
      fake.patients.set(lastId + 1, { patient_id: lastId + 1, name: "Nora", surname: "Reciente", id_number: "30111555", email: null, phone_country_code: "AR", phone_number: "1100006013" });
      fake.calls.length = 0;
      const next = await link.backupSmileConnect(T);
      expect(next).toMatchObject({ completa: false, pacientes: 1 });
      expect(fake.calls.filter((c) => c.path === "/patients")).toHaveLength(1);
      const [row] = await sql`select patients_full, jsonb_array_length(patients) as n from smile_connect_backups where clinic_id = ${T} order by taken_at desc limit 1`;
      expect(row).toEqual({ patients_full: false, n: 1 });
      // Se aplica a Turnia como cualquier copia.
      await link.mirrorSmileBackup(T);
      expect((await sql`select count(*)::int as n from patient_external_ids where clinic_id = ${T} and external_id = ${`sc:${lastId + 1}`}`)[0].n).toBe(1);
      // Pasados tres días y medio, vuelve la lista completa.
      await sql`update smile_connect_connections set api_patients_full_at = now() - interval '85 hours' where clinic_id = ${T}`;
      expect(await link.backupSmileConnect(T)).toMatchObject({ completa: true, pacientes: fake.patients.size });
      fake.patients.delete(lastId + 1);
    });

    it("a Axel le llegan por WhatsApp los problemas de la integración, una vez cada uno", async () => {
      const keys = async () => (await sql`select key from channel_events where key like ${`smile-axel:%:${T}`} order by key`).map((r) => r.key.split(":")[1]);
      await sql`delete from channel_events where key like ${`smile-axel:%:${T}`}`;
      mocks.axel.length = 0;
      // Un profesional vinculado que Smile Connect ya no lista: queda para revisar y llega una vez.
      const [{ id: gone }] = await sql`insert into professionals (clinic_id, full_name, specialty, smile_professional_id) values (${T}, 'Dra. Ya No Está', 'Odontología', 999) returning id`;
      expect((await link.syncSmileHours(T)).revisar).toContain("Dra. Ya No Está ya no figura en Smile Connect. Si dejó de atender, desactivalo en Turnia (Equipo y horarios).");
      // La agenda lleva más de 3 horas sin sincronizarse, y la clave no tiene el permiso de bloqueos.
      await sql`update smile_connect_connections set api_near_pull_at = now() - interval '4 hours', api_checked_at = now() - interval '2 days',
        api_backup_at = now(), api_events_ok = false, api_error = 'Smile Connect respondió 503.' where clinic_id = ${T}`;
      const sent = await link.checkSmileHealth(T);
      // Horarios: el último cambio copiado (informativo) y los dos para revisar.
      expect(sent.sort()).toEqual(["agenda", "bloqueos", "horarios", "horarios", "horarios"]);
      expect(mocks.axel.filter((t) => t.startsWith("ℹ️") && t.includes("Horarios copiados de Smile Connect"))).toHaveLength(1);
      expect(mocks.axel.find((t) => t.includes("la agenda no se sincroniza"))).toContain("Smile Connect respondió 503.");
      expect(mocks.axel.some((t) => t.includes("Dra. Ya No Está ya no figura en Smile Connect"))).toBe(true);
      expect(mocks.axel.some((t) => t.includes("Dr. Mariano Prueba: atiende en Smile Connect"))).toBe(true);
      expect(mocks.axel.some((t) => t.includes("events:read"))).toBe(true);
      // En la vuelta siguiente, el mismo problema no se repite.
      expect(await link.checkSmileHealth(T)).toEqual([]);
      // Si el WhatsApp no sale (la línea de Turnia pausada), se reintenta una vez por hora, no en cada vuelta.
      mocks.axelOk = false;
      await sql`update smile_connect_connections set api_writes_paused = 'Se frenó la escritura: más de 15 cambios en una hora.' where clinic_id = ${T}`;
      expect(await link.checkSmileHealth(T)).toEqual([]);
      mocks.axelOk = true;
      expect(await link.checkSmileHealth(T)).toEqual([]);
      await sql`delete from channel_events where key like ${`smile-axel:escritura:%:${T}:fallo:%`}`;
      expect(await link.checkSmileHealth(T)).toEqual(["escritura"]);
      // A los 6 meses de cargada, se recuerda renovar la clave (una vez por clave).
      await sql`update smile_connect_connections set api_key_saved_at = now() - interval '181 days' where clinic_id = ${T}`;
      expect(await link.checkSmileHealth(T)).toEqual(["clave-vieja"]);
      expect(await link.checkSmileHealth(T)).toEqual([]);
      await sql`update smile_connect_connections set api_key_saved_at = now() where clinic_id = ${T}`;
      // La clave rechazada también le llega a Axel (además de al consultorio).
      mocks.axel.length = 0;
      await link.alertSmileKeyProblem(T, new (await import("@/lib/smile-connect-api")).SmileApiError("revocada", 401));
      expect(mocks.axel).toEqual([expect.stringContaining("no acepta la clave")]);
      expect(await keys()).toContain("escritura");

      await sql`update smile_connect_connections set api_near_pull_at = now(), api_error = null, api_writes_paused = null, api_events_ok = null where clinic_id = ${T}`;
      await sql`delete from professionals where id = ${gone}`;
    });

    it("cuando Smile Connect sume updated_since, trae cada 10 minutos solo lo que cambió (también fuera de las ventanas)", async () => {
      // Hoy la API no lo tiene: no se usa.
      expect((await link.getSmileApiConnection(T))!.api_supports_delta).toBe(false);
      fake.delta = true;
      try {
        await link.saveSmileApiKey(T, KEY);
        await link.setSmileMode(T, "lectura");
        expect((await link.getSmileApiConnection(T))!.api_supports_delta).toBe(true);
        const [{ patient_id: pedro }] = await sql`select patient_id from patient_external_ids where clinic_id = ${T} and external_id = 'sc:5002'`;
        // Un turno de hace 3 días (fuera de la ventana cercana) al que recepción le marcó la ausencia recién.
        fake.appointments.set(95040, scAppt(95040, 5002, -3, "10:00", "10:30", { professional_ids: [335], attendance: "Did not attend" }));
        await sql`
          insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, source, external_id)
          select ${T}, ${pedro}, ${emilia}, id, ${at(-3, "10:00")}, ${at(-3, "10:30")}, 'confirmado', 'smile_connect', 'sc:95040'
          from appointment_types where clinic_id = ${T} and name = 'Consulta'`;
        fake.changedAt.set(95040, Date.now());
        // Y a Pedro le corrigen el apellido (ya se lo había visto antes en Smile Connect).
        const saved = fake.patients.get(5002)!;
        fake.patients.set(5002, { ...saved, surname: "Inventado Ruiz" });
        fake.patientChangedAt.set(5002, Date.now());
        fake.calls.length = 0;
        const r = await link.pullSmileChanges(T);
        expect(r).toMatchObject({ leidos: 1, pendientes: 0, pacientes_cambiados: 1 });
        expect((await link.getSmileApiConnection(T))!.api_delta_at).not.toBeNull();
        expect((await sql`select status from appointments where clinic_id = ${T} and external_id = 'sc:95040'`)[0].status).toBe("ausente");
        expect((await sql`select full_name from patients where id = ${pedro}`)[0].full_name).toBe("Pedro Inventado Ruiz");
        // Páginas chicas: casi siempre son pocos cambios y el cupo cuenta el tamaño de página pedido.
        expect(fake.calls.filter((c) => c.path === "/appointments" || c.path === "/patients").length).toBe(2);
        // La marca de agua avanzó: lo mismo no se vuelve a traer.
        await sql`update smile_connect_connections set api_delta_at = now() + interval '5 minutes' where clinic_id = ${T}`;
        expect(await link.pullSmileChanges(T)).toMatchObject({ leidos: 0, pacientes_cambiados: 0 });
        // En la vuelta automática corre «cambios» y la ventana cercana pasa a ser una conciliación cada 3 horas.
        await sql`update smile_connect_connections set api_delta_at = now() - interval '20 minutes', api_near_pull_at = now() - interval '40 minutes',
          api_wide_pull_at = now(), api_hours_at = now() where clinic_id = ${T}`;
        const run = (await link.runSmileConnect())[T] as Record<string, unknown>;
        expect(run).not.toHaveProperty("cerca");
        expect(run).not.toHaveProperty("error_cambios");
        fake.patients.set(5002, saved);
        fake.appointments.delete(95040);
      } finally {
        fake.delta = false;
        fake.changedAt.clear();
        fake.patientChangedAt.clear();
        await sql`update smile_connect_connections set api_supports_delta = false, api_delta_at = null where clinic_id = ${T}`;
      }
    });

    it("la vuelta automática aplica la copia una sola vez y copia los horarios cada 6 horas", async () => {
      await link.backupSmileConnect(T);
      await sql`update smile_connect_connections set api_hours_at = now() - interval '7 hours', api_near_pull_at = now(), api_wide_pull_at = now() where clinic_id = ${T}`;
      const first = (await link.runSmileConnect())[T] as Record<string, unknown>;
      expect(first).toHaveProperty("horarios");
      expect(first).toHaveProperty("espejo");
      const again = (await link.runSmileConnect())[T] as Record<string, unknown>;
      expect(again).not.toHaveProperty("horarios");
      expect(again).not.toHaveProperty("espejo");
      // Cada paso queda en el historial, con lo que tardó y lo que gastó del cupo.
      const runs = await link.recentSmileRuns(T, 50);
      expect(runs.filter((r) => r.kind === "espejo" || r.kind === "horarios").map((r) => [r.kind, r.ok])).toEqual(
        expect.arrayContaining([["espejo", true], ["horarios", true]]),
      );
      expect(runs.every((r) => r.duration_ms >= 0 && r.reads >= 0)).toBe(true);
      // Una clave nueva puede traer el permiso de bloqueos: se vuelve a probar enseguida, sin esperar un día.
      await sql`update smile_connect_connections set api_events_ok = false, api_events_checked_at = now() where clinic_id = ${T}`;
      await link.saveSmileApiKey(T, KEY);
      expect(await link.getSmileApiConnection(T)).toMatchObject({ api_events_ok: null, api_events_checked_at: null });
      await link.setSmileMode(T, "lectura");
    });

    it("sincroniza cada 30 minutos solo en el horario de atención (con una hora de margen); fuera de él, cada 2 horas", async () => {
      const local = (y: number, m: number, d: number, h: number, min = 0) => zonedTimeToUtc(y, m, d, h, min, TZ);
      // El lunes Emilia atiende de 10 a 17:30: de 9 a 18:30 cuenta como horario de atención.
      expect(await link.inAttentionHours(T, local(2026, 11, 23, 11), TZ)).toBe(true);
      expect(await link.inAttentionHours(T, local(2026, 11, 23, 9, 30), TZ)).toBe(true);
      expect(await link.inAttentionHours(T, local(2026, 11, 23, 20), TZ)).toBe(false);
      // El sábado no atiende nadie.
      expect(await link.inAttentionHours(T, local(2026, 11, 21, 11), TZ)).toBe(false);
      // Sin horarios cargados, el criterio de antes (de 7 a 22).
      const [{ id: empty }] = await sql`insert into clinics (name, specialty) values ('Sin horarios', 'Odontología') returning id`;
      expect(await link.inAttentionHours(empty, local(2026, 11, 21, 12), TZ)).toBe(true);
      expect(await link.inAttentionHours(empty, local(2026, 11, 21, 23), TZ)).toBe(false);
      await sql`delete from clinics where id = ${empty}`;
    });
  });
});
