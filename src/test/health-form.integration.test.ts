import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GUERRA_MININNI } from "@/lib/agent/appointment-access";
import { HEALTH_FORM_MARKER } from "@/lib/health-form";
import { addDaysKey, localDateKey } from "@/lib/time";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

const url = testDatabaseUrl();
const clinicId = GUERRA_MININNI;
const otherClinic = "00000000-0000-4000-8000-000000000001";
const timezone = "America/Argentina/Buenos_Aires";
const secret = "turnia-test-secret";
const at = (offset: number, time: string) =>
  new Date(`${addDaysKey(localDateKey(new Date(), timezone), offset + 7)}T${time}:00-03:00`).toISOString();

vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn(async () => {}) }));

describe.runIf(url)("ficha de salud por chat (Guerra–Mininni)", () => {
  let sql: typeof import("@/lib/db").sql;
  let handler: typeof import("@/app/api/agent/tools/[name]/route").POST;
  let pro: string, consult: string, otherPro: string, otherType: string;

  async function tool(name: string, input: Record<string, unknown>, phone: string, channel = "whatsapp", clinic = clinicId) {
    const request = new Request(`https://turnia.test/api/agent/tools/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-turnia-secret": secret },
      body: JSON.stringify({ clinic_id: clinic, patient_phone: phone, canal: channel, ...input }),
    });
    return (await handler(request, { params: Promise.resolve({ name }) })).json();
  }

  async function newPatient(phone: string, name = "Paciente Nueva Prueba") {
    await tool("registrar_paciente", { nombre_completo: name, dni: phone.slice(-8), cobertura: "Particular", fecha_nacimiento: "1990-05-20", email: "prueba@ejemplo.com" }, phone);
  }

  const book = (phone: string, offset: number, channel = "whatsapp") =>
    tool("reservar_turno", { tipo_turno_id: consult, profesional_id: pro, inicio: at(offset, "10:00") }, phone, channel);

  beforeAll(async () => {
    const db = await scratchDatabase(url!, "turnia_health_form_test");
    await resetTestDatabase(db);
    vi.stubEnv("DATABASE_URL", db);
    vi.stubEnv("AGENT_TOOLS_SECRET", secret);
    ({ sql } = await import("@/lib/db"));
    ({ POST: handler } = await import("@/app/api/agent/tools/[name]/route"));
    await sql`insert into clinics (id, name) values (${clinicId}, 'Guerra–Mininni ficticia')`;
    [{ id: pro }] = await sql`
      insert into professionals (clinic_id, full_name, specialty) values (${clinicId}, 'Odontóloga de prueba', 'Odontología') returning id`;
    await sql`
      insert into schedules (professional_id, weekday, start_time, end_time)
      select ${pro}, day, '09:00', '18:00' from generate_series(0, 6) as day`;
    [{ id: consult }] = await sql`
      insert into appointment_types (clinic_id, name, specialty, duration_min) values (${clinicId}, 'Consulta de primera vez', 'Odontología', 30) returning id`;
    [{ id: otherPro }] = await sql`
      insert into professionals (clinic_id, full_name, specialty) values (${otherClinic}, 'Profesional de otra clínica', 'Odontología') returning id`;
    await sql`
      insert into schedules (professional_id, weekday, start_time, end_time)
      select ${otherPro}, day, '09:00', '18:00' from generate_series(0, 6) as day`;
    [{ id: otherType }] = await sql`
      insert into appointment_types (clinic_id, name, specialty, duration_min) values (${otherClinic}, 'Consulta de prueba de ficha', 'Odontología', 30) returning id`;
  }, 60000);

  afterAll(async () => {
    await sql?.end();
  });

  it("a un paciente nuevo le manda la plantilla al confirmar y, en el turno siguiente, solo se la recuerda", async () => {
    const phone = "5491100005001";
    await newPatient(phone);
    const first = await book(phone, 0);
    expect(first.ok).toBe(true);
    expect(first.ficha_de_salud.instrucciones).toMatch(/adelantarse completando la ficha de salud/);
    expect(first.ficha_de_salud.plantilla.startsWith(HEALTH_FORM_MARKER)).toBe(true);
    // Ya sabemos su nombre, DNI, nacimiento, mail y cobertura: no se los pide.
    expect(first.ficha_de_salud.plantilla).not.toMatch(/Apellido:|DNI:|Fecha de nacimiento:|Mail:|Cobertura/);
    expect(first.ficha_de_salud.plantilla).toContain("Domicilio (calle y número):");
    const [row] = await sql`select invited_at, completed_at from patient_health_forms f join patients p on p.id = f.patient_id where p.phone = ${phone}`;
    expect(row.invited_at).not.toBeNull();
    expect(row.completed_at).toBeNull();

    const second = await book(phone, 1);
    expect(second.ficha_de_salud.plantilla).toBeUndefined();
    expect(second.ficha_de_salud.instrucciones).toMatch(/recordale en una línea/);
  });

  it("guarda la ficha por partes, la da por completa y ya no la ofrece", async () => {
    const phone = "5491100005002";
    await newPatient(phone, "Ana Pérez García");
    await book(phone, 2);

    const partial = await tool("guardar_ficha_salud", { hipertension: "si", anticoagulantes: "SI", otros: "Toma enalapril" }, phone);
    expect(partial).toMatchObject({ ok: true, completa: false });
    expect(partial.faltan).toContain("Domicilio");
    expect(partial.plantilla).not.toContain("Hipertensión");
    expect(partial.plantilla).toContain("Anemia:");

    const done = await tool(
      "guardar_ficha_salud",
      { resto_no: true, apellido: "Pérez García", nombres: "Ana", calle: "Av. Colón", numero: "2450", piso: "3", dpto: "B", localidad: "Mar del Plata", bioseguridad: "si" },
      phone,
    );
    expect(done).toMatchObject({ ok: true, completa: true });
    expect(done.mensaje).toMatch(/bioseguridad/);

    const [form] = await sql`
      select f.data, f.completed_at, f.source, p.address from patient_health_forms f join patients p on p.id = f.patient_id where p.phone = ${phone}`;
    expect(form.completed_at).not.toBeNull();
    expect(form.source).toBe("whatsapp");
    expect(form.address).toBe("Av. Colón 2450, piso 3 B, Mar del Plata");
    expect(form.data.respuestas).toMatchObject({ hipertension: "si", anticoagulantes: "si", anemia: "no" });
    expect(Object.keys(form.data.respuestas)).toHaveLength(32);
    expect(form.data).toMatchObject({ apellido: "Pérez García", nombres: "Ana", otros: "Toma enalapril", bioseguridad: "si" });

    // Un turno más: ya la completó, no se la ofrece.
    const again = await book(phone, 3);
    expect(again.ok).toBe(true);
    expect(again.ficha_de_salud).toBeUndefined();
    // Si pide la plantilla, le avisa que ya está completa.
    expect(await tool("guardar_ficha_salud", {}, phone)).toMatchObject({ completa: true, mensaje: expect.stringMatching(/Ya completó la ficha/) });
    // Una corrección se suma a la misma ficha.
    expect(await tool("guardar_ficha_salud", { diabetes: "si" }, phone)).toMatchObject({ completa: true, mensaje: expect.stringMatching(/corregida/) });
    expect(Number((await sql`select count(*) from patient_health_forms f join patients p on p.id = f.patient_id where p.phone = ${phone}`)[0].count)).toBe(1);
  });

  it("a quien la pide le manda la plantilla aunque no haya reservado", async () => {
    const phone = "5491100005003";
    await newPatient(phone);
    const result = await tool("guardar_ficha_salud", {}, phone);
    expect(result).toMatchObject({ ok: true, completa: false });
    expect(result.plantilla.startsWith(HEALTH_FORM_MARKER)).toBe(true);
  });

  it("por teléfono solo avisa que la completa en el consultorio", async () => {
    const phone = "5491100005004";
    await newPatient(phone);
    const result = await book(phone, 4, "twilio");
    expect(result.ficha_de_salud.plantilla).toBeUndefined();
    expect(result.ficha_de_salud.instrucciones).toMatch(/Por teléfono/);
    expect((await sql`select 1 from patient_health_forms f join patients p on p.id = f.patient_id where p.phone = ${phone}`).length).toBe(0);
  });

  it("a quien ya venía al consultorio (tiene la de papel) no se la ofrece", async () => {
    const phone = "5491100005005";
    await newPatient(phone);
    await sql`
      insert into patient_visits (clinic_id, patient_id, service, visited_at)
      select ${clinicId}, id, 'Control', '2025-06-10' from patients where phone = ${phone}`;
    const result = await book(phone, 5);
    expect(result.ok).toBe(true);
    expect(result.ficha_de_salud).toBeUndefined();
  });

  it("si la última ficha tiene más de un año, ofrece actualizarla", async () => {
    const phone = "5491100005006";
    await newPatient(phone);
    await sql`
      insert into patient_health_forms (clinic_id, patient_id, data, completed_at, created_at)
      select ${clinicId}, id, '{"calle":"Rivadavia","localidad":"Miramar"}', now() - interval '400 days', now() - interval '400 days'
      from patients where phone = ${phone}`;
    const result = await book(phone, 6);
    expect(result.ficha_de_salud.instrucciones).toMatch(/más de un año/);
    expect(result.ficha_de_salud.plantilla).toContain("Anemia:");
  });

  it("las clínicas sin ficha de salud no la ofrecen ni la guardan", async () => {
    const phone = "5491100005007";
    await tool("registrar_paciente", { nombre_completo: "Otra Clínica Prueba", dni: "40111222", cobertura: "Particular" }, phone, "whatsapp", otherClinic);
    const booked = await tool("reservar_turno", { tipo_turno_id: otherType, profesional_id: otherPro, inicio: at(7, "11:00") }, phone, "whatsapp", otherClinic);
    expect(booked.ok).toBe(true);
    expect(booked.ficha_de_salud).toBeUndefined();
    expect(await tool("guardar_ficha_salud", { anemia: "no" }, phone, "whatsapp", otherClinic)).toMatchObject({ ok: false });
  });
});
