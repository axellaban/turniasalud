import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDaysKey, localDateKey } from "@/lib/time";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Acceso total por WhatsApp para el equipo del consultorio (Configuración → Consultorio): Sofi ve
// la agenda y los pacientes y cambia cualquier turno, pero solo si el número llega por WhatsApp.

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
// Números ficticios.
const doctor = "5491100009999";
const patientPhone = "5491100009001";
const otherPhone = "5491100009002";
const form = (data: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
};

type Result = Record<string, unknown> & { ok: boolean; error?: string };

describe.runIf(url)("acceso total por WhatsApp para el equipo del consultorio", () => {
  let sql: typeof import("@/lib/db").sql;
  let handler: typeof import("@/app/api/agent/tools/[name]/route").POST;
  let clinicId: string, pro: string, control: string, implant: string, otherPatient: string, otherAppointment: string;

  async function tool(name: string, input: Record<string, unknown> = {}, phone = doctor, canal = "custom", conversation = "conv-equipo"): Promise<Result> {
    const request = new Request(`https://turnia.test/api/agent/tools/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-turnia-secret": secret },
      body: JSON.stringify({ clinic_id: clinicId, patient_phone: phone, canal, conversation_id: conversation, ...input }),
    });
    return (await handler(request, { params: Promise.resolve({ name }) })).json();
  }

  beforeAll(async () => {
    const db = await scratchDatabase(url!, "turnia_staff_test");
    await resetTestDatabase(db);
    for (const [k, v] of Object.entries({ DATABASE_URL: db, AGENT_TOOLS_SECRET: secret, SESSION_SECRET: "test-session", APP_URL: "https://turnia.test" })) vi.stubEnv(k, v);
    ({ sql } = await import("@/lib/db"));
    ({ POST: handler } = await import("@/app/api/agent/tools/[name]/route"));
    [{ id: clinicId }] = await sql`
      insert into clinics (name, specialty, is_demo, retained_at, cancel_notice_hours, reschedule_notice_hours, reception_only_terms)
      values ('Consultorio con equipo', 'Odontología', true, now(), 48, 48, 'implante') returning id`;
    [{ id: pro }] = await sql`insert into professionals (clinic_id, full_name, specialty) values (${clinicId}, 'Dr. Prueba', 'Odontología') returning id`;
    await sql`insert into schedules (professional_id, weekday, start_time, end_time) select ${pro}::uuid, d, '09:00', '18:00' from generate_series(0, 6) d`;
    [{ id: control }, { id: implant }] = await sql`
      insert into appointment_types (clinic_id, name, specialty, duration_min, panel_only) values
      (${clinicId}, 'Control', 'Odontología', 30, false), (${clinicId}, 'Colocación de implante', 'Odontología', 90, true) returning id`;
    [{ id: otherPatient }] = await sql`
      insert into patients (clinic_id, phone, full_name, dni, coverage) values
      (${clinicId}, ${otherPhone}, 'Marta Paciente', '30999888', 'OSDE') returning id`;
    await sql`insert into patients (clinic_id, phone, full_name, dni) values (${clinicId}, ${patientPhone}, 'Pedro Paciente', '30999777')`;
    // Un turno de otra persona, mañana (dentro del aviso mínimo de 48 horas).
    [{ id: otherAppointment }] = await sql`
      insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, source)
      values (${clinicId}, ${otherPatient}, ${pro}, ${implant}, ${at(1, "10:00")}, ${at(1, "11:30")}, 'confirmado', 'panel') returning id`;
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

  it("solo Turnia da el acceso, con el celular normalizado, y sin el acceso Sofi trata al número como paciente", async () => {
    const actions = await import("@/app/panel/protocol-actions");
    expect(await tool("ver_agenda")).toMatchObject({ ok: false, error: expect.stringContaining("solo para el equipo") });
    expect(await actions.addStaffPhone({}, form({ clinic_id: clinicId, name: "", phone: "11 0000-9999" }))).toMatchObject({ ok: false });
    expect(await actions.addStaffPhone({}, form({ clinic_id: clinicId, name: "Dr. Prueba", phone: "123" }))).toMatchObject({ ok: false });
    expect(await actions.addStaffPhone({}, form({ clinic_id: clinicId, name: "Dr. Prueba", phone: "11 0000-9999" })))
      .toMatchObject({ ok: true, message: expect.stringContaining("ya tiene acceso total") });
    expect(await actions.addStaffPhone({}, form({ clinic_id: clinicId, name: "Dr. Mariano Prueba", phone: "+54 9 11 0000-9999" })))
      .toMatchObject({ ok: true, message: expect.stringContaining("Actualizado") });
    expect(await sql`select phone, name from clinic_staff_phones where clinic_id = ${clinicId}`).toEqual([{ phone: doctor, name: "Dr. Mariano Prueba" }]);
  });

  it("por WhatsApp ve la agenda entera y busca pacientes; un paciente o una llamada, no", async () => {
    const agenda = await tool("ver_agenda", { desde: day(1) });
    expect(agenda).toMatchObject({ ok: true, turnos: [expect.objectContaining({ turno_id: otherAppointment, paciente: "Marta Paciente", prestacion: "Colocación de implante" })] });
    expect(await tool("buscar_pacientes", { texto: "marta" })).toMatchObject({
      ok: true,
      pacientes: [expect.objectContaining({ paciente_id: otherPatient, dni: "30999888", proximos_turnos: [expect.objectContaining({ turno_id: otherAppointment })] })],
    });
    // Un paciente cualquiera no puede.
    expect(await tool("ver_agenda", {}, patientPhone)).toMatchObject({ ok: false, error: expect.stringContaining("solo para el equipo") });
    expect(await tool("ver_turnos_paciente", { paciente_id: otherPatient }, patientPhone)).toMatchObject({ ok: false, error: expect.stringContaining("solo para el equipo") });
    // Por teléfono el número de quien llama se puede falsear; por la web no hay número verificado.
    expect(await tool("ver_agenda", {}, doctor, "twilio", "conv-llamada")).toMatchObject({ ok: false });
    expect(await tool("ver_agenda", {}, doctor, "web", "conv-web")).toMatchObject({ ok: false });
    // Sin canal informado, vale si la conversación la abrió nuestra línea de WhatsApp para ese número.
    expect(await tool("ver_agenda", {}, doctor, "", "conv-sin-canal")).toMatchObject({ ok: false });
    await sql`insert into channel_conversations (clinic_id, phone, chat_id, elevenlabs_conversation_id) values (${clinicId}, ${doctor}, ${`${doctor}@c.us`}, 'conv-sin-canal')`;
    expect(await tool("ver_agenda", {}, doctor, "", "conv-sin-canal")).toMatchObject({ ok: true });
  });

  it("cambia turnos de cualquier paciente como el consultorio, sin las reglas de recepción", async () => {
    // Un paciente no puede tocar el turno de otro.
    expect(await tool("cancelar_turno", { turno_id: otherAppointment }, patientPhone)).toMatchObject({ ok: false, error: expect.stringContaining("para este paciente") });
    // El equipo mueve una colocación de implante (la da solo el consultorio, la mueve recepción y faltan menos de 48 horas).
    const offers = await tool("consultar_disponibilidad", { turno_id: otherAppointment, desde: day(3), hasta: day(3) });
    expect(offers).toMatchObject({ ok: true, duracion_min: 90 });
    const moved = await tool("reprogramar_turno", { turno_id: otherAppointment, nuevo_inicio: (offers.turnos as Array<{ inicio: string }>)[0].inicio });
    expect(moved).toMatchObject({ ok: true });
    const [row] = await sql`select patient_id, source, status from appointments where id = ${moved.turno_id as string}`;
    expect(row).toEqual({ patient_id: otherPatient, source: "panel", status: "confirmado" });
    // Y le da un turno a otra persona, también de lo que da solo el consultorio.
    const slots = await tool("consultar_disponibilidad", { tipo_turno_id: implant, paciente_id: otherPatient, desde: day(4), hasta: day(4) });
    expect(slots).toMatchObject({ ok: true });
    const booked = await tool("reservar_turno", { tipo_turno_id: implant, profesional_id: pro, inicio: (slots.turnos as Array<{ inicio: string }>)[0].inicio, paciente_id: otherPatient });
    expect(booked).toMatchObject({ ok: true });
    expect((await sql`select patient_id from appointments where id = ${booked.turno_id as string}`)[0].patient_id).toBe(otherPatient);
    expect(await tool("ver_turnos_paciente", { paciente_id: otherPatient })).toMatchObject({ ok: true, turnos: expect.arrayContaining([expect.objectContaining({ turno_id: booked.turno_id })]) });
    expect(await tool("reservar_turno", { tipo_turno_id: control, profesional_id: pro, inicio: at(5, "10:00"), paciente_id: "00000000-0000-4000-8000-000000000999" }))
      .toMatchObject({ ok: false, error: expect.stringContaining("No encontré ese paciente") });
    // Cancela aunque falten menos de 48 horas: el consultorio decide.
    const soon = await tool("reservar_turno", { tipo_turno_id: control, profesional_id: pro, inicio: at(1, "15:00"), paciente_id: otherPatient });
    expect(soon).toMatchObject({ ok: true });
    expect(await tool("cancelar_turno", { turno_id: soon.turno_id })).toMatchObject({ ok: true });
  });

  it("crea fichas, bloquea la agenda y resuelve pedidos al equipo", async () => {
    const created = await tool("crear_paciente", { nombre_completo: "Nueva Paciente", dni: "41000111", celular: "11 0000-9003" });
    expect(created).toMatchObject({ ok: true, paciente_id: expect.any(String) });
    expect(await tool("crear_paciente", { nombre_completo: "Nueva Paciente", dni: "41000111" })).toMatchObject({ ok: true, paciente_id: created.paciente_id, mensaje: expect.stringContaining("Ya tenía ficha") });
    expect((await sql`select phone, dni from patients where id = ${created.paciente_id as string}`)[0]).toEqual({ phone: "5491100009003", dni: "41000111" });

    const blocked = await tool("bloquear_agenda", { desde: day(6), motivo: "Congreso" });
    expect(blocked).toMatchObject({ ok: true, mensaje: expect.stringContaining("Agenda bloqueada") });
    expect(await sql`select reason from schedule_blocks where clinic_id = ${clinicId}`).toEqual([{ reason: "Congreso" }]);
    expect((await tool("consultar_disponibilidad", { tipo_turno_id: control, desde: day(6), hasta: day(6) }, patientPhone)).turnos).toEqual([]);

    const [task] = await sql`insert into tasks (clinic_id, patient_id, type, priority, title) values (${clinicId}, ${otherPatient}, 'receta', 'alta', 'Renovar receta') returning id`;
    expect(await tool("ver_tareas")).toMatchObject({ ok: true, tareas: [expect.objectContaining({ tarea_id: task.id, titulo: "Renovar receta", paciente: "Marta Paciente" })] });
    expect(await tool("resolver_tarea", { tarea_id: task.id })).toMatchObject({ ok: true });
    expect((await sql`select status from tasks where id = ${task.id}`)[0].status).toBe("resuelta");
    expect(await tool("ver_tareas", {}, patientPhone)).toMatchObject({ ok: false });
  });

  it("Sofi sabe que es del equipo solo cuando el número llega por WhatsApp, y quitar el acceso lo corta", async () => {
    const clinicLib = await import("@/lib/clinic");
    const clinic = await clinicLib.getClinic(clinicId);
    expect((await clinicLib.buildDynamicVariables(clinic, doctor, { verifiedPhone: true })).patient_context).toContain("EQUIPO DEL CONSULTORIO: este número es de Dr. Mariano Prueba");
    expect((await clinicLib.buildDynamicVariables(clinic, doctor)).patient_context).not.toContain("EQUIPO DEL CONSULTORIO");
    expect((await clinicLib.buildDynamicVariables(clinic, patientPhone, { verifiedPhone: true })).patient_context).not.toContain("EQUIPO DEL CONSULTORIO");

    const actions = await import("@/app/panel/protocol-actions");
    const [{ id, revision }] = await sql`select s.id, c.context_revision as revision from clinic_staff_phones s join clinics c on c.id = s.clinic_id where s.clinic_id = ${clinicId}`;
    await actions.removeStaffPhone(form({ clinic_id: clinicId, id }));
    expect(await sql`select id from clinic_staff_phones where clinic_id = ${clinicId}`).toEqual([]);
    // Cambia la revisión de la ficha: la conversación abierta arranca de nuevo, ya sin el acceso.
    expect((await clinicLib.getClinic(clinicId)).context_revision).toBeGreaterThan(revision);
    expect(await tool("ver_agenda")).toMatchObject({ ok: false, error: expect.stringContaining("solo para el equipo") });
  });
});
