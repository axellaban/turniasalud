import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDaysKey, localDateKey } from "@/lib/time";
import { SYSTEM_PROMPT } from "@/lib/agent/prompt";
import { DENTAL_PROTOCOL } from "@/lib/agent/modules/odontologia";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Hallazgos de la sesión de pruebas de Sofi (26/11/2026), un caso por punto. Lo que depende del
// modelo (cómo redacta) se prueba con la batería de ElevenLabs (scripts/probar-sofi.mjs); acá, que
// las reglas estén en el prompt y que las herramientas hagan lo que el prompt promete.

const mocks = vi.hoisted(() => ({ notify: vi.fn(async () => true) }));
vi.mock("@/lib/n8n", () => ({ notifyN8n: mocks.notify }));

const url = testDatabaseUrl();
const timezone = "America/Argentina/Buenos_Aires";
const secret = "turnia-test-secret";
const day = (offset: number) => addDaysKey(localDateKey(new Date(), timezone), offset);
const at = (offset: number, time: string) => new Date(`${day(offset)}T${time}:00-03:00`).toISOString();
// Números ficticios.
const familiar = "5491100007001";
const tester = "5491100007002";
const patientPhone = "5491100007003";

type Result = Record<string, unknown> & { ok: boolean; error?: string };

describe("reglas del prompt para los hallazgos (sin base)", () => {
  it("1. no afirma estados de turnos sin una herramienta y valida el día pedido", () => {
    expect(SYSTEM_PROMPT).toContain("Nunca digas que un turno existe, está reservado, confirmado, cancelado o movido si no lo devolvió una herramienta");
    expect(SYSTEM_PROMPT).toContain("nunca \"sigue reservado\" ni \"hasta que lo muevan\"");
    expect(SYSTEM_PROMPT).toContain("Si nombra un día u hora en que no das turnos o el consultorio no atiende");
  });
  it("2. pregunta para quién es antes de usar el historial", () => {
    expect(SYSTEM_PROMPT).toContain("0. Para quién:");
    expect(SYSTEM_PROMPT).toContain("Hasta saberlo, no uses su historial");
  });
  it("3. ofrece la derivación y espera el sí, con datos mínimos", () => {
    expect(SYSTEM_PROMPT).toContain("Creá la tarea \"consulta_clinica\" solo con su sí");
    expect(SYSTEM_PROMPT).toContain("DNI y cobertura, solo para dar un turno");
    expect(SYSTEM_PROMPT).toContain("Una sola tarea por pedido");
  });
  it("4. contesta cada pregunta, también el precio", () => {
    expect(SYSTEM_PROMPT).toContain("Contesta cada una de las preguntas de su mensaje");
    expect(DENTAL_PROTOCOL).toContain("nunca saltees la pregunta");
  });
  it("5. respeta lo que pidió el paciente y ofrece alternativas", () => {
    expect(SYSTEM_PROMPT).toContain("Después de las 18 no hay turnos");
    expect(SYSTEM_PROMPT).toContain("la lista de espera para avisarle si se libera algo antes");
  });
  it("6. usa las palabras del paciente", () => {
    expect(SYSTEM_PROMPT).toContain("Hablá con las palabras del paciente");
  });
  it("8. señales de alarma: guardia ya, sin «si considera»", () => {
    expect(DENTAL_PROTOCOL).toContain("vaya ahora a una guardia o llame al 107");
    expect(DENTAL_PROTOCOL).toContain("Nunca «si considera que es un riesgo para su vida»");
    expect(DENTAL_PROTOCOL).not.toContain("sumá una vez, al final y sin alarmar, esta frase");
  });
  it("9 y 10. contención y diferenciales", () => {
    expect(SYSTEM_PROMPT).toContain("en ese mismo mensaje y antes que nada, una o dos frases de contención");
    expect(SYSTEM_PROMPT).toContain("nombralos en una sola línea y cerrá ofreciendo la consulta de evaluación");
  });
  it("11c. no dice «ya avisé» sin herramienta", () => {
    expect(SYSTEM_PROMPT).toContain("Nunca digas que avisaste, derivaste, anotaste, anulaste");
  });
});

