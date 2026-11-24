import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDaysKey, localDateKey } from "@/lib/time";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

const mocks = vi.hoisted(() => ({ alerts: vi.fn(async () => true) }));
vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn(async () => {}) }));
vi.mock("@/lib/chat-guard", async (original) => ({
  ...(await original<typeof import("@/lib/chat-guard")>()), notifyAxel: mocks.alerts,
}));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()), after: vi.fn(),
}));
const url = testDatabaseUrl();
const phone = "5491100008001";
const at = (offset: number) => addDaysKey(localDateKey(new Date(), "America/Argentina/Buenos_Aires"), offset) + "T10:00:00-03:00";

describe.runIf(url)("llamadas y conexión de WhatsApp con proveedores simulados", () => {
  let sql: typeof import("@/lib/db").sql;
  let service: typeof import("@/lib/agent/service");
  let health: typeof import("@/lib/waha-health");
  let clinic: string, patient: string, pro: string, imported: string;
  const connection = { id: "consultorio-ficticio", clinicId: "", phone: "5491100008999", url: "https://waha.test/",
    apiKey: "clave-ficticia-no-publicar", webhookHmac: "firma-ficticia-abc", session: "default", enabled: true, revision: 1 };
  let state = "WORKING", account = connection.phone, fail = false;
  let calls: Array<{ url: string; method: string }> = [];
  let sent: string[] = [];
  const ctx = () => ({ clinicId: clinic, patientPhone: phone, channel: "twilio", conversationId: "conv-ficticia" });
  async function seed(offset = 20, minutes = 60, notes = "Operatoria cervical", who = patient) {
    return (await sql`insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id,
      starts_at, ends_at, status, source, notes, external_id, smile_sync)
      values (${clinic}, ${who}, ${pro}, ${imported}, ${at(offset)}, ${new Date(Date.parse(at(offset)) + minutes * 60000)},
        'confirmado', 'smile_connect', ${notes}, ${"sc:" + (123456 + offset)}, 'ok') returning id`)[0].id as string;
  }
  beforeAll(async () => {
    const db = await scratchDatabase(url!, "turnia_call_feedback_test");
    await resetTestDatabase(db);
    vi.stubEnv("DATABASE_URL", db);
    ({ sql } = await import("@/lib/db"));
    service = await import("@/lib/agent/service");
    health = await import("@/lib/waha-health");
    [{ id: clinic }] = await sql`insert into clinics (name, move_panel_only, keep_duration_on_reschedule,
      reschedule_notice_hours, reschedule_max_minutes, reception_only_terms)
      values ('Consultorio ficticio QA', true, true, 24, 120, 'implante, extracción, exodoncia, regeneración') returning id`;
    [{ id: patient }] = await sql`insert into patients (clinic_id, phone, full_name) values (${clinic}, ${phone}, 'Paciente Ficticio') returning id`;
    [{ id: pro }] = await sql`insert into professionals (clinic_id, full_name, specialty) values (${clinic}, 'Dra. Ficticia', 'Odontología') returning id`;
    [{ id: imported }] = await sql`insert into appointment_types (clinic_id, name, specialty, duration_min, panel_only)
      values (${clinic}, 'Turno Smile Connect', 'Odontología', 30, true) returning id`;
    await sql`insert into schedules (professional_id, weekday, start_time, end_time)
      select ${pro}, d, '09:00', '18:00' from generate_series(0,6) d`;
    connection.clinicId = clinic;
    await sql`update clinics set whatsapp_provider = 'waha' where id = ${clinic}`;
    vi.stubEnv("WAHA_CONNECTIONS", JSON.stringify([connection]));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const u = String(input);
      calls.push({ url: u, method: init.method ?? "GET" });
      if (u === "https://waha.test/api/sendText") {
        sent.push(JSON.parse(String(init.body)).text);
        return Response.json({ id: "mensaje-ficticio" });
      }
      expect(u).toBe("https://waha.test/api/sessions/default");
      expect(new Headers(init.headers).get("x-api-key")).toBe(connection.apiKey);
      if (fail) throw new Error("fallo simulado " + connection.apiKey);
      return Response.json({ status: state, me: { id: account + "@c.us" } });
    }));
  }, 60000);
  beforeEach(async () => {
    await sql`delete from appointments where clinic_id = ${clinic}`;
    await sql`delete from tasks where clinic_id = ${clinic}`;
    await sql`delete from channel_events where key like ${"confirm-call:" + clinic + ":%"}`;
    await sql`delete from waha_connection_health where clinic_id = ${clinic}`;
    await sql`delete from waha_health_events where clinic_id = ${clinic}`;
    state = "WORKING"; account = connection.phone; fail = false; calls = []; sent = []; mocks.alerts.mockClear();
  });
  afterAll(async () => {
    await (await import("@/lib/db")).closeDb();
    vi.unstubAllEnvs(); vi.unstubAllGlobals();
  });

  it("anota una reserva importada en lista de espera sin habilitar altas nuevas ni duplicar la entrada", async () => {
    const id = await seed();
    const args = { turno_id: id, preferencias: "Cualquier horario" };
    const results = await Promise.all([service.joinWaitlist(ctx(), args), service.joinWaitlist(ctx(), args)]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await sql`select appointment_id, appointment_type_id, professional_id from waitlist where patient_id = ${patient}`)
      .toEqual([{ appointment_id: id, appointment_type_id: imported, professional_id: pro }]);
    expect((await sql`select status, ends_at - starts_at as duration from appointments where id = ${id}`)[0].status).toBe("confirmado");
    await expect(service.joinWaitlist(ctx(), { tipo_turno_id: imported })).rejects.toThrow("solo el consultorio");
    expect(calls).toEqual([]);
  });
  it.each([["Implante", 60], ["Extracción dental", 60], ["Operatoria", 121]] as const)(
    "conserva la restricción de %s en la lista de espera", async (notes, duration) => {
      const id = await seed(20, duration, notes);
      await expect(service.joinWaitlist(ctx(), { turno_id: id })).rejects.toThrow("recepción");
      expect(await sql`select id from waitlist where patient_id = ${patient}`).toHaveLength(0);
      expect((await sql`select status from appointments where id = ${id}`)[0].status).toBe("confirmado");
    });
  it("ofrece un adelanto compatible, conserva el vínculo al moverlo y lo cierra al cancelar", async () => {
    const id = await seed(25);
    const [{ id: other }] = await sql`insert into patients (clinic_id, phone, full_name)
      values (${clinic}, '5491100008004', 'Otra Persona Ficticia') returning id`;
    const freed = await seed(24, 60, "Operatoria cervical", other);
    await sql`update appointments set status = 'cancelado' where id = ${freed}`;
    await service.joinWaitlist(ctx(), { turno_id: id });
    const { getClinic } = await import("@/lib/clinic");
    const [row] = await sql<import("@/lib/types").Appointment[]>`select * from appointments where id = ${freed}`;
    expect(await service.offerFreedSlot(await getClinic(clinic), row)).toBe(1);
    expect(sent).toEqual([expect.stringContaining("adelantar su turno")]);
    expect((await sql`select status from appointments where id = ${id}`)[0].status).toBe("confirmado");
    const moved = await service.rescheduleAppointment(ctx(), { turno_id: id, nuevo_inicio: at(24) });
    expect(moved.ok).toBe(true);
    expect((await sql`select appointment_id from waitlist where patient_id = ${patient}`)[0].appointment_id).toBe(moved.turno_id);
    await service.cancelAppointment(ctx(), { turno_id: moved.turno_id! });
    expect((await sql`select status from waitlist where patient_id = ${patient}`)[0].status).toBe("cancelada");
  });
  it("consulta el reemplazo que terminó durante la llamada y no repite la escritura", async () => {
    const id = await seed();
    await sql`update appointments set smile_sync = 'pendiente', smile_management = ${sql.json({ operation: "mover" })} where id = ${id}`;
    let moved = "";
    const complete = new Promise<void>((resolve, reject) => setTimeout(() => {
      sql.begin(async (tx) => {
        await tx`update appointments set status = 'reprogramado', external_id = null, smile_sync = 'ok', smile_management = null where id = ${id}`;
        [{ id: moved }] = await tx`insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id,
          starts_at, ends_at, status, source, external_id, smile_sync)
          values (${clinic}, ${patient}, ${pro}, ${imported}, ${at(21)}, ${new Date(Date.parse(at(21)) + 3600000)},
          'confirmado', 'telefono', 'sc:123456', 'ok') returning id`;
        await tx`update appointments set replaced_by = ${moved} where id = ${id}`;
      }).then(() => resolve(), reject);
    }, 50));
    const result = await service.appointmentManagementStatus(ctx(), { turno_id: id });
    await complete;
    expect(result).toMatchObject({ ok: true, estado: "confirmado", turno_id: moved, profesional: "Dra. Ficticia" });
    expect(result.mensaje).not.toContain("sigue reservado");
    expect(calls).toEqual([]);
    await sql`update appointments set status = 'cancelado' where id = ${moved}`;
    expect(await service.appointmentManagementStatus(ctx(), { turno_id: moved }))
      .toMatchObject({ ok: true, estado: "cancelado", mensaje: expect.stringContaining("Cancelación confirmada") });
    await expect(service.appointmentManagementStatus({ ...ctx(), patientPhone: "5491100008002" }, { turno_id: id }))
      .rejects.toThrow("paciente");
  }, 12000);
  it("si la agenda demora, identifica WhatsApp explícitamente y no promete un aviso por la llamada", async () => {
    const id = await seed();
    await sql`update appointments set smile_sync = 'pendiente' where id = ${id}`;
    const result = await service.appointmentManagementStatus(ctx(), { turno_id: id });
    expect(result).toMatchObject({ pendiente_confirmacion: true, mensaje: expect.stringContaining("WhatsApp") });
    expect(result.mensaje).not.toContain("por acá");
    expect(await sql`select id from tasks where clinic_id = ${clinic}`).toHaveLength(0);
  }, 12000);
  it("si WhatsApp está caído, deja una sola revisión y no promete una confirmación por ese canal", async () => {
    const id = await seed();
    state = "FAILED";
    await sql`update appointments set smile_sync = 'pendiente' where id = ${id}`;
    for (let i = 0; i < 2; i++) expect(await service.appointmentManagementStatus(ctx(), { turno_id: id }))
      .toMatchObject({ pendiente_recepcion: true, mensaje: expect.stringContaining("Recepción tiene el pedido") });
    expect(await sql`select id from tasks where clinic_id = ${clinic}`).toHaveLength(1);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  }, 15000);
  it("detecta caída aunque no entren mensajes, registra transiciones y avisa una vez por hora", async () => {
    await health.monitorClinicWhatsapps();
    state = "FAILED";
    await health.monitorClinicWhatsapps();
    await health.monitorClinicWhatsapps();
    expect(mocks.alerts).toHaveBeenCalledTimes(1);
    expect(await sql`select id from tasks where clinic_id = ${clinic}`).toHaveLength(1);
    state = "WORKING";
    await health.monitorClinicWhatsapps();
    expect((await sql`select status from waha_health_events where clinic_id = ${clinic} order by created_at`).map((e) => e.status))
      .toEqual(["WORKING", "FAILED", "WORKING"]);
    expect((await sql`select status, failure_at, alerted_at from waha_connection_health where clinic_id = ${clinic}`)[0])
      .toEqual({ status: "WORKING", failure_at: null, alerted_at: null });
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });
  it("rechaza una cuenta distinta y guarda errores sin credenciales", async () => {
    account = "5491100008003";
    expect(await health.clinicWhatsappStatus(clinic)).toMatchObject({ ready: false, status: "WRONG_NUMBER" });
    fail = true;
    await health.monitorClinicWhatsapps();
    expect(JSON.stringify(await sql`select * from waha_health_events where clinic_id = ${clinic}`)).not.toContain(connection.apiKey);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });
});
