import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDaysKey, localDateKey } from "@/lib/time";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Reglas de turnos del panel que hacen cumplir las herramientas de Sofi (PLAN_PROTOCOLOS.md):
// coberturas, qué hace cada profesional, horarios por prestación, urgencias, prestación previa,
// aviso mínimo, quién mueve qué, el texto que recibe Sofi, la plantilla odontológica, las pantallas
// del panel y lo que muestra el Inicio.

const mocks = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.cookies.has(name) ? { value: mocks.cookies.get(name) } : undefined),
    set: (name: string, value: string) => mocks.cookies.set(name, value),
    delete: (name: string) => mocks.cookies.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); }, notFound: () => { throw new Error("notFound"); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn(async () => {}) }));

const url = testDatabaseUrl();
const timezone = "America/Argentina/Buenos_Aires";
const secret = "turnia-test-secret";
const day = (offset: number) => addDaysKey(localDateKey(new Date(), timezone), offset);
const at = (offset: number, time: string) => new Date(`${day(offset)}T${time}:00-03:00`).toISOString();
const localTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const localDay = (iso: string) => localDateKey(new Date(iso), timezone);
const form = (data: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) for (const item of [v].flat()) f.append(k, item);
  return f;
};

type Turno = { profesional_id: string; inicio: string; cobertura?: string };
type Result = { ok: boolean; error?: string; turnos: Turno[]; aviso_cobertura?: string; mensaje?: string; cobertura?: string; preguntar_antes?: string; urgencia?: boolean; turno_id?: string };