describe.runIf(url)("herramientas para los hallazgos de las pruebas de Sofi", () => {
  let sql: typeof import("@/lib/db").sql;
  let handler: typeof import("@/app/api/agent/tools/[name]/route").POST;
  let clinicLib: typeof import("@/lib/clinic");
  let clinicId: string, pro: string, control: string, graciela: string, appointment: string;

  async function tool(name: string, input: Record<string, unknown> = {}, phone = familiar, conversation = "conv_familiar_1"): Promise<Result> {
    const request = new Request(`https://turnia.test/api/agent/tools/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-turnia-secret": secret },
      body: JSON.stringify({ clinic_id: clinicId, patient_phone: phone, canal: "custom", conversation_id: conversation, ...input }),
    });
    return (await handler(request, { params: Promise.resolve({ name }) })).json();
  }

  beforeAll(async () => {
    const db = await scratchDatabase(url!, "turnia_sofi_hallazgos_test");
    await resetTestDatabase(db);
    for (const [k, v] of Object.entries({ DATABASE_URL: db, AGENT_TOOLS_SECRET: secret, SESSION_SECRET: "test-session", APP_URL: "https://turnia.test" })) vi.stubEnv(k, v);
    ({ sql } = await import("@/lib/db"));
    ({ POST: handler } = await import("@/app/api/agent/tools/[name]/route"));
    clinicLib = await import("@/lib/clinic");
    [{ id: clinicId }] = await sql`
      insert into clinics (name, specialty, is_demo, retained_at, verify_appointment_access, test_phones)
      values ('Consultorio de prueba', 'Odontología', true, now(), true, ${[tester]}) returning id`;
    [{ id: pro }] = await sql`insert into professionals (clinic_id, full_name, specialty) values (${clinicId}, 'Dr. Prueba', 'Odontología') returning id`;
    await sql`insert into schedules (professional_id, weekday, start_time, end_time) select ${pro}::uuid, d, '09:00', '18:00' from generate_series(0, 6) d`;
    [{ id: control }] = await sql`
      insert into appointment_types (clinic_id, name, specialty, duration_min) values (${clinicId}, 'Control', 'Odontología', 30) returning id`;
    [{ id: graciela }] = await sql`
      insert into patients (clinic_id, phone, full_name, dni) values (${clinicId}, '5491100007999', 'Graciela Ejemplo', '20111333') returning id`;
    [{ id: appointment }] = await sql`
      insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, source)
      values (${clinicId}, ${graciela}, ${pro}, ${control}, ${at(3, "10:00")}, ${at(3, "10:30")}, 'confirmado', 'panel') returning id`;
  }, 60000);

  beforeEach(() => mocks.notify.mockClear());
  afterAll(async () => {
    await sql?.end();
  });

  describe("7. un familiar ubica el turno sin DNI", () => {
    it("con el nombre y el día (y la hora) del turno, da el permiso solo para gestionar turnos", async () => {
      const found = await tool("buscar_paciente", { nombre_completo: "Graciela Ejemplo", fecha_turno: day(3), hora_turno: "10:00", para_turno_existente: true });
      expect(found).toMatchObject({ ok: true, encontrado: true, solo_turnos: true });
      const turnos = await tool("ver_turnos_paciente");
      expect(JSON.stringify(turnos)).toContain(appointment);
    });

    it("si no hay turno ese día no dice que existe (1: no afirmar estados)", async () => {
      const missing = await tool("buscar_paciente", { nombre_completo: "Graciela Ejemplo", fecha_turno: day(4), para_turno_existente: true }, familiar, "conv_familiar_2");
      expect(missing).toMatchObject({ ok: true, encontrado: false });
      expect(String(missing.mensaje)).toContain("No digas que el turno existe ni que sigue reservado");
    });

    it("pide el DNI si hay dos pacientes con ese nombre ese día", async () => {
      const [{ id: other }] = await sql`
        insert into patients (clinic_id, phone, full_name, dni) values (${clinicId}, '5491100007998', 'Graciela Ejemplo', '20111444') returning id`;
      await sql`
        insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, source)
        values (${clinicId}, ${other}, ${pro}, ${control}, ${at(3, "11:00")}, ${at(3, "11:30")}, 'confirmado', 'panel')`;
      const twice = await tool("buscar_paciente", { nombre_completo: "Graciela Ejemplo", fecha_turno: day(3), para_turno_existente: true }, familiar, "conv_familiar_3");
      expect(twice).toMatchObject({ ok: true, encontrado: null });
      expect(String(twice.mensaje)).toContain("DNI");
      // Con la hora, vuelve a ser uno solo.
      const withTime = await tool("buscar_paciente", { nombre_completo: "Graciela Ejemplo", fecha_turno: day(3), hora_turno: "11:00", para_turno_existente: true }, familiar, "conv_familiar_3");
      expect(withTime).toMatchObject({ encontrado: true, solo_turnos: true });
    });

    it("sin el permiso temporal de la clínica, sigue pidiendo el DNI", async () => {
      await sql`update clinics set verify_appointment_access = false where id = ${clinicId}`;
      try {
        const result = await tool("buscar_paciente", { nombre_completo: "Graciela Ejemplo", fecha_turno: day(3), para_turno_existente: true }, familiar, "conv_familiar_4");
        expect(result).toMatchObject({ ok: true, encontrado: null });
        expect(String(result.mensaje)).toContain("DNI");
      } finally {
        await sql`update clinics set verify_appointment_access = true where id = ${clinicId}`;
      }
    });
  });

  describe("11a. anular un pedido de la misma charla", () => {
    it("anula la tarea y avisa a n8n que quedó sin efecto", async () => {
      const created = await tool("crear_tarea", { tipo: "consulta_clinica", titulo: "Consulta de embarazada" }, patientPhone, "conv_paciente_1");
      expect(created.ok).toBe(true);
      const voided = await tool("anular_tarea", { tarea_id: created.tarea_id, motivo: "era una prueba" }, patientPhone, "conv_paciente_1");
      expect(voided).toMatchObject({ ok: true });
      const [task] = await sql`select status, voided_at, details from tasks where id = ${created.tarea_id as string}`;
      expect(task.status).toBe("resuelta");
      expect(task.voided_at).not.toBeNull();
      expect(task.details).toContain("Sin efecto: era una prueba");
      expect(mocks.notify).toHaveBeenCalledWith("tarea.anulada", expect.objectContaining({ motivo: "era una prueba" }));
    });

    it("sin tarea_id anula todos los pedidos de la charla, y no los de otra", async () => {
      await tool("crear_tarea", { tipo: "derivacion_humana", titulo: "Uno" }, patientPhone, "conv_paciente_2");
      await tool("crear_tarea", { tipo: "derivacion_humana", titulo: "Dos" }, patientPhone, "conv_paciente_2");
      const other = await tool("crear_tarea", { tipo: "derivacion_humana", titulo: "Otra charla" }, patientPhone, "conv_paciente_3");
      const voided = await tool("anular_tarea", {}, patientPhone, "conv_paciente_2");
      expect((voided.anuladas as unknown[]).length).toBe(2);
      const [stillOpen] = await sql`select voided_at from tasks where id = ${other.tarea_id as string}`;
      expect(stillOpen.voided_at).toBeNull();
      const none = await tool("anular_tarea", {}, patientPhone, "conv_paciente_4");
      expect(none.ok).toBe(false);
    });
  });

  describe("11b. modo prueba", () => {
    it("las tareas de un tester no le llegan al equipo", async () => {
      const created = await tool("crear_tarea", { tipo: "urgencia", titulo: "Prueba de urgencia" }, tester, "conv_tester_1");
      expect(created).toMatchObject({ ok: true, modo_prueba: true });
      const [task] = await sql`select is_test, status from tasks where id = ${created.tarea_id as string}`;
      expect(task).toMatchObject({ is_test: true, status: "resuelta" });
      expect(mocks.notify).not.toHaveBeenCalledWith("tarea.creada", expect.anything());
    });

    it("las reservas y cancelaciones de un tester no tocan la agenda", async () => {
      const before = await sql`select count(*)::int as n from appointments where clinic_id = ${clinicId}`;
      const booked = await tool("reservar_turno", { tipo_turno_id: control, profesional_id: pro, inicio: at(5, "10:00"), nombre_completo: "Tester Prueba" }, tester, "conv_tester_2");
      expect(booked).toMatchObject({ ok: true, modo_prueba: true });
      const cancelled = await tool("cancelar_turno", { turno_id: appointment }, tester, "conv_tester_2");
      expect(cancelled).toMatchObject({ ok: true, modo_prueba: true });
      const after = await sql`select count(*)::int as n from appointments where clinic_id = ${clinicId}`;
      expect(after[0].n).toBe(before[0].n);
      const [kept] = await sql`select status from appointments where id = ${appointment}`;
      expect(kept.status).toBe("confirmado");
    });
  });

  describe("6. trato como escribe el paciente", () => {
    it("la opción espejo llega al prompt", () => {
      const text = clinicLib.toneText({ tone: "espejo", agent_context: null });
      expect(text).toContain("si vosea o tutea, de vos");
      expect(text).toContain("si usa usted, de usted");
    });
  });
});
