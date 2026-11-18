import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDaysKey, localDateKey, zonedTimeToUtc } from "@/lib/time";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// QA de la integración con Smile Connect para venderla a otras clínicas (18/11/2026), contra un Smile
// Connect SIMULADO (nunca el real; la Sofi de Guerra–Mininni está en producción). Cubre lo que no
// cubría smile-connect-api.integration.test.ts:
// - una clínica que NO es Guerra–Mininni recibe el mismo flujo (confirmación diferida, mover y cancelar verificados);
// - familias que comparten celular y DNI repetidos en Smile Connect;
// - el cupo diario de lecturas (con reserva para confirmar turnos) y el aviso si rechaza la clave;
// - el consultorio por defecto, la zona horaria y una ventana de sincronización incompleta.
// Datos ficticios.

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
const API = "https://smile-qa.test/api/v1";
const KEY = "sc_live_00000000-0000-4000-8000-000000000001.clavedepruebaficticiaqa";
const day = (offset: number) => addDaysKey(localDateKey(new Date(), TZ), offset);
const at = (offset: number, hhmm: string) => {
  const [y, m, d] = day(offset).split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  return zonedTimeToUtc(y, m, d, h, min, TZ).toISOString();
};

// ── Smile Connect simulado (mismo contrato que el OpenAPI v1.0.0) ────────────
type Appt = { appointment_id: number; patient_id: number; start_date: string; end_date: string; box_id: number | null; professional_ids: number[]; attendance: string | null; cancelled: boolean };
type Pat = { patient_id: number; name: string; surname: string; id_number: string | null; email: string | null; phone_country_code: string | null; phone_number: string | null };
const fake = {
  appointments: new Map<number, Appt>(),
  patients: new Map<number, Pat>(),
  calls: [] as Array<{ method: string; path: string; body?: unknown }>,
  idem: new Map<string, unknown>(),
  nextAppt: 50000,
  nextPatient: 9000,
  unauthorized: false,
  timezone: TZ,
  pros: [{ professional_id: 501, name: "Laura", surname: "Ejemplo", box_id: null as number | null }],
  boxes: [{ box_id: 77, name: "Único consultorio" }],
};
const writes = () => fake.calls.filter((c) => c.method !== "GET");

function availability(date: string, duration: number, pro?: number) {
  const [y, m, d] = date.split("-").map(Number);
  const open = zonedTimeToUtc(y, m, d, 9, 0, TZ).getTime();
  const close = zonedTimeToUtc(y, m, d, 18, 0, TZ).getTime();
  const slots = [];
  for (const p of fake.pros.filter((x) => !pro || x.professional_id === pro)) {
    for (let s = open; s + duration * 60_000 <= close; s += duration * 60_000) {
      const e = s + duration * 60_000;
      const taken = [...fake.appointments.values()].some((a) => !a.cancelled && a.professional_ids.includes(p.professional_id) && Date.parse(a.start_date) < e && Date.parse(a.end_date) > s);
      if (!taken) slots.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString(), professionalId: p.professional_id });
    }
  }
  return slots;
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!u.href.startsWith(API)) return new Response(JSON.stringify({ error: "fuera del test" }), { status: 404 });
  const method = init.method ?? "GET";
  const path = u.pathname.replace("/api/v1", "");
  const headers = new Headers(init.headers);
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  fake.calls.push({ method, path, body });
  const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const err = (status: number, code: string) => ok({ error: { code, message: code, request_id: "qa" } }, status);
  if (fake.unauthorized || headers.get("authorization") !== `Bearer ${KEY}`) return err(401, "unauthorized");
  const page = <T,>(rows: T[]) => {
    const limit = Number(u.searchParams.get("limit") ?? 50);
    const after = Number(u.searchParams.get("after") ?? 0);
    return ok({ data: rows.slice(after, after + limit), next_cursor: after + limit < rows.length ? after + limit : null });
  };
  const idem = headers.get("idempotency-key");
  if (idem && fake.idem.has(`${method}${path}${idem}`)) return ok({ data: fake.idem.get(`${method}${path}${idem}`), replayed: true }, 201);
  let m: RegExpExecArray | null;
  if (path === "/clinic") return ok({ data: { clinic_id: 4242, clinic_name: "Consultorio QA", timezone: fake.timezone } });
  if (path === "/professionals") return page(fake.pros);
  if (path === "/boxes") return page(fake.boxes);
  if (path === "/openapi") return ok({ paths: {} });
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
    if (!fake.patients.has(body.patient_id)) return err(400, "invalid_request");
    const a: Appt = { appointment_id: fake.nextAppt++, patient_id: body.patient_id, start_date: body.start_date, end_date: body.end_date, box_id: body.box_id, professional_ids: [body.professional_id], attendance: null, cancelled: false };
    fake.appointments.set(a.appointment_id, a);
    fake.idem.set(`${method}${path}${idem}`, { appointment_id: a.appointment_id });
    return ok({ data: { appointment_id: a.appointment_id }, replayed: false }, 201);
  }
  if ((m = /^\/appointments\/(\d+)$/.exec(path))) {
    const a = fake.appointments.get(Number(m[1]));
    if (!a) return err(404, "not_found");
    if (method === "GET") return ok({ data: a });
    Object.assign(a, { start_date: body.start_date, end_date: body.end_date, box_id: body.box_id, professional_ids: [body.professional_id] });
    return ok({ data: { appointment_id: a.appointment_id } });
  }
  if ((m = /^\/appointments\/(\d+)\/cancel$/.exec(path))) {
    const a = fake.appointments.get(Number(m[1]));
    if (!a) return err(404, "not_found");
    a.cancelled = true;
    return ok({ data: { appointment_id: a.appointment_id } });
  }
  return err(404, "not_found");
}