describe.runIf(url)("reglas de turnos del panel en las herramientas de Sofi", () => {
  let sql: typeof import("@/lib/db").sql;
  let handler: typeof import("@/app/api/agent/tools/[name]/route").POST;
  let service: typeof import("@/lib/agent/service");
  let clinicLib: typeof import("@/lib/clinic");
  let clinicId: string;
  let ana: string, beto: string;
  let consulta: string, limpieza: string, conducto: string, implantConsult: string, colocacion: string, urgencia: string;
  const osde = "5491100005001";
  const plain = "5491100005002";
  const nuevo = "5491100005003";

  async function tool(name: string, input: Record<string, unknown> = {}, phone = plain, channel = "whatsapp"): Promise<Result> {
    const request = new Request(`https://turnia.test/api/agent/tools/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-turnia-secret": secret },
      body: JSON.stringify({ clinic_id: clinicId, patient_phone: phone, canal: channel, ...input }),
    });
    return (await handler(request, { params: Promise.resolve({ name }) })).json();
  }
  const pros = (r: Result) => new Set(r.turnos.map((t) => t.profesional_id));
  const clinic = async () => (await sql`select * from clinics where id = ${clinicId}`)[0] as import("@/lib/types").Clinic;
  const clearAppointments = () => sql`delete from appointments where clinic_id = ${clinicId}`;

  beforeAll(async () => {
    const db = await scratchDatabase(url!, "turnia_protocols_test");
    await resetTestDatabase(db);
    for (const [k, v] of Object.entries({ DATABASE_URL: db, AGENT_TOOLS_SECRET: secret, SESSION_SECRET: "test-session", APP_URL: "https://turnia.test" })) vi.stubEnv(k, v);
    ({ sql } = await import("@/lib/db"));
    ({ POST: handler } = await import("@/app/api/agent/tools/[name]/route"));
    service = await import("@/lib/agent/service");
    clinicLib = await import("@/lib/clinic");
    [{ id: clinicId }] = await sql`insert into clinics (name, specialty, is_demo, retained_at) values ('Consultorio de reglas', 'Odontología', true, now()) returning id`;
    [{ id: ana }, { id: beto }] = await sql`
      insert into professionals (clinic_id, full_name, specialty, accepted_coverages) values
      (${clinicId}, 'Dra. Ana Prueba', 'Odontología', null), (${clinicId}, 'Dr. Beto Prueba', 'Odontología', ${["Swiss Medical", "Particular"]})
      returning id`;
    await sql`
      insert into schedules (professional_id, weekday, start_time, end_time)
      select p.id, d, '09:00', '18:00' from professionals p cross join generate_series(0, 6) d where p.clinic_id = ${clinicId}`;
    [{ id: consulta }, { id: limpieza }, { id: conducto }, { id: implantConsult }, { id: colocacion }, { id: urgencia }] = await sql`
      insert into appointment_types (clinic_id, name, specialty, duration_min, price) values
      (${clinicId}, 'Consulta', 'Odontología', 30, 40000),
      (${clinicId}, 'Limpieza', 'Odontología', 45, null),
      (${clinicId}, 'Conducto', 'Odontología', 60, null),
      (${clinicId}, 'Consulta de implantes', 'Odontología', 30, null),
      (${clinicId}, 'Colocación de implantes', 'Odontología', 90, null),
      (${clinicId}, 'Urgencia', 'Odontología', 30, null)
      returning id`;
    await sql`update appointment_types set is_urgent = true where id = ${urgencia}`;
    await sql`
      insert into patients (clinic_id, phone, full_name, dni, coverage, coverage_plan) values
      (${clinicId}, ${osde}, 'Paciente con OSDE', '30111222', 'OSDE', '210'),
      (${clinicId}, ${plain}, 'Paciente sin cobertura', '30111223', null, null),
      (${clinicId}, ${nuevo}, 'Paciente nuevo', '30111224', null, null)`;
  }, 60000);

  beforeEach(async () => {
    mocks.cookies.clear();
    mocks.cookies.set("turnia_session", (await import("@/lib/session")).createSessionToken());
    mocks.cookies.set("turnia_clinic", clinicId);
  });

  afterAll(async () => {
    await (await import("@/lib/db")).closeDb();
    vi.unstubAllEnvs();
  });

  it("la búsqueda deja afuera a quien no atiende la cobertura de la ficha; si nadie la atiende, ofrece como particular", async () => {
    const both = await tool("consultar_disponibilidad", { tipo_turno_id: consulta, desde: day(2), hasta: day(2) });
    expect(pros(both)).toEqual(new Set([ana, beto]));
    // OSDE: el Dr. Beto solo atiende Swiss Medical y particular.
    const r = await tool("consultar_disponibilidad", { tipo_turno_id: consulta, desde: day(2), hasta: day(2) }, osde);
    expect(r.ok).toBe(true);
    expect(pros(r)).toEqual(new Set([ana]));
    expect(r.aviso_cobertura).toBeUndefined();
    // Antes, la reserva fallaba recién al final; sigue fallando con OSDE, pero como particular se puede.
    expect(await tool("reservar_turno", { tipo_turno_id: consulta, profesional_id: beto, inicio: at(2, "10:00") }, osde))
      .toMatchObject({ ok: false, error: expect.stringContaining("no atiende por OSDE") });
    const particular = await tool("reservar_turno", { tipo_turno_id: consulta, profesional_id: beto, inicio: at(2, "10:00"), cobertura: "Particular" }, osde);
    expect(particular.ok).toBe(true);
    expect((await sql`select coverage from appointments where id = ${particular.turno_id!}`)[0].coverage).toBe("Particular");

    // Nadie atiende OSDE: salen los horarios de quien atiende particular, con el aviso.
    await sql`update professionals set accepted_coverages = ${["Galeno"]} where id = ${ana}`;
    try {
      const nobody = await tool("consultar_disponibilidad", { tipo_turno_id: consulta, desde: day(3), hasta: day(3) }, osde);
      expect(pros(nobody)).toEqual(new Set([beto]));
      expect(nobody.aviso_cobertura).toContain("como particular");
      const asParticular = await tool("consultar_disponibilidad", { tipo_turno_id: consulta, desde: day(3), hasta: day(3), cobertura: "Particular" }, osde);
      expect(pros(asParticular)).toEqual(new Set([beto]));
      expect(asParticular.aviso_cobertura).toBeUndefined();
      // Y si tampoco hay quien atienda particular, no ofrece horarios que después no se pueden reservar.
      await sql`update professionals set accepted_coverages = ${["Swiss Medical"]} where id = ${beto}`;
      expect(await tool("consultar_disponibilidad", { tipo_turno_id: consulta, desde: day(3), hasta: day(3) }, osde))
        .toMatchObject({ ok: false, error: expect.stringContaining("Nadie lo puede atender así") });
    } finally {
      await sql`update professionals set accepted_coverages = ${["Swiss Medical", "Particular"]} where id = ${beto}`;
      await sql`update professionals set accepted_coverages = null where id = ${ana}`;
      await clearAppointments();
    }
  });

  it("matriz de coberturas: avisa el copago y no ofrece lo que la cobertura no cubre; el consultorio puede darlo igual", async () => {
    await sql`
      insert into coverage_rules (clinic_id, coverage, plan, appointment_type_id, mode, copay) values
      (${clinicId}, 'OSDE', '210', null, 'copago', 5000),
      (${clinicId}, 'osde', null, ${implantConsult}, 'no_acepta', null)`;
    try {
      const r = await tool("consultar_disponibilidad", { tipo_turno_id: consulta, desde: day(2), hasta: day(2) }, osde);
      expect(r.turnos.length).toBeGreaterThan(0);
      for (const t of r.turnos) expect(t.cobertura).toMatch(/copago de \$\s?5\.000/);
      const booked = await tool("reservar_turno", { tipo_turno_id: consulta, profesional_id: r.turnos[0].profesional_id, inicio: r.turnos[0].inicio }, osde);
      expect(booked).toMatchObject({ ok: true, cobertura: expect.stringContaining("copago") });

      const implant = await tool("consultar_disponibilidad", { tipo_turno_id: implantConsult, desde: day(4), hasta: day(4) }, osde);
      expect(implant.aviso_cobertura).toContain("no se atiende Consulta de implantes");
      expect(await tool("reservar_turno", { tipo_turno_id: implantConsult, profesional_id: ana, inicio: implant.turnos[0].inicio }, osde))
        .toMatchObject({ ok: false, error: expect.stringContaining("no se atiende Consulta de implantes") });
      // El consultorio (panel) solo mira la lista del profesional.
      const panel = await service.bookAppointment({ clinicId, patientPhone: osde, channel: "panel" }, { tipo_turno_id: implantConsult, profesional_id: ana, inicio: implant.turnos[0].inicio });
      expect(panel.ok).toBe(true);
      const catalog = clinicLib.catalogText(await clinicLib.getCatalog(clinicId));
      expect(catalog).toContain("COBERTURAS (consultar_disponibilidad y reservar_turno ya las aplican");
      expect(catalog).toMatch(/- OSDE plan 210: con copago de \$\s?5\.000/);
      expect(catalog).toContain("- osde · Consulta de implantes: no se acepta: ofrecé particular");
    } finally {
      await sql`delete from coverage_rules where clinic_id = ${clinicId}`;
      await clearAppointments();
    }
  });

  it("con prestaciones marcadas, el profesional hace solo esas", async () => {
    await sql`insert into professional_appointment_types (professional_id, appointment_type_id) values (${ana}, ${consulta}), (${ana}, ${limpieza})`;
    try {
      const r = await tool("consultar_disponibilidad", { tipo_turno_id: conducto, desde: day(2), hasta: day(2) });
      expect(pros(r)).toEqual(new Set([beto]));
      expect(await tool("reservar_turno", { tipo_turno_id: conducto, profesional_id: ana, inicio: at(2, "10:00") }))
        .toMatchObject({ ok: false, error: expect.stringContaining("Dra. Ana Prueba no hace Conducto") });
      expect(pros(await tool("consultar_disponibilidad", { tipo_turno_id: limpieza, desde: day(2), hasta: day(2) }))).toEqual(new Set([ana, beto]));
      const catalog = clinicLib.catalogText(await clinicLib.getCatalog(clinicId));
      expect(catalog).toMatch(/Dra\. Ana Prueba .*\| Hace solo: (Consulta, Limpieza|Limpieza, Consulta)/);
    } finally {
      await sql`delete from professional_appointment_types where professional_id = ${ana}`;
    }
  });

  it("un horario solo para algunas prestaciones no se usa para las demás", async () => {
    const weekday = new Date(`${day(2)}T12:00:00Z`).getUTCDay();
    await sql`delete from schedules where professional_id = ${beto} and weekday = ${weekday}`;
    await sql`
      insert into schedules (professional_id, weekday, start_time, end_time, appointment_type_ids) values
      (${beto}, ${weekday}, '09:00', '12:00', null), (${beto}, ${weekday}, '14:00', '18:00', ${[conducto]}::uuid[])`;
    try {
      const cleaning = await tool("consultar_disponibilidad", { tipo_turno_id: limpieza, profesional_id: beto, desde: day(2), hasta: day(2) });
      expect(cleaning.turnos.length).toBeGreaterThan(0);
      for (const t of cleaning.turnos) expect(localTime(t.inicio) < "12:00").toBe(true);
      expect(await tool("reservar_turno", { tipo_turno_id: limpieza, profesional_id: beto, inicio: at(2, "14:00") }))
        .toMatchObject({ ok: false, error: expect.stringContaining("no atiende en ese horario") });
      const root = await tool("reservar_turno", { tipo_turno_id: conducto, profesional_id: beto, inicio: at(2, "14:00") });
      expect(root.ok).toBe(true);
      const catalog = clinicLib.catalogText(await clinicLib.getCatalog(clinicId));
      expect(catalog).toContain("14:00-18:00 (solo Conducto)");
    } finally {
      await sql`delete from schedules where professional_id = ${beto} and weekday = ${weekday}`;
      await sql`insert into schedules (professional_id, weekday, start_time, end_time) values (${beto}, ${weekday}, '09:00', '18:00')`;
      await clearAppointments();
    }
  });

  it("urgencias: busca hoy y mañana, usa las horas reservadas y no las presta a los demás turnos (salvo que se liberen)", async () => {
    const [{ id: guardia }] = await sql`insert into professionals (clinic_id, full_name, specialty) values (${clinicId}, 'Dra. Guardia', 'Odontología') returning id`;
    await sql`
      insert into schedules (professional_id, weekday, start_time, end_time, urgent_only)
      select ${guardia}::uuid, d, '07:00', '23:00', true from generate_series(0, 6) d`;
    try {
      const urgent = await tool("consultar_disponibilidad", { tipo_turno_id: urgencia }, plain);
      expect(urgent).toMatchObject({ ok: true, urgencia: true });
      expect(urgent.turnos.length).toBeGreaterThan(0);
      for (const t of urgent.turnos) expect([day(0), day(1)]).toContain(localDay(t.inicio));
      expect(pros(urgent).has(guardia)).toBe(true);

      const normal = await tool("consultar_disponibilidad", { tipo_turno_id: consulta, desde: day(2), hasta: day(2) });
      expect(pros(normal).has(guardia)).toBe(false);
      expect(await tool("reservar_turno", { tipo_turno_id: consulta, profesional_id: guardia, inicio: at(2, "08:00") }))
        .toMatchObject({ ok: false, error: expect.stringContaining("no atiende en ese horario") });
      // El consultorio sí puede usar esas horas desde la Agenda.
      const panel = await service.bookAppointment({ clinicId, patientPhone: plain, channel: "panel" }, { tipo_turno_id: consulta, profesional_id: guardia, inicio: at(2, "08:00") });
      expect(panel.ok).toBe(true);

      // Se liberan 72 horas antes: dentro de ese lapso, cualquier turno las puede usar.
      await sql`update clinics set urgent_release_hours = 72 where id = ${clinicId}`;
      const soon = await tool("consultar_disponibilidad", { tipo_turno_id: consulta, profesional_id: guardia, desde: day(0), hasta: day(2) });
      expect(soon.turnos.length).toBeGreaterThan(0);
      for (const t of soon.turnos) expect(Date.parse(t.inicio)).toBeLessThanOrEqual(Date.now() + 72 * 3600_000);
      expect((await tool("consultar_disponibilidad", { tipo_turno_id: consulta, profesional_id: guardia, desde: day(4), hasta: day(4) })).turnos).toEqual([]);

      // Sin lugar hoy ni mañana: lo dice y pide la tarea urgente.
      await sql`insert into schedule_blocks (clinic_id, starts_at, ends_at, reason) values (${clinicId}, now() - interval '1 hour', ${at(2, "00:00")}, 'Cerrado')`;
      expect(await tool("consultar_disponibilidad", { tipo_turno_id: urgencia }, plain))
        .toMatchObject({ ok: true, turnos: [], mensaje: expect.stringContaining("No hay lugar de urgencia hoy ni mañana") });
    } finally {
      await sql`delete from schedule_blocks where clinic_id = ${clinicId}`;
      await sql`update clinics set urgent_release_hours = null where id = ${clinicId}`;
      await sql`update professionals set active = false where id = ${guardia}`;
      await clearAppointments();
    }
  });

  it("una prestación que pide otra antes: no la ofrece hasta que el paciente tiene esa otra", async () => {
    await sql`update appointment_types set requires_type_id = ${implantConsult} where id = ${colocacion}`;
    try {
      const blocked = await tool("consultar_disponibilidad", { tipo_turno_id: colocacion, desde: day(3), hasta: day(3) }, nuevo);
      expect(blocked).toMatchObject({ ok: false, error: expect.stringContaining("tiene que haber tenido antes «Consulta de implantes»") });
      expect(blocked.error).toContain(`id=${implantConsult}`);
      expect(await tool("reservar_turno", { tipo_turno_id: colocacion, profesional_id: ana, inicio: at(3, "10:00") }, nuevo)).toMatchObject({ ok: false });
      // En la misma visita, sí.
      expect(await tool("consultar_disponibilidad", { tipo_turno_id: implantConsult, segundo_tipo_turno_id: colocacion, desde: day(3), hasta: day(3) }, nuevo))
        .toMatchObject({ ok: true });
      const first = await tool("consultar_disponibilidad", { tipo_turno_id: implantConsult, desde: day(3), hasta: day(3) }, nuevo);
      expect((await tool("reservar_turno", { tipo_turno_id: implantConsult, profesional_id: first.turnos[0].profesional_id, inicio: first.turnos[0].inicio }, nuevo)).ok).toBe(true);
      expect(await tool("consultar_disponibilidad", { tipo_turno_id: colocacion, desde: day(5), hasta: day(5) }, nuevo)).toMatchObject({ ok: true });
      expect(clinicLib.catalogText(await clinicLib.getCatalog(clinicId))).toContain("| Solo si ya tuvo o tiene reservada: Consulta de implantes");
    } finally {
      await sql`update appointment_types set requires_type_id = null where id = ${colocacion}`;
      await clearAppointments();
    }
  });

  it("aviso mínimo: con menos aviso, Sofi no cancela ni mueve y el turno sigue", async () => {
    await sql`update clinics set cancel_notice_hours = 48, reschedule_notice_hours = 48 where id = ${clinicId}`;
    try {
      const soon = await tool("consultar_disponibilidad", { tipo_turno_id: consulta, desde: day(1), hasta: day(1) });
      const booked = await tool("reservar_turno", { tipo_turno_id: consulta, profesional_id: soon.turnos[0].profesional_id, inicio: soon.turnos[0].inicio });
      expect(await tool("cancelar_turno", { turno_id: booked.turno_id }))
        .toMatchObject({ ok: false, error: expect.stringMatching(/Faltan menos de 48 horas.*derivacion_humana/) });
      expect(await tool("consultar_disponibilidad", { turno_id: booked.turno_id, desde: day(5), hasta: day(5) }))
        .toMatchObject({ ok: false, error: expect.stringContaining("Faltan menos de 48 horas") });
      expect((await sql`select status from appointments where id = ${booked.turno_id!}`)[0].status).toBe("confirmado");
      // El consultorio sí lo cancela desde el panel.
      expect((await service.cancelClinicAppointment(clinicId, booked.turno_id!)).ok).toBe(true);

      const later = await tool("consultar_disponibilidad", { tipo_turno_id: consulta, desde: day(5), hasta: day(5) });
      const far = await tool("reservar_turno", { tipo_turno_id: consulta, profesional_id: later.turnos[0].profesional_id, inicio: later.turnos[0].inicio });
      expect(await tool("cancelar_turno", { turno_id: far.turno_id })).toMatchObject({ ok: true });
      const text = clinicLib.clinicInfoText(await clinic());
      expect(text).toContain("Para mover un turno hacen falta al menos 48 horas de aviso.");
      expect(text).toContain("Para cancelar un turno hacen falta al menos 48 horas de aviso: con menos, la cancelación la gestiona recepción.");
    } finally {
      await sql`update clinics set cancel_notice_hours = null, reschedule_notice_hours = null where id = ${clinicId}`;
      await clearAppointments();
    }
  });

  it("quién mueve qué: «Sofi lo puede mover» y lo que da solo el consultorio", async () => {
    const [p] = await sql`select id from patients where phone = ${plain}`;
    const seed = async (type: string, offset: number) =>
      (await sql`
        insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, source)
        values (${clinicId}, ${p.id}, ${ana}, ${type}, ${at(offset, "10:00")}, ${at(offset, "11:00")}, 'confirmado', 'panel') returning id`)[0].id as string;
    await sql`update appointment_types set agent_can_reschedule = false where id = ${limpieza}`;
    await sql`update appointment_types set panel_only = true where id = ${conducto}`;
    try {
      const cleaning = await seed(limpieza, 4);
      expect(await tool("consultar_disponibilidad", { turno_id: cleaning, desde: day(6), hasta: day(6) }))
        .toMatchObject({ ok: false, error: expect.stringContaining("El cambio de «Limpieza» lo coordina recepción") });
      expect((await service.rescheduleClinicAppointment(clinicId, cleaning, { nuevo_inicio: at(6, "10:00") })).ok).toBe(true);

      const root = await seed(conducto, 5);
      expect(await tool("consultar_disponibilidad", { turno_id: root, desde: day(7), hasta: day(7) }))
        .toMatchObject({ ok: false, error: expect.stringContaining("la da solo el consultorio") });
      await sql`update clinics set move_panel_only = true where id = ${clinicId}`;
      expect(await tool("consultar_disponibilidad", { turno_id: root, desde: day(7), hasta: day(7) })).toMatchObject({ ok: true });
      const catalog = clinicLib.catalogText(await clinicLib.getCatalog(clinicId), [], timezone, await clinic());
      expect(catalog).toContain("Conducto (Odontología, 60 min)");
      expect(catalog).toContain("Si el paciente ya tiene ese turno, sí podés moverlo con su turno_id");
      expect(catalog).toContain("| Si el paciente ya tiene ese turno, el cambio lo coordina recepción");
    } finally {
      await sql`update appointment_types set agent_can_reschedule = true where id = ${limpieza}`;
      await sql`update appointment_types set panel_only = false where id = ${conducto}`;
      await sql`update clinics set move_panel_only = false where id = ${clinicId}`;
      await clearAppointments();
    }
  });

  it("lo que recibe Sofi: trato, protocolo odontológico, precio y qué preguntar antes", async () => {
    // El protocolo odontológico viene prendido en todos los consultorios odontológicos.
    expect((await clinic()).dental_protocol).toBe(true);
    await sql`update clinics set tone = 'usted' where id = ${clinicId}`;
    await sql`update appointment_types set price = 900000, price_mode = 'desde' where id = ${colocacion}`;
    await sql`update appointment_types set price = 50000, price_mode = 'no_informar' where id = ${conducto}`;
    await sql`update appointment_types set ask_before = '¿Tenés una panorámica reciente?' where id = ${implantConsult}`;
    try {
      const info = clinicLib.clinicInfoText(await clinic());
      expect(info).toContain("Trato: de usted con todos los pacientes");
      expect(info).toContain("Protocolo odontológico de Turnia");
      // También si la ficha dice otra especialidad pero sus profesionales son odontólogos.
      await sql`update clinics set specialty = 'Multiespecialidad' where id = ${clinicId}`;
      expect(clinicLib.clinicInfoText(await clinic())).not.toContain("Protocolo odontológico");
      expect((await clinicLib.buildDynamicVariables(await clinic(), plain)).clinic_info).toContain("Protocolo odontológico de Turnia");
      // Una clínica sin nada odontológico no lo recibe, aunque esté prendido; una multiespecialidad
      // con una odontóloga (la de los datos de ejemplo), sí.
      const [{ id: skin }] = await sql`insert into clinics (name, specialty, is_demo, retained_at) values ('Clínica de la piel', 'Dermatología', true, now()) returning id`;
      const skinClinic = await clinicLib.getClinic(skin);
      expect(skinClinic.dental_protocol).toBe(true);
      expect((await clinicLib.buildDynamicVariables(skinClinic, plain)).clinic_info).not.toContain("Protocolo odontológico");
      const seed = await clinicLib.getClinic("00000000-0000-4000-8000-000000000001");
      expect(seed.specialty).toBe("Multiespecialidad");
      expect((await clinicLib.buildDynamicVariables(seed, plain)).clinic_info).toContain("Protocolo odontológico de Turnia");
      await sql`delete from clinics where id = ${skin}`;
      await sql`update clinics set specialty = 'Odontología', dental_protocol = false, tone = null where id = ${clinicId}`;
      expect(clinicLib.clinicInfoText(await clinic())).not.toMatch(/Protocolo odontológico|Trato:/);

      const catalog = clinicLib.catalogText(await clinicLib.getCatalog(clinicId));
      expect(catalog).toContain("Colocación de implantes (Odontología, 90 min) id=");
      expect(catalog).toContain("| Precio: desde $900000.00 (el presupuesto final se da después de la evaluación)");
      expect(catalog).toContain("| Precio: no lo informes (el presupuesto se da en el consultorio)");
      expect(catalog).toContain("| Precio de referencia: $40000.00");
      expect(catalog).toContain("| Turno de urgencia: consultar_disponibilidad busca lugar para hoy y mañana");
      expect(catalog).toContain("| Antes de reservar, preguntá: ¿Tenés una panorámica reciente? (anotá la respuesta en notas)");
      expect(await tool("consultar_disponibilidad", { tipo_turno_id: implantConsult, desde: day(3), hasta: day(3) }))
        .toMatchObject({ ok: true, preguntar_antes: "¿Tenés una panorámica reciente?" });
    } finally {
      await sql`update appointment_types set price = null, price_mode = 'referencia', ask_before = null where id in (${colocacion}, ${conducto}, ${implantConsult})`;
      await sql`update clinics set specialty = 'Odontología', dental_protocol = true where id = ${clinicId}`;
    }
  });

  it("plantilla odontológica: suma las que faltan, una sola vez, con la consulta previa enlazada", async () => {
    const { applyDentalTemplate } = await import("@/lib/dental-template");
    const { DENTAL_TEMPLATE } = await import("@/lib/agent/modules/odontologia");
    const [{ id: fresh }] = await sql`insert into clinics (name, specialty, is_demo, retained_at) values ('Nueva odontológica', 'Odontología', true, now()) returning id`;
    await sql`insert into appointment_types (clinic_id, name, specialty, duration_min) values (${fresh}, 'control', 'Odontología', 15)`;
    expect(await applyDentalTemplate(fresh)).toBe(DENTAL_TEMPLATE.length - 1);
    expect(await applyDentalTemplate(fresh)).toBe(0);
    const types = await sql`select name, specialty, duration_min, requires_type_id, is_urgent, panel_only, agent_can_reschedule, recall_months from appointment_types where clinic_id = ${fresh}`;
    expect(types).toHaveLength(DENTAL_TEMPLATE.length);
    expect(types.find((t) => t.name === "control")!.duration_min).toBe(15);
    const byName = (name: string) => types.find((t) => t.name === name)!;
    const [consultaImplantes] = await sql`select id from appointment_types where clinic_id = ${fresh} and name = 'Consulta de implantes'`;
    expect(byName("Colocación de implantes")).toMatchObject({ requires_type_id: consultaImplantes.id, panel_only: true, agent_can_reschedule: false });
    expect(byName("Urgencia (dolor)")).toMatchObject({ is_urgent: true });
    expect(byName("Limpieza (higiene y control)")).toMatchObject({ recall_months: 6 });
    expect(new Set(types.map((t) => t.specialty))).toEqual(new Set(["Odontología"]));
  });

  it("panel: reglas de turnos, coberturas, prestaciones, profesionales y horarios", async () => {
    const protocol = await import("@/app/panel/protocol-actions");
    const actions = await import("@/app/panel/actions");
    // Turnos y urgencias.
    expect(await protocol.saveBookingRules({}, form({ clinic_id: clinicId, reschedule_notice_hours: "0" }))).toMatchObject({ ok: false });
    expect(await protocol.saveBookingRules({}, form({ clinic_id: clinicId, handoff_phone: "abc" })))
      .toMatchObject({ ok: false, message: expect.stringContaining("teléfono de recepción") });
    expect(await protocol.saveBookingRules({}, form({
      clinic_id: clinicId, rules_form: "1", reschedule_notice_hours: "24", cancel_notice_hours: "", reschedule_max_minutes: "120",
      reception_only_terms: "extracción, implante", keep_duration_on_reschedule: "on", urgent_release_hours: "12",
      policies: "Tolerancia de 15 minutos", followup_attempts: "2", followup_delay_hours: "3", urgency_instructions: "Llamar al 107",
      after_hours_instructions: "Guardia: 223 555-0199", handoff_phone: "+54 223 555-0100",
      dental_protocol_field: "1", dental_protocol: "on",
    }))).toMatchObject({ ok: true });
    expect(await clinic()).toMatchObject({
      reschedule_notice_hours: 24, cancel_notice_hours: null, reschedule_max_minutes: 120, reception_only_terms: "extracción, implante",
      keep_duration_on_reschedule: true, move_panel_only: false, urgent_release_hours: 12, dental_protocol: true,
      policies: "Tolerancia de 15 minutos", followup_attempts: 2, followup_delay_hours: 3, urgency_instructions: "Llamar al 107",
      after_hours_instructions: "Guardia: 223 555-0199", handoff_phone: "+54 223 555-0100",
    });
    // Guardar Consultorio no borra lo de esta pantalla (cada pantalla manda solo sus campos).
    await actions.saveClinic(form({ clinic_id: clinicId, name: "Consultorio de reglas", agent_name: "Sofi", faq: "Hay estacionamiento" }));
    expect(await clinic()).toMatchObject({ policies: "Tolerancia de 15 minutos", handoff_phone: "+54 223 555-0100", reschedule_notice_hours: 24, faq: "Hay estacionamiento" });
    // El consultorio no prende ni apaga el protocolo odontológico.
    const { createClinicAccess } = await import("@/lib/clinic-access");
    const { access } = await createClinicAccess(clinicId, "Recepción");
    mocks.cookies.set("turnia_session", (await import("@/lib/session")).createClinicSessionToken(access.id));
    expect(await protocol.saveBookingRules({}, form({ clinic_id: clinicId, dental_protocol_field: "1" }))).toMatchObject({ ok: true });
    expect(await clinic()).toMatchObject({ dental_protocol: true, reschedule_notice_hours: 24 });
    // Dar un celular con acceso total es solo de Turnia.
    await expect(protocol.addStaffPhone({}, form({ clinic_id: clinicId, name: "Recepción", phone: "11 5555-0100" }))).rejects.toThrow("redirect:/panel");
    mocks.cookies.set("turnia_session", (await import("@/lib/session")).createSessionToken());
    await sql`update clinics set dental_protocol = false, keep_duration_on_reschedule = false, reception_only_terms = null, reschedule_max_minutes = null, reschedule_notice_hours = null,
      urgent_release_hours = null, policies = null, followup_attempts = 1, followup_delay_hours = 2, urgency_instructions = null, after_hours_instructions = null,
      handoff_phone = null, faq = null where id = ${clinicId}`;

    // Coberturas del consultorio y de cada profesional, en un mismo formulario.
    expect(await protocol.saveCoverageLists({}, form({ clinic_id: clinicId, accepted_coverages: "OSDE, Particular, OSDE", [`pro:${beto}`]: "Swiss Medical, Particular", [`pro:${ana}`]: "" }))).toMatchObject({ ok: true });
    expect((await clinic()).accepted_coverages).toEqual(["OSDE", "Particular"]);
    const coveragesOf = async (id: string) => (await sql`select accepted_coverages from professionals where id = ${id}`)[0].accepted_coverages;
    expect(await coveragesOf(ana)).toBeNull();
    expect(await coveragesOf(beto)).toEqual(["Swiss Medical", "Particular"]);

    // Coberturas.
    expect(await protocol.addCoverageRule({}, form({ clinic_id: clinicId, coverage: "OSDE", mode: "otro" }))).toMatchObject({ ok: false });
    expect(await protocol.addCoverageRule({}, form({ clinic_id: clinicId, coverage: "OSDE", mode: "copago", copay: "mucho" }))).toMatchObject({ ok: false });
    expect(await protocol.addCoverageRule({}, form({ clinic_id: clinicId, coverage: "OSDE", mode: "acepta", appointment_type_id: "00000000-0000-4000-8000-000000000999" })))
      .toMatchObject({ ok: false, message: expect.stringContaining("no es de esta clínica") });
    expect(await protocol.addCoverageRule({}, form({ clinic_id: clinicId, coverage: "OSDE", plan: "210", mode: "copago", copay: "$5.000", requires_authorization: "on" }))).toMatchObject({ ok: true });
    const [saved] = await sql`select * from coverage_rules where clinic_id = ${clinicId}`;
    expect(saved).toMatchObject({ coverage: "OSDE", plan: "210", mode: "copago", copay: "5000.00", requires_authorization: true });
    expect(await protocol.saveCoverageRule({}, form({ clinic_id: clinicId, id: saved.id, coverage: "OSDE", mode: "reintegro", copay: "5000" }))).toMatchObject({ ok: true });
    expect((await sql`select mode, copay, plan from coverage_rules where id = ${saved.id}`)[0]).toEqual({ mode: "reintegro", copay: null, plan: null });
    await protocol.deleteCoverageRule(form({ clinic_id: clinicId, id: saved.id }));
    expect(await sql`select id from coverage_rules where clinic_id = ${clinicId}`).toHaveLength(0);

    // Prestaciones: la previa no puede ser ella misma ni pedirse en círculo.
    const base = { clinic_id: clinicId, name: "Colocación de implantes", specialty: "Odontología", duration_min: "90", protocol_fields: "1" };
    expect(await actions.saveAppointmentTypeWithFeedback({}, form({ ...base, id: colocacion, requires_type_id: colocacion }))).toMatchObject({ ok: false });
    expect(await actions.saveAppointmentTypeWithFeedback({}, form({ ...base, id: colocacion, requires_type_id: implantConsult, price_mode: "desde", ask_before: "¿Tiene estudios?", is_urgent: "", }))).toMatchObject({ ok: true });
    expect(await actions.saveAppointmentTypeWithFeedback({}, form({ clinic_id: clinicId, id: implantConsult, name: "Consulta de implantes", specialty: "Odontología", duration_min: "30", protocol_fields: "1", requires_type_id: colocacion })))
      .toMatchObject({ ok: false, message: expect.stringContaining("una a la otra") });
    expect((await sql`select requires_type_id, price_mode, ask_before, agent_can_reschedule, is_urgent from appointment_types where id = ${colocacion}`)[0])
      .toEqual({ requires_type_id: implantConsult, price_mode: "desde", ask_before: "¿Tiene estudios?", agent_can_reschedule: false, is_urgent: false });
    // Un formulario sin esos campos (otra pantalla, un guardado viejo) no los toca.
    expect(await actions.saveAppointmentTypeWithFeedback({}, form({ clinic_id: clinicId, id: colocacion, name: "Colocación de implantes", specialty: "Odontología", duration_min: "90" }))).toMatchObject({ ok: true });
    expect((await sql`select requires_type_id, agent_can_reschedule from appointment_types where id = ${colocacion}`)[0]).toEqual({ requires_type_id: implantConsult, agent_can_reschedule: false });
    await sql`update appointment_types set requires_type_id = null, price_mode = 'referencia', ask_before = null, agent_can_reschedule = true where id = ${colocacion}`;

    // Profesionales: qué prestaciones hacen.
    const pro = { clinic_id: clinicId, id: beto, full_name: "Dr. Beto Prueba", specialty: "Odontología", accepted_coverages: "Swiss Medical, Particular" };
    expect(await actions.saveProfessionalWithFeedback({}, form({ ...pro, types_field: "1", appointment_type_ids: [conducto, limpieza, "no-es-un-id"] }))).toMatchObject({ ok: true });
    const links = async () => (await sql`select appointment_type_id from professional_appointment_types where professional_id = ${beto}`).map((r) => r.appointment_type_id).sort();
    expect(await links()).toEqual([conducto, limpieza].sort());
    expect(await actions.saveProfessionalWithFeedback({}, form(pro))).toMatchObject({ ok: true });
    expect(await links()).toHaveLength(2);
    expect(await actions.saveProfessionalWithFeedback({}, form({ ...pro, types_field: "1" }))).toMatchObject({ ok: true });
    expect(await links()).toEqual([]);

    // Horarios: solo urgencias y solo algunas prestaciones (ids ajenos se ignoran).
    await actions.addSchedule(form({ clinic_id: clinicId, professional_id: beto, weekday: ["1", "3"], start_time: "19:00", end_time: "21:00", urgent_only: "on", appointment_type_ids: [urgencia, "00000000-0000-4000-8000-000000000999"] }));
    const added = await sql`select weekday, urgent_only, appointment_type_ids from schedules where professional_id = ${beto} and start_time = '19:00' order by weekday`;
    expect(added).toEqual([{ weekday: 1, urgent_only: true, appointment_type_ids: [urgencia] }, { weekday: 3, urgent_only: true, appointment_type_ids: [urgencia] }]);
    await sql`delete from schedules where professional_id = ${beto} and start_time = '19:00'`;

    // Plantilla desde Prestaciones.
    expect(await protocol.loadDentalTemplate({}, form({ clinic_id: clinicId }))).toMatchObject({ ok: true, message: expect.stringContaining("Se sumaron") });
    expect(await protocol.loadDentalTemplate({}, form({ clinic_id: clinicId }))).toMatchObject({ ok: true, message: "Ya tenías todas las prestaciones de la plantilla." });
    await sql`delete from appointment_types where clinic_id = ${clinicId} and id not in (${consulta}, ${limpieza}, ${conducto}, ${implantConsult}, ${colocacion}, ${urgencia})`;
  });

  it("las pantallas nuevas del panel se ven con datos reales", async () => {
    await sql`insert into coverage_rules (clinic_id, coverage, plan, mode, copay) values (${clinicId}, 'OSDE', '210', 'copago', 5000)`;
    await sql`insert into professional_appointment_types (professional_id, appointment_type_id) values (${ana}, ${consulta})`;
    await sql`insert into schedules (professional_id, weekday, start_time, end_time, urgent_only) values (${ana}, 1, '19:00', '20:00', true)`;
    try {
      const render = async (path: string) => renderToStaticMarkup((await (await import(`@/app/panel/(app)/configuracion/${path}/page`)).default()) as React.ReactElement);
      const rules = await render("turnos");
      expect(rules).toContain("Mover y cancelar turnos");
      expect(rules).toContain("Protocolo odontológico de Turnia");
      expect(rules).toContain("Qué hacer ante una urgencia");
      expect(rules).toContain("Si el paciente no contesta");
      const coverage = await render("coberturas");
      expect(coverage).toContain("La acepta con copago");
      expect(coverage).toContain("IOMA");
      const services = await render("prestaciones");
      expect(services).toContain("Plantilla odontológica");
      expect(services).toContain("Cómo dice el precio");
      expect(services).not.toContain("Control periódico (meses)");
      expect(services).toContain("urgencia");
      const team = await render("equipo");
      expect(team).toContain("hace Consulta");
      expect(team).not.toContain("Coberturas del profesional");
      expect(team).toContain("Qué prestaciones hace");
      expect(team).toContain("Solo urgencias");
      const probar = renderToStaticMarkup((await (await import("@/app/panel/(app)/probar/page")).default()) as React.ReactElement);
      expect(probar).toContain("Casos odontológicos");
    } finally {
      await sql`delete from coverage_rules where clinic_id = ${clinicId}`;
      await sql`delete from professional_appointment_types where professional_id = ${ana}`;
      await sql`delete from schedules where professional_id = ${ana} and start_time = '19:00'`;
    }
  });

  it("Inicio: turnos fuera de horario, su valor y la garantía del primer mes (solo si es cliente)", async () => {
    const { agentBookings, clinicGuarantee } = await import("@/lib/clinic-impact");
    const [p] = await sql`select id from patients where phone = ${plain}`;
    const insert = (createdAt: string, type: string, source = "whatsapp", status = "confirmado") => sql`
      insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, source, created_at)
      values (${clinicId}, ${p.id}, ${ana}, ${type}, ${at(9, "10:00")}::timestamptz + (random() * interval '5 hours'), ${at(9, "16:00")}, ${status}, ${source}, ${createdAt})`;
    await sql`delete from schedules where professional_id = ${beto}`; // un solo horario: 9 a 18
    try {
      await insert(at(-1, "23:30"), consulta);
      await insert(at(-2, "10:30"), consulta);
      await insert(at(-2, "11:00"), limpieza, "telegram");
      await insert(at(-2, "21:00"), consulta, "whatsapp", "cancelado");
      await insert(at(-1, "22:00"), consulta, "panel");
      expect(await agentBookings({ id: clinicId, timezone })).toEqual({ total: 4, outsideHours: 2, value: 80000, priced: 2, kept: 3 });
    } finally {
      await clearAppointments();
      await sql`insert into schedules (professional_id, weekday, start_time, end_time) select ${beto}::uuid, d, '09:00', '18:00' from generate_series(0, 6) d`;
    }

    expect(await clinicGuarantee(clinicId)).toBeNull();
    const [o] = await sql`insert into sales_outreach (code, name, clinic_id, status, account_at) values ('cliente-prueba', 'Dra. Cliente', ${clinicId}, 'cliente', now()) returning id`;
    await sql`insert into sales_outreach_events (outreach_id, kind, detail) values (${o.id}, 'estado', 'cliente')`;
    expect(await clinicGuarantee(clinicId)).toMatchObject({ operationalAt: null, interactions: 0, endsAt: null });
    await sql`insert into conversations (clinic_id, started_at) select ${clinicId}, now() - interval '20 days' + n * interval '1 day' from generate_series(0, 2) n`;
    await sql`insert into conversations (clinic_id, started_at) values (${clinicId}, now() + interval '15 days')`;
    const g = await clinicGuarantee(clinicId);
    expect(g).toMatchObject({ interactions: 3 });
    expect(Date.parse(g!.endsAt!) - Date.parse(g!.operationalAt!)).toBe(30 * 86400_000);
    const home = renderToStaticMarkup((await (await import("@/app/panel/(app)/page")).default()) as React.ReactElement);
    expect(home).toContain("Garantía del primer mes");
    expect(home).toContain("de 50 interacciones");
    expect(home).toContain("fuera de horario");
    expect(home).toContain("Recuperado con campañas");
    await sql`delete from conversations where clinic_id = ${clinicId}`;
  });
});
