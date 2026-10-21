import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/supabase";
import { getClinic, getCatalog, buildDynamicVariables } from "@/lib/clinic";
import { setupAgent } from "@/lib/agent/setup";
import {
  registerPatient, checkAvailability, bookAppointment, listPatientAppointments,
  rescheduleAppointment, cancelAppointment, createTask, joinWaitlist,
} from "@/lib/agent/service";

// Estas pruebas usan exclusivamente un paciente sintético con prefijo web-.
// Nunca envían WhatsApp ni avisos al equipo. Solo corren al pedirlo explícitamente.
vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn(async () => {}) }));

describe.runIf(process.env.RUN_LIVE_INTEGRATION === "true")("integración con la base real", () => {
  const phone = `web-integracion-${randomUUID()}`;
  let clinicId: string;
  let patientId: string | undefined;
  let ctx: { clinicId: string; patientPhone: string; channel: string };

  beforeAll(() => { process.loadEnvFile(".env.local"); });
  afterAll(async () => {
    if (!patientId) return;
    await db().from("tasks").delete().eq("patient_id", patientId);
    const { error } = await db().from("patients").delete().eq("id", patientId).eq("phone", phone);
    if (error) throw new Error(`No se pudo limpiar el paciente sintético: ${error.message}`);
  });

  it("lee catálogo y memoria, reserva, reprograma, crea tareas y cancela sin tocar pacientes reales", async () => {
    const clinic = await getClinic();
    clinicId = clinic.id;
    ctx = { clinicId, patientPhone: phone, channel: "web" };
    const catalog = await getCatalog(clinicId);
    expect(catalog.professionals.length).toBeGreaterThan(0);
    expect(catalog.appointmentTypes.length).toBeGreaterThan(0);

    await registerPatient(ctx, { nombre_completo: "Prueba técnica de integración", cobertura: "Particular" });
    const patient = await db().from("patients").select("id").eq("clinic_id", clinicId).eq("phone", phone).single();
    expect(patient.error).toBeNull();
    patientId = patient.data!.id;
    const variables = await buildDynamicVariables(clinic, phone);
    expect(variables.patient_context).toContain("Prueba técnica de integración");

    const typeId = catalog.appointmentTypes[0].id;
    const availability = await checkAvailability(ctx, { tipo_turno_id: typeId });
    expect(availability.turnos.length).toBeGreaterThan(1);
    const [first, second] = availability.turnos;
    const booked = await bookAppointment(ctx, { tipo_turno_id: typeId, profesional_id: first.profesional_id, inicio: first.inicio });
    expect(booked.ok).toBe(true);
    const listed = await listPatientAppointments(ctx);
    expect(listed.turnos).toHaveLength(1);
    const moved = await rescheduleAppointment(ctx, { turno_id: booked.turno_id, nuevo_inicio: second.inicio, profesional_id: second.profesional_id });
    expect(moved.ok).toBe(true);
    const afterMove = await listPatientAppointments(ctx);
    expect(afterMove.turnos).toHaveLength(1);
    await createTask(ctx, { tipo: "administrativo", titulo: "Prueba técnica sin paciente real" });
    await joinWaitlist(ctx, { tipo_turno_id: typeId });
    const task = await db().from("tasks").select("id").eq("patient_id", patientId!).single();
    expect(task.error).toBeNull();
    await db().from("tasks").delete().eq("id", task.data!.id).eq("patient_id", patientId!);
    const current = await db().from("appointments").select("id").eq("patient_id", patientId!).eq("status", "confirmado").single();
    expect(current.error).toBeNull();
    await cancelAppointment(ctx, { turno_id: current.data!.id });
    expect((await listPatientAppointments(ctx)).turnos).toHaveLength(0);
  }, 90000);

  it.runIf(process.env.SETUP_ELEVENLABS === "true")("configura el agente real y guarda su ID", async () => {
    const result = await setupAgent(await getClinic());
    expect(result.agentId).toBeTruthy();
    expect(result.toolIds).toHaveLength(8);
    const clinic = await getClinic();
    expect(clinic.elevenlabs_agent_id).toBe(result.agentId);
  }, 90000);
});
