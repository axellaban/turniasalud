import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Pacientes que ya existen: identificarlos por DNI desde otro número (o la
// demo web) sin crear fichas repetidas, y unificar las que ya se repitieron.

const mocks = vi.hoisted(() => ({ cookies: new Map<string, string>(), calendarFetch: vi.fn(async () => new Response(null, { status: 204 })) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.cookies.has(name) ? { value: mocks.cookies.get(name) } : undefined),
    set: (name: string, value: string) => mocks.cookies.set(name, value),
    delete: (name: string) => mocks.cookies.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn(async () => {}) }));
vi.mock("@/lib/calendar/google", async (original) => ({
  ...(await original<typeof import("@/lib/calendar/google")>()),
  getConnection: vi.fn(async () => ({ clinic_id: "x", status: "conectado" })),
  calendarFetch: mocks.calendarFetch,
}));

const base = testDatabaseUrl();
const CLINIC = "00000000-0000-4000-8000-000000000001";
const RUIZ = "00000000-0000-4000-8000-0000000000a3";
const LIMPIEZA = "00000000-0000-4000-8000-0000000000b5";
const MARIA = "00000000-0000-4000-8000-0000000000c1";

describe.runIf(base)("pacientes que ya existen", () => {
  let sql: typeof import("@/lib/db").sql;
  let service: typeof import("@/lib/agent/service");
  let clinicLib: typeof import("@/lib/clinic");
  let patients: typeof import("@/lib/patients");

  const ctx = (phone: string) => ({ clinicId: CLINIC, patientPhone: phone, channel: "web", conversationId: "conv_dni" });
  const count = async (dni: string) =>
    (await sql<Array<{ n: number }>>`select count(*)::int as n from patients where clinic_id = ${CLINIC} and dni = ${dni}`)[0].n;
  const addPatient = async (data: { phone: string; name?: string | null; dni?: string | null; birth?: string | null; coverage?: string | null; plan?: string | null; member?: string | null }) =>
    (
      await sql<Array<{ id: string }>>`
        insert into patients (clinic_id, phone, full_name, dni, birth_date, coverage, coverage_plan, member_number, last_contact_at)
        values (${CLINIC}, ${data.phone}, ${data.name ?? null}, ${data.dni ?? null}, ${data.birth ?? null}, ${data.coverage ?? null},
          ${data.plan ?? null}, ${data.member ?? null}, now() - interval '30 days')
        returning id`
    )[0].id;

  beforeAll(async () => {
    const url = await scratchDatabase(base!, "turnia_test_pacientes");
    await resetTestDatabase(url);
    for (const [key, value] of Object.entries({ DATABASE_URL: url, SESSION_SECRET: "test-session", AGENT_TOOLS_SECRET: "test-tools", ELEVENLABS_API_KEY: "fake" }))
      vi.stubEnv(key, value);
    ({ sql } = await import("@/lib/db"));
    service = await import("@/lib/agent/service");
    clinicLib = await import("@/lib/clinic");
    patients = await import("@/lib/patients");
  }, 60000);

  beforeEach(async () => {
    mocks.cookies.clear();
    mocks.cookies.set("turnia_session", (await import("@/lib/session")).createSessionToken());
  });

  afterAll(async () => {
    await (await import("@/lib/db")).closeDb();
    vi.unstubAllEnvs();
  });

  it("compara nombres y DNI como lo haría la recepción", () => {
    expect(patients.normalizeDni("30.111.222")).toBe("30111222");
    expect(patients.normalizeDni("12")).toBeNull();
    expect(patients.namesMatch("Mariano Mininni", "Mariano Osvaldo Mininni")).toBe(true);
    expect(patients.namesMatch("juan carlos montes", "Juan Carlos Montes")).toBe(true);
    expect(patients.namesMatch("Montes", "Juan Carlos Montes")).toBe(false);
    expect(patients.namesMatch("Valeria Sotó", "Valeria Soto")).toBe(true);
    expect(patients.namesMatch("Diego Romero", "Valeria Soto")).toBe(false);
    // Con DNI y nombre alcanza; la fecha es la segunda oportunidad si el nombre no coincide.
    const juan = { birth_date: "1967-09-24", full_name: "Juan Carlos Montes" };
    expect(patients.verifyIdentity(juan, { name: "Juan Carlos Montes" })).toBe("ok");
    expect(patients.verifyIdentity(juan, {})).toBe("falta_nombre");
    expect(patients.verifyIdentity(juan, { name: "Pepe Montes" })).toBe("falta_fecha");
    expect(patients.verifyIdentity(juan, { name: "Pepe Montes", birthDate: "1967-09-24" })).toBe("ok");
    expect(patients.verifyIdentity(juan, { name: "Pepe Montes", birthDate: "1970-01-01" })).toBe("no_coincide");
    expect(patients.verifyIdentity({ birth_date: "1967-09-24", full_name: null }, {})).toBe("falta_fecha");
    expect(patients.verifyIdentity({ birth_date: null, full_name: "Valeria Soto" }, {})).toBe("falta_nombre");
    expect(patients.verifyIdentity({ birth_date: null, full_name: "Valeria Soto" }, { name: "Diego Romero" })).toBe("no_coincide");
  });

  it("reconoce por DNI y nombre a quien escribe desde la web, sin pedirle la fecha ni crear otra ficha", async () => {
    const id = await addPatient({ phone: "5491170000001", name: "Juan Carlos Montes", dni: "43952789", birth: "1967-09-24", coverage: "OSDE", plan: "210", member: "6109279301" });
    const web = ctx("web-aaaa0001");

    const soloDni = await service.findPatientByDni(web, { dni: "43.952.789" });
    expect(soloDni.encontrado).toBeNull();
    expect(soloDni.mensaje).toContain("nombre y apellido");
    expect(soloDni).not.toHaveProperty("ficha");

    // Un nombre que no coincide pide la fecha, sin decir qué falló ni mostrar la ficha.
    const apodo = await service.findPatientByDni(web, { dni: "43952789", nombre_completo: "Pepe Montes" });
    expect(apodo.mensaje).toContain("fecha de nacimiento");
    expect(apodo).not.toHaveProperty("ficha");

    const malaFecha = await service.findPatientByDni(web, { dni: "43952789", nombre_completo: "Pepe Montes", fecha_nacimiento: "1970-01-01" });
    expect(malaFecha.mensaje).toContain("no coinciden");
    expect(malaFecha).not.toHaveProperty("ficha");
    expect(await clinicLib.findPatientByPhone(CLINIC, "web-aaaa0001")).toBeNull();

    const ok = await service.findPatientByDni(web, { dni: "43952789", nombre_completo: "Juan Carlos Montes" });
    expect(ok.encontrado).toBe(true);
    expect(ok.ficha).toContain("Juan Carlos Montes");
    expect(ok.ficha).toContain("OSDE plan 210");
    expect(ok.ficha).toContain("Número de afiliado: cargado");
    expect(ok.ficha).not.toContain("6109279301");

    // El resto de la conversación ya usa su ficha.
    expect((await clinicLib.findPatientByPhone(CLINIC, "web-aaaa0001"))?.id).toBe(id);
    await service.registerPatient(web, { email: "juan@example.com" });
    const [after] = await sql<Array<{ email: string }>>`select email from patients where id = ${id}`;
    expect(after.email).toBe("juan@example.com");
    expect(await count("43952789")).toBe(1);
    const [{ n }] = await sql<Array<{ n: number }>>`select count(*)::int as n from patients where phone = 'web-aaaa0001'`;
    expect(n).toBe(0);

    // Y la conversación que llega después del cierre se guarda en su ficha.
    const { recordConversation } = await import("@/lib/conversations");
    await recordConversation({
      agent_id: "agent_x",
      conversation_id: "conv_web_juan",
      conversation_initiation_client_data: { dynamic_variables: { clinic_id: CLINIC, patient_phone: "web-aaaa0001" } },
      analysis: { data_collection_results: { nombre_paciente: { value: "Juan Carlos" }, memoria: { value: "Prefiere los martes." } } },
    } as never);
    const [conv] = await sql<Array<{ patient_id: string }>>`select patient_id from conversations where elevenlabs_conversation_id = 'conv_web_juan'`;
    expect(conv.patient_id).toBe(id);
    expect(await count("43952789")).toBe(1);
  });

  it("si ya había datos sueltos en la conversación, los pasa a su ficha y se reconoce por nombre si no hay fecha", async () => {
    const id = await addPatient({ phone: "5491170000002", name: "Valeria Soto", dni: "27845112", coverage: "OSDE", plan: "310" });
    const web = ctx("web-aaaa0002");
    // Antes de saber que era paciente, el agente guardó algo en una ficha provisoria.
    await service.registerPatient(web, { nombre_completo: "Valeria Soto", preferencias: "Prefiere los jueves" });
    const temp = await clinicLib.findPatientByPhone(CLINIC, "web-aaaa0002");
    expect(temp?.id).not.toBe(id);

    // Con el DNI, el registro mismo la une a su ficha (no crea un DNI repetido).
    const r = await service.registerPatient(web, { dni: "27845112" });
    expect(r.mensaje).toContain("Ya era paciente");
    expect(r.ficha).toContain("Faltan en la ficha");
    expect(r.ficha).toContain("fecha de nacimiento");
    expect(await count("27845112")).toBe(1);
    const merged = await clinicLib.findPatientByPhone(CLINIC, "web-aaaa0002");
    expect(merged?.id).toBe(id);
    expect(merged?.preferences).toBe("Prefiere los jueves");
    expect(merged?.coverage_plan).toBe("310");
    const [{ n }] = await sql<Array<{ n: number }>>`select count(*)::int as n from patients where id = ${temp!.id}`;
    expect(n).toBe(0);
  });

  it("un DNI ajeno sin datos que coincidan no se guarda ni muestra la ficha", async () => {
    await addPatient({ phone: "5491170000003", name: "Diego Romero", dni: "31225678", birth: "1984-02-11", coverage: "OSDE", plan: "410" });
    const web = ctx("web-aaaa0003");
    const r = await service.registerPatient(web, { nombre_completo: "Otro Nombre", dni: "31225678", fecha_nacimiento: "1990-01-01" });
    expect(r.mensaje).toContain("no coinciden");
    expect(r).not.toHaveProperty("ficha");
    expect(await count("31225678")).toBe(1);
    const temp = await clinicLib.findPatientByPhone(CLINIC, "web-aaaa0003");
    expect(temp?.dni).toBeNull();
    expect(temp?.full_name).toBe("Otro Nombre");
  });

  it("no mezcla la ficha de este número con la de otra persona", async () => {
    // María (seed) escribe desde su número y da el DNI de Jorge (seed, sin fecha de nacimiento).
    const r = await service.findPatientByDni(ctx("5491155550001"), { dni: "20333444", nombre_completo: "Jorge Pérez" });
    expect(r.mensaje).toContain("ya es la ficha de María González");
    const maria = await clinicLib.findPatientByPhone(CLINIC, "5491155550001");
    expect(maria?.id).toBe(MARIA);
    expect(maria?.dni).toBe("28111222");
    expect(await count("20333444")).toBe(1);
  });

  it("si cambia de cobertura, borra el plan y el afiliado de la anterior", async () => {
    const phone = "5491170000004";
    await addPatient({ phone, name: "Carolina Díaz", dni: "36443218", coverage: "OSDE", plan: "310", member: "123" });
    const r = await service.registerPatient(ctx(phone), { cobertura: "Swiss Medical" });
    expect(r.paciente).toMatchObject({ cobertura: "Swiss Medical", plan: null, numero_afiliado: null });
    expect(r.mensaje).toContain("plan y el número de afiliado nuevos");
    // La misma cobertura escrita distinto no borra nada.
    await service.registerPatient(ctx(phone), { plan: "SMG20" });
    const again = await service.registerPatient(ctx(phone), { cobertura: "swiss medical" });
    expect(again.paciente?.plan).toBe("SMG20");
  });

  it("el contexto dice qué falta, cuándo vino por última vez y que no pregunte si ya vino", async () => {
    const id = await addPatient({ phone: "5491170000005", name: "Hernán Castro", dni: "30556781", coverage: "Particular" });
    await sql`insert into patient_visits (clinic_id, patient_id, service, professional, visited_at) values (${CLINIC}, ${id}, 'Consulta', 'Fernández', '2024-09-14')`;
    const vars = await clinicLib.buildDynamicVariables(await clinicLib.getClinic(CLINIC), "5491170000005");
    expect(vars.patient_context).toContain("Ya tiene ficha");
    expect(vars.patient_context).toContain("Última visita: 14 de sept de 2024 (Consulta), hace más de un año");
    expect(vars.patient_context).toContain("No le preguntes si ya vino antes");
    expect(vars.patient_context).toContain("Faltan en la ficha (pedilos antes de reservar): fecha de nacimiento, mail");
    expect(vars.patient_context).not.toContain("número de afiliado");
    const nuevo = await clinicLib.buildDynamicVariables(await clinicLib.getClinic(CLINIC), "web-sin-ficha");
    expect(nuevo.patient_context).toContain("usá buscar_paciente");
  });

  it("el panel unifica las fichas repetidas con el mismo DNI y conserva todo", async () => {
    const keep = await addPatient({ phone: "5491170000006", name: "Mariano Mininni", dni: "32064290", coverage: "OSDE" });
    const dupWeb = await addPatient({ phone: "web-dup00001", name: "Mariano Osvaldo Mininni", dni: "32064290", birth: "1986-03-02", coverage: "OSDE", plan: "210" });
    const dupTel = await addPatient({ phone: "telegram:99", name: "Mariano Mininni", dni: "32064290" });
    const tomorrow = new Date(Date.now() + 86400_000);
    tomorrow.setUTCHours(14, 0, 0, 0);
    await sql`
      insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, source)
      values (${CLINIC}, ${dupWeb}, ${RUIZ}, ${LIMPIEZA}, ${tomorrow.toISOString()}, ${new Date(tomorrow.getTime() + 30 * 60_000).toISOString()}, 'confirmado', 'web')`;
    await sql`insert into patient_visits (clinic_id, patient_id, service, visited_at) values (${CLINIC}, ${dupTel}, 'Limpieza', '2026-01-10')`;
    await sql`update patients set memory_summary = 'Pidió recordatorio una hora antes.' where id = ${dupWeb}`;

    expect((await patients.duplicatesOf({ id: keep, clinic_id: CLINIC, dni: "32064290" })).length).toBe(2);
    const actions = await import("@/app/panel/actions");
    const form = new FormData();
    form.set("id", keep);
    form.set("clinic_id", CLINIC);
    await expect(actions.mergePatientDuplicates(form)).rejects.toThrow(`redirect:/panel/pacientes/${keep}?unificadas=2`);

    expect(await count("32064290")).toBe(1);
    const [p] = await sql<Array<{ birth_date: string; coverage_plan: string; memory_summary: string }>>`select * from patients where id = ${keep}`;
    expect(p.birth_date).toBe("1986-03-02");
    expect(p.coverage_plan).toBe("210");
    expect(p.memory_summary).toContain("recordatorio");
    const [{ appts }] = await sql<Array<{ appts: number }>>`select count(*)::int as appts from appointments where patient_id = ${keep}`;
    expect(appts).toBe(1);
    const [{ visits }] = await sql<Array<{ visits: number }>>`select count(*)::int as visits from patient_visits where patient_id = ${keep}`;
    expect(visits).toBe(1);
    // Los números de las fichas repetidas siguen llevando a la ficha que quedó.
    expect((await clinicLib.findPatientByPhone(CLINIC, "telegram:99"))?.id).toBe(keep);
    expect((await clinicLib.findPatientByPhone(CLINIC, "web-dup00001"))?.id).toBe(keep);
  });

  it("el administrador borra fichas de prueba con todo lo suyo; el consultorio no puede", async () => {
    const gone = await addPatient({ phone: "web-borrar01", name: "Ficha De Prueba", dni: "40555666" });
    const alsoGone = await addPatient({ phone: "web-borrar02", name: "Sin Nombre" });
    const stays = await addPatient({ phone: "5491170000009", name: "Se Queda", dni: "11222333" });
    const start = new Date(Date.now() + 3 * 86400_000);
    start.setUTCHours(15, 0, 0, 0);
    const [appt] = await sql<Array<{ id: string }>>`
      insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, source,
        calendar_event_id, calendar_event_calendar, calendar_sync)
      values (${CLINIC}, ${gone}, ${RUIZ}, ${LIMPIEZA}, ${start.toISOString()}, ${new Date(start.getTime() + 30 * 60_000).toISOString()},
        'confirmado', 'web', 'evento123', 'cal@group.calendar.google.com', 'ok')
      returning id`;
    await sql`insert into tasks (clinic_id, patient_id, type, title) values (${CLINIC}, ${gone}, 'administrativo', 'Pedido de prueba')`;
    await sql`insert into conversations (clinic_id, patient_id, elevenlabs_conversation_id, channel) values (${CLINIC}, ${gone}, 'conv_borrar', 'web')`;
    await sql`insert into patient_phones (clinic_id, phone, patient_id) values (${CLINIC}, 'web-alias-borrar', ${gone})`;
    const actions = await import("@/app/panel/actions");
    const form = new FormData();
    for (const id of [gone, alsoGone, "no-es-un-id"]) form.append("ids", id);
    form.set("clinic_id", CLINIC);

    // Con el acceso del consultorio, no se borra nada.
    const [access] = await sql<Array<{ id: string }>>`
      insert into clinic_access (clinic_id, label, code_hash, code_hint) values (${CLINIC}, 'Consultorio', 'hash-borrar', 'XXXX') returning id`;
    mocks.cookies.set("turnia_session", (await import("@/lib/session")).createClinicSessionToken(access.id));
    await expect(actions.deletePatientsAction(form)).rejects.toThrow("redirect:/panel");
    const [{ n: before }] = await sql<Array<{ n: number }>>`select count(*)::int as n from patients where id in (${gone}, ${alsoGone})`;
    expect(before).toBe(2);

    mocks.cookies.set("turnia_session", (await import("@/lib/session")).createSessionToken());
    mocks.calendarFetch.mockClear();
    await expect(actions.deletePatientsAction(form)).rejects.toThrow("redirect:/panel/pacientes?borradas=2");
    const [{ n: after }] = await sql<Array<{ n: number }>>`select count(*)::int as n from patients where id in (${gone}, ${alsoGone})`;
    expect(after).toBe(0);
    expect(mocks.calendarFetch).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("/events/evento123"), { method: "DELETE" });
    const leftovers = await sql`
      select 'turno' from appointments where id = ${appt.id}
      union all select 'tarea' from tasks where title = 'Pedido de prueba'
      union all select 'conversacion' from conversations where elevenlabs_conversation_id = 'conv_borrar'
      union all select 'numero' from patient_phones where phone = 'web-alias-borrar'`;
    expect(leftovers.length).toBe(0);
    expect((await clinicLib.findPatientByPhone(CLINIC, "5491170000009"))?.id).toBe(stays);
  });

  it("la lista y la ficha muestran el borrado solo al administrador", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const list = (await import("@/app/panel/(app)/pacientes/page")).default;
    const html = renderToStaticMarkup(await list({ params: Promise.resolve({}), searchParams: Promise.resolve({ borradas: "2" }) } as never));
    expect(html).toContain("Se borraron 2 fichas");
    expect(html).toContain('name="ids"');
    const detail = (await import("@/app/panel/(app)/pacientes/[id]/page")).default;
    const ficha = renderToStaticMarkup(await detail({ params: Promise.resolve({ id: MARIA }), searchParams: Promise.resolve({}) } as never));
    expect(ficha).toContain("Borrar ficha");

    const [access] = await sql<Array<{ id: string }>>`
      insert into clinic_access (clinic_id, label, code_hash, code_hint) values (${CLINIC}, 'Consultorio', 'hash-lista', 'YYYY') returning id`;
    mocks.cookies.set("turnia_session", (await import("@/lib/session")).createClinicSessionToken(access.id));
    const asClinic = renderToStaticMarkup(await list({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never));
    expect(asClinic).not.toContain('name="ids"');
    const fichaClinic = renderToStaticMarkup(await detail({ params: Promise.resolve({ id: MARIA }), searchParams: Promise.resolve({}) } as never));
    expect(fichaClinic).not.toContain("Borrar ficha");
  });

  it("la herramienta buscar_paciente está publicada por HTTP", async () => {
    const { POST } = await import("@/app/api/agent/tools/[name]/route");
    const res = await POST(
      new Request("https://turnia.test/api/agent/tools/buscar_paciente", {
        method: "POST",
        headers: { "content-type": "application/json", "x-turnia-secret": "test-tools" },
        body: JSON.stringify({ clinic_id: CLINIC, patient_phone: "web-http0001", dni: "99999999" }),
      }),
      { params: Promise.resolve({ name: "buscar_paciente" }) },
    );
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.encontrado).toBe(false);
  });
});