type Result = Record<string, unknown> & { ok: boolean; error?: string; turno_id?: string; pendiente_confirmacion?: boolean; pendiente_recepcion?: boolean };

describe.runIf(url)("QA de Smile Connect: lista para otras clínicas", () => {
  let sql: typeof import("@/lib/db").sql;
  let handler: typeof import("@/app/api/agent/tools/[name]/route").POST;
  let link: typeof import("@/lib/smile-connect-link");
  let push: typeof import("@/lib/smile-connect-push");
  let clinicId: string, pro: string, consult: string;

  async function tool(name: string, input: Record<string, unknown>, phone: string): Promise<Result> {
    const request = new Request(`https://turnia.test/api/agent/tools/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-turnia-secret": secret },
      body: JSON.stringify({ clinic_id: clinicId, patient_phone: phone, canal: "whatsapp", conversation_id: `conv-qa-${phone}`, ...input }),
    });
    return (await handler(request, { params: Promise.resolve({ name }) })).json();
  }
  const row = async (id: string) => (await sql`select status, smile_sync, smile_error, external_id from appointments where id = ${id}`)[0];
  const linkedPatient = async (phone: string) =>
    (await sql`select e.external_id from patient_external_ids e join patients p on p.id = e.patient_id where p.clinic_id = ${clinicId} and p.phone = ${phone} and e.external_id like 'sc:%'`)[0]?.external_id;

  beforeAll(async () => {
    const db = await scratchDatabase(url!, "turnia_smile_qa_test");
    await resetTestDatabase(db);
    for (const [k, v] of Object.entries({ DATABASE_URL: db, AGENT_TOOLS_SECRET: secret, SESSION_SECRET: "test-session", APP_URL: "https://turnia.test", SMILE_CONNECT_API_URL: API, SMILE_CONNECT_WRITES: "on" })) vi.stubEnv(k, v);
    vi.stubGlobal("fetch", fakeFetch);
    ({ sql } = await import("@/lib/db"));
    ({ POST: handler } = await import("@/app/api/agent/tools/[name]/route"));
    link = await import("@/lib/smile-connect-link");
    push = await import("@/lib/smile-connect-push");
    // Una clínica cualquiera (no Guerra–Mininni), con un solo consultorio en Smile Connect.
    [{ id: clinicId }] = await sql`insert into clinics (name, specialty, is_demo, retained_at, address) values ('Consultorio QA', 'Odontología', false, now(), 'Calle Ficticia 123') returning id`;
    [{ id: pro }] = await sql`insert into professionals (clinic_id, full_name, specialty) values (${clinicId}, 'Dra. Laura Ejemplo', 'Odontología') returning id`;
    await sql`insert into schedules (professional_id, weekday, start_time, end_time) select ${pro}::uuid, d, '09:00', '18:00' from generate_series(0, 6) d`;
    [{ id: consult }] = await sql`insert into appointment_types (clinic_id, name, specialty, duration_min) values (${clinicId}, 'Consulta', 'Odontología', 30) returning id`;
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

  it("al cargar la clave: un profesional sin consultorio usa el único que hay, y avisa si la zona horaria no coincide", async () => {
    const check = await link.saveSmileApiKey(clinicId, KEY);
    expect(check.professionals).toEqual([expect.objectContaining({ smileId: 501, box: "Único consultorio", turnia: "Dra. Laura Ejemplo" })]);
    expect((await sql`select smile_professional_id, smile_box_id from professionals where id = ${pro}`)[0]).toEqual({ smile_professional_id: 501, smile_box_id: 77 });
    expect(check.timezoneWarning).toBeNull();
    // Una clínica nueva arranca con la confirmación diferida, igual que Guerra–Mininni.
    expect((await link.getSmileApiConnection(clinicId))!.api_deferred).toBe(true);

    fake.timezone = "America/Santiago";
    try {
      expect((await link.saveSmileApiKey(clinicId, KEY)).timezoneWarning).toContain("America/Santiago");
    } finally {
      fake.timezone = TZ;
    }
  });

  it("otra clínica recibe el flujo de Guerra–Mininni: reserva diferida, mover y cancelar verificados en Smile Connect", async () => {
    await link.setSmileMode(clinicId, "completa");
    const phone = "5491100007001";
    fake.patients.set(8001, { patient_id: 8001, name: "Carla", surname: "Prueba", id_number: "31000111", email: null, phone_country_code: "54", phone_number: "1100007001" });
    await tool("registrar_paciente", { nombre_completo: "Carla Prueba", dni: "31000111", cobertura: "Particular" }, phone);

    // Sofi solo ofrece horarios verificados en esta consulta y toma el pedido sin confirmarlo todavía.
    const offers = await tool("consultar_disponibilidad", { tipo_turno_id: consult, profesional_id: pro, desde: day(3), hasta: day(3) }, phone);
    expect(offers).toMatchObject({ ok: true });
    const booked = await tool("reservar_turno", { tipo_turno_id: consult, profesional_id: pro, inicio: at(3, "10:00") }, phone);
    expect(booked).toMatchObject({ ok: false, pendiente_confirmacion: true });
    expect(await row(booked.turno_id!)).toMatchObject({ status: "pendiente" });

    // La cola lo crea en Smile Connect, lo verifica, lo confirma y le avisa al paciente por WhatsApp.
    expect(await push.pushPendingSmile(clinicId)).toMatchObject({ ok: 1 });
    const created = await row(booked.turno_id!);
    expect(created).toMatchObject({ status: "confirmado", smile_sync: "ok", external_id: expect.stringMatching(/^sc:\d+$/) });
    expect(fake.appointments.get(Number(created.external_id.slice(3)))).toMatchObject({ patient_id: 8001, box_id: 77, professional_ids: [501] });
    const [confirmation] = await sql`select phone, kind, body from clinic_notices where appointment_id = ${booked.turno_id!} and kind = 'smile_confirmado'`;
    expect(confirmation).toMatchObject({ phone, body: expect.stringContaining("Turno confirmado") });

    // Mover: se pide, se verifica en Smile Connect y recién ahí queda hecho (el mismo turno de allá).
    const scId = Number(created.external_id.slice(3));
    const moved = await tool("reprogramar_turno", { turno_id: booked.turno_id, nuevo_inicio: at(3, "15:00") }, phone);
    expect(moved).toMatchObject({ ok: false, pendiente_confirmacion: true });
    expect(await push.pushPendingSmile(clinicId)).toMatchObject({ ok: 1 });
    expect(fake.appointments.get(scId)).toMatchObject({ start_date: at(3, "15:00"), cancelled: false });
    const [after] = await sql`select id from appointments where replaced_by is null and external_id = ${`sc:${scId}`} and status = 'confirmado'`;
    expect(after).toBeDefined();

    // Cancelar: igual.
    const cancelled = await tool("cancelar_turno", { turno_id: after.id, motivo: "Viaja" }, phone);
    expect(cancelled).toMatchObject({ ok: false, pendiente_confirmacion: true });
    expect(await push.pushPendingSmile(clinicId)).toMatchObject({ ok: 1 });
    expect(fake.appointments.get(scId)!.cancelled).toBe(true);
    expect(await row(after.id)).toMatchObject({ status: "cancelado", smile_sync: "ok" });
  });

  it("familias: el celular compartido no alcanza para usar la ficha de otra persona", async () => {
    // En Smile Connect está la madre, sin el DNI del hijo, con el mismo celular.
    fake.patients.set(8101, { patient_id: 8101, name: "Ana", surname: "Familia", id_number: "20000111", email: null, phone_country_code: "54", phone_number: "1100007101" });
    const phone = "5491100007101";
    await tool("registrar_paciente", { nombre_completo: "Tomás Familia", dni: "45000111", cobertura: "Particular" }, phone);
    const booked = await tool("reservar_turno", { tipo_turno_id: consult, profesional_id: pro, inicio: at(4, "10:00") }, phone);
    expect(booked).toMatchObject({ pendiente_confirmacion: true });
    expect(await push.pushPendingSmile(clinicId)).toMatchObject({ ok: 1 });
    // Se creó la ficha del hijo: el turno no quedó a nombre de la madre.
    const linked = await linkedPatient(phone);
    expect(linked).not.toBe("sc:8101");
    const child = fake.patients.get(Number(linked.slice(3)))!;
    expect(child).toMatchObject({ name: "Tomás", surname: "Familia", id_number: "45000111" });
    const { external_id } = await row(booked.turno_id!);
    expect(fake.appointments.get(Number(external_id.slice(3)))!.patient_id).toBe(child.patient_id);

    // Pero si el nombre coincide (la misma persona, sin DNI en Turnia), se usa su ficha.
    const { samePersonName } = link;
    expect(samePersonName({ name: "Ana María", surname: "Familia" }, "Ana Familia")).toBe(true);
    expect(samePersonName({ name: "Ana", surname: "Familia" }, "Tomás Familia")).toBe(false);
    expect(samePersonName({ name: "Ana", surname: "Familia" }, null)).toBe(false);
  });

  it("DNI repetido en Smile Connect: no elige ni crea otra ficha, lo deja a recepción", async () => {
    for (const id of [8201, 8202]) {
      fake.patients.set(id, { patient_id: id, name: "Duplicada", surname: "Ficticia", id_number: "32000222", email: null, phone_country_code: "54", phone_number: null });
    }
    const phone = "5491100007201";
    await tool("registrar_paciente", { nombre_completo: "Duplicada Ficticia", dni: "32000222", cobertura: "Particular" }, phone);
    const before = fake.patients.size;
    const booked = await tool("reservar_turno", { tipo_turno_id: consult, profesional_id: pro, inicio: at(4, "11:00") }, phone);
    expect(booked).toMatchObject({ pendiente_confirmacion: true });
    fake.calls.length = 0;
    // El tercer intento sin resolver pasa a recepción (deriva con una tarea).
    for (let i = 0; i < 3; i++) await push.pushPendingSmile(clinicId);
    expect(fake.patients.size).toBe(before);
    expect(writes()).toEqual([]);
    expect(await row(booked.turno_id!)).toMatchObject({ smile_sync: "revisar", smile_error: expect.stringContaining("2 fichas con el DNI") });
    const [task] = await sql`select title from tasks where clinic_id = ${clinicId} and title = 'Revisar turno en Smile Connect'`;
    expect(task).toBeDefined();
  });

  it("cupo diario: se espacia la sincronización y siempre queda una reserva para confirmar turnos", async () => {
    // Las cuentas.
    expect(link.nearPullCost(146)).toBe(230); // dos páginas de 100, más los pacientes nuevos
    expect(link.nearPullCost(40)).toBe(95);
    expect(link.nearPullEvery(30, 230, 6000, 600)).toBe(30); // alcanza para el ritmo de siempre
    expect(link.nearPullEvery(30, 230, 1000, 600)).toBe(150); // quedan 4 vueltas: una cada 2 horas y media
    expect(link.nearPullEvery(30, 230, 100, 600)).toBeNull(); // no alcanza

    // Con el cupo casi usado, no se sincroniza, pero escribir y verificar los turnos sigue andando.
    await sql`update smile_connect_connections set api_reads = ${link.READ_CAP - link.WRITE_RESERVE - 50}, api_reads_day = (now() at time zone 'utc')::date, api_near_pull_at = null, api_wide_pull_at = null where clinic_id = ${clinicId}`;
    fake.calls.length = 0;
    const out = (await link.runSmileConnect())[clinicId] as Record<string, unknown>;
    expect(out.cupo).toContain("No alcanza el cupo");
    expect(out.cerca).toBeUndefined();
    expect(fake.calls.filter((c) => c.path === "/appointments" && c.method === "GET")).toEqual([]);

    const phone = "5491100007301";
    fake.patients.set(8301, { patient_id: 8301, name: "Rosa", surname: "Cupo", id_number: "33000333", email: null, phone_country_code: "54", phone_number: "1100007301" });
    await tool("registrar_paciente", { nombre_completo: "Rosa Cupo", dni: "33000333", cobertura: "Particular" }, phone);
    const booked = await tool("reservar_turno", { tipo_turno_id: consult, profesional_id: pro, inicio: at(5, "10:00") }, phone);
    expect(await push.pushPendingSmile(clinicId)).toMatchObject({ ok: 1 });
    expect(await row(booked.turno_id!)).toMatchObject({ status: "confirmado", smile_sync: "ok" });

    // Una lectura rechazada por el tope no gasta cupo.
    const [{ api_reads: before }] = await sql`select api_reads from smile_connect_connections where clinic_id = ${clinicId}`;
    await expect(link.pullSmileConnect(clinicId, "lejos")).rejects.toThrow(/cupo/);
    const [{ api_reads: afterReads }] = await sql`select api_reads from smile_connect_connections where clinic_id = ${clinicId}`;
    expect(afterReads).toBe(before);
    await sql`update smile_connect_connections set api_reads = 0 where clinic_id = ${clinicId}`;
  });

  it("una ventana con pacientes todavía sin leer no da de baja turnos que siguen en Smile Connect", async () => {
    await sql`update smile_connect_connections set api_reads = 0, api_near_count = 100 where clinic_id = ${clinicId}`;
    // Un turno de Smile Connect que Turnia ya tiene.
    fake.patients.set(8401, { patient_id: 8401, name: "Elsa", surname: "Ventana", id_number: "34000444", email: null, phone_country_code: "54", phone_number: "1100007401" });
    fake.appointments.set(60000, { appointment_id: 60000, patient_id: 8401, start_date: at(1, "09:00"), end_date: at(1, "09:30"), box_id: 77, professional_ids: [501], attendance: null, cancelled: false });
    await link.pullSmileConnect(clinicId, "cerca");
    const [mine] = await sql`select id, status from appointments where clinic_id = ${clinicId} and external_id = 'sc:60000'`;
    expect(mine.status).toBe("confirmado");
    // Llegan 31 pacientes nuevos de golpe (con turnos que se listan antes), y en Smile Connect el turno pasa
    // a otro paciente que todavía no se leyó: Turnia lee 30 por vuelta, así que ese queda para la siguiente.
    for (let i = 0; i < 31; i++) {
      fake.patients.set(8500 + i, { patient_id: 8500 + i, name: `Nuevo${i}`, surname: "Lote", id_number: `35000${100 + i}`, email: null, phone_country_code: null, phone_number: null });
      fake.appointments.set(59000 + i, { appointment_id: 59000 + i, patient_id: 8500 + i, start_date: at(2, "09:00"), end_date: at(2, "09:05"), box_id: 77, professional_ids: [501], attendance: null, cancelled: true });
    }
    fake.appointments.get(60000)!.patient_id = 8530;
    const result = await link.pullSmileConnect(clinicId, "cerca");
    expect(result.pendientes).toBeGreaterThan(0);
    // No lo canceló aunque esta vuelta no lo pudo leer.
    expect((await sql`select status from appointments where id = ${mine.id}`)[0].status).toBe("confirmado");
  });

  it("profesionales: un cambio de nombre en Smile Connect no crea otro, y se puede vincular a mano el que no coincide", async () => {
    await sql`update smile_connect_connections set api_reads = 0 where clinic_id = ${clinicId}`;
    const count = async () => (await sql`select count(*)::int as n from professionals where clinic_id = ${clinicId}`)[0].n;
    const before = await count();
    // En Smile Connect le cambian el nombre a la profesional ya vinculada: sigue siendo la misma.
    fake.pros[0].name = "Laurita";
    await link.pullSmileConnect(clinicId, "cerca");
    expect(await count()).toBe(before);
    expect((await sql`select smile_professional_id from professionals where id = ${pro}`)[0].smile_professional_id).toBe(501);
    fake.pros[0].name = "Laura";

    // Uno cuyo nombre no coincide no se vincula solo; se vincula a mano y la sincronización lo respeta.
    const [{ id: other }] = await sql`insert into professionals (clinic_id, full_name, specialty) values (${clinicId}, 'Dr. Apodo Raro', 'Odontología') returning id`;
    fake.pros.push({ professional_id: 502, name: "Pedro", surname: "Distinto", box_id: null });
    try {
      const check = await link.saveSmileApiKey(clinicId, KEY);
      expect(check.professionals.find((p) => p.smileId === 502)?.turnia).toBeNull();
      await expect(link.linkSmileProfessional(clinicId, other, 999, 77)).rejects.toThrow("no está en Smile Connect");
      await expect(link.linkSmileProfessional(clinicId, other, 502, null)).rejects.toThrow("consultorio");
      await link.linkSmileProfessional(clinicId, other, 502, 77);
      expect((await sql`select smile_professional_id, smile_box_id from professionals where id = ${other}`)[0]).toEqual({ smile_professional_id: 502, smile_box_id: 77 });
      const total = await count();
      await link.pullSmileConnect(clinicId, "cerca");
      expect(await count()).toBe(total);
      // Desvincular.
      await link.linkSmileProfessional(clinicId, other, null, null);
      expect((await sql`select smile_professional_id from professionals where id = ${other}`)[0].smile_professional_id).toBeNull();
    } finally {
      fake.pros.pop();
      await sql`update professionals set active = false where id = ${other}`;
    }
  });

  it("si Smile Connect rechaza la clave, avisa al consultorio una sola vez y lo muestra en el panel", async () => {
    await sql`insert into clinic_notice_phones (clinic_id, phone, name) values (${clinicId}, '5491100007999', 'Recepción QA') on conflict do nothing`;
    await sql`update smile_connect_connections set api_near_pull_at = null, api_wide_pull_at = null where clinic_id = ${clinicId}`;
    fake.unauthorized = true;
    try {
      await link.runSmileConnect();
      await link.runSmileConnect();
    } finally {
      fake.unauthorized = false;
    }
    const notices = await sql`select body from clinic_notices where clinic_id = ${clinicId} and kind = 'smile' and body like '%no acepta la clave%'`;
    expect(notices).toHaveLength(1);
    expect(notices[0].body).toContain("rechazó la clave");
    expect((await link.getSmileApiConnection(clinicId))!.api_error).toContain("rechazó la clave");
  });
});
