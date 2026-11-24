import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDaysKey, localDateKey } from "@/lib/time";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn(async () => {}) }));

const url = testDatabaseUrl();
const timezone = "America/Argentina/Buenos_Aires";
const doctor = "5491100009999";
const patientPhone = "5491100009001";
const secret = "waitlist-test-secret";
const today = () => localDateKey(new Date(), timezone);
type Entry = { espera_id: string; paciente: string; estado: string; anotado_hoy: boolean; preferencias: string; turno_actual: { turno_id: string } | null };
type Result = { ok: boolean; error?: string; total: number; pagina: number; siguiente_pagina: number | null; pacientes: Entry[] };

describe.runIf(url)("lista de espera actual para el equipo por WhatsApp", () => {
  let sql: typeof import("@/lib/db").sql;
  let handler: typeof import("@/app/api/agent/tools/[name]/route").POST;
  let clinic: string, foreignClinic: string, pro: string, type: string, patient: string, foreignPatient: string;

  async function tool(input: Record<string, unknown> = {}, phone = doctor, canal = "custom", clinicId?: string): Promise<Result> {
    const r = await handler(new Request("https://turnia.test/api/agent/tools/ver_lista_espera", {
      method: "POST", headers: { "content-type": "application/json", "x-turnia-secret": secret },
      body: JSON.stringify({ clinic_id: clinicId ?? clinic, patient_phone: phone, canal, ...input }),
    }), { params: Promise.resolve({ name: "ver_lista_espera" }) });
    return r.json();
  }

  async function entry(status = "activa", created = new Date().toISOString(), appointment: string | null = null) {
    const [row] = await sql`insert into waitlist (clinic_id, patient_id, appointment_type_id, professional_id, status, preferences, created_at, appointment_id)
      values (${clinic}, ${patient}, ${type}, ${pro}, ${status}, 'Lunes o martes antes de las 12', ${created}, ${appointment}) returning id`;
    return row.id as string;
  }

  beforeAll(async () => {
    const db = await scratchDatabase(url!, "turnia_staff_waitlist_test");
    await resetTestDatabase(db);
    vi.stubEnv("DATABASE_URL", db);
    vi.stubEnv("AGENT_TOOLS_SECRET", secret);
    ({ sql } = await import("@/lib/db"));
    ({ POST: handler } = await import("@/app/api/agent/tools/[name]/route"));
    [{ id: clinic }, { id: foreignClinic }] = await sql`insert into clinics (name, specialty, timezone) values
      ('Clínica de prueba', 'Odontología', ${timezone}), ('Otra clínica', 'Odontología', ${timezone}) returning id`;
    [{ id: pro }] = await sql`insert into professionals (clinic_id, full_name, specialty) values (${clinic}, 'Dra. Prueba', 'Odontología') returning id`;
    [{ id: type }] = await sql`insert into appointment_types (clinic_id, name, specialty, duration_min) values (${clinic}, 'Mantenimiento periodontal', 'Odontología', 45) returning id`;
    [{ id: patient }] = await sql`insert into patients (clinic_id, full_name, phone) values (${clinic}, 'Paciente de prueba', ${patientPhone}) returning id`;
    [{ id: foreignPatient }] = await sql`insert into patients (clinic_id, full_name, phone) values (${foreignClinic}, 'Paciente de otra clínica', '5491100009002') returning id`;
    await sql`insert into clinic_staff_phones (clinic_id, phone, name) values (${clinic}, ${doctor}, 'Doctora autorizada')`;
  }, 60000);

  beforeEach(async () => {
    await sql`delete from waitlist where clinic_id in (${clinic}, ${foreignClinic})`;
  });
  afterAll(async () => {
    await (await import("@/lib/db")).closeDb();
    vi.unstubAllEnvs();
  });

  it("solo muestra datos a los números de acceso total de esa clínica y por WhatsApp", async () => {
    await entry();
    expect(await tool()).toMatchObject({ ok: true, total: 1 });
    for (const [phone, canal, clinicId] of [
      [patientPhone, "custom", clinic], [doctor, "twilio", clinic], [doctor, "web", clinic], [doctor, "custom", foreignClinic],
    ]) {
      expect(await tool({}, phone, canal, clinicId)).toMatchObject({ ok: false, error: expect.stringContaining("solo para el equipo") });
    }
    await sql`delete from clinic_staff_phones where clinic_id = ${clinic} and phone = ${doctor}`;
    expect(await tool()).toMatchObject({ ok: false });
    await sql`insert into clinic_staff_phones (clinic_id, phone, name) values (${clinic}, ${doctor}, 'Doctora autorizada')`;
  });

  it("lee altas y cambios en cada llamada; incluye ofrecidas y no confunde una propuesta con una inscripción", async () => {
    expect(await tool()).toMatchObject({ ok: true, total: 0, pacientes: [] });
    // Una propuesta anotada en la memoria todavía no es una inscripción aceptada.
    await sql`update patients set memory_summary = 'Se le preguntó si quiere lista de espera; falta que acepte.' where id = ${patient}`;
    expect(await tool()).toMatchObject({ total: 0 });
    const id = await entry();
    expect(await tool()).toMatchObject({ total: 1, pacientes: [expect.objectContaining({ espera_id: id, anotado_hoy: true, preferencias: 'Lunes o martes antes de las 12' })] });
    await sql`update waitlist set status = 'ofrecida', offered_at = now() where id = ${id}`;
    expect(await tool()).toMatchObject({ total: 1, pacientes: [expect.objectContaining({ estado: 'ofrecida' })] });
    await sql`update waitlist set status = 'resuelta' where id = ${id}`;
    expect(await tool()).toMatchObject({ total: 0 });
    expect(await tool({ estado: "todas" })).toMatchObject({ total: 1, pacientes: [expect.objectContaining({ estado: 'resuelta' })] });
  });

  it("incluye hoy y los días anteriores por defecto, con filtro de altas desde la medianoche de la clínica", async () => {
    const yesterday = await entry("activa", `${today()}T02:59:00Z`); // Ayer 23:59 en Buenos Aires.
    const current = await entry("activa", `${today()}T03:01:00Z`);
    await entry("cancelada");
    await sql`insert into waitlist (clinic_id, patient_id) values (${foreignClinic}, ${foreignPatient})`;
    expect(await tool()).toMatchObject({ total: 2, pacientes: [expect.objectContaining({ espera_id: yesterday, anotado_hoy: false }), expect.objectContaining({ espera_id: current, anotado_hoy: true })] });
    expect(await tool({ desde: today(), profesional_id: pro })).toMatchObject({ total: 1, pacientes: [expect.objectContaining({ espera_id: current })] });
    expect(await tool({ profesional_id: "00000000-0000-4000-8000-000000000099" })).toMatchObject({ ok: false });
    expect(await tool({ pagina: 0 })).toMatchObject({ ok: false });
  });

  it("pagina toda la lista con orden estable y total real, sin cortar a 30 ni perder los de hoy", async () => {
    for (let i = 0; i < 35; i++) await entry("activa", `${today()}T03:01:00Z`);
    const first = await tool();
    const second = await tool({ pagina: first.siguiente_pagina });
    expect(first).toMatchObject({ total: 35, pagina: 1, siguiente_pagina: 2 });
    expect(first.pacientes).toHaveLength(30);
    expect(second).toMatchObject({ total: 35, pagina: 2, siguiente_pagina: null });
    expect(second.pacientes).toHaveLength(5);
    expect(new Set([...first.pacientes, ...second.pacientes].map((r) => r.espera_id)).size).toBe(35);
    expect(await tool({ pagina: 3 })).toMatchObject({ total: 35, pacientes: [] });
  });

  it("conserva el turno existente y deja de listar un adelanto pendiente si ese turno fue cancelado", async () => {
    const date = addDaysKey(today(), 10);
    const [appt] = await sql`insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, source)
      values (${clinic}, ${patient}, ${pro}, ${type}, ${`${date}T10:00:00-03:00`}, ${`${date}T10:45:00-03:00`}, 'confirmado', 'smile_connect') returning id`;
    await entry("activa", new Date().toISOString(), appt.id as string);
    expect(await tool()).toMatchObject({ total: 1, pacientes: [expect.objectContaining({ turno_actual: expect.objectContaining({ turno_id: appt.id }) })] });
    expect((await sql`select status from appointments where id = ${appt.id}`)[0].status).toBe("confirmado");
    await sql`update appointments set status = 'cancelado' where id = ${appt.id}`;
    expect(await tool()).toMatchObject({ total: 0 });
  });
});
