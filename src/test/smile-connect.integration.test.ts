import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

const mocks = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  notifyN8n: vi.fn(async () => {}),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.cookies.has(name) ? { name, value: mocks.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void mocks.cookies.set(name, value),
    delete: (name: string) => void mocks.cookies.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/lib/n8n", () => ({ notifyN8n: mocks.notifyN8n }));

const baseUrl = testDatabaseUrl();
const CLINIC = "00000000-0000-4000-8000-000000000001";
const RUIZ = "00000000-0000-4000-8000-0000000000a3";
const LIMPIEZA = "00000000-0000-4000-8000-0000000000b5";

describe.runIf(baseUrl)("integración Smile Connect", () => {
  let sql: typeof import("@/lib/db").sql;
  let service: typeof import("@/lib/agent/service");
  let campaigns: typeof import("@/lib/campaigns");
  let futureDay = "";
  let zoned: typeof import("@/lib/time").zonedTimeToUtc;

  const at = (hhmm: string, dayKey = futureDay) => {
    const [y, m, d] = dayKey.split("-").map(Number);
    const [hh, mm] = hhmm.split(":").map(Number);
    return zoned(y, m, d, hh, mm, "America/Argentina/Buenos_Aires").toISOString();
  };

  beforeAll(async () => {
    const url = await scratchDatabase(baseUrl!, "turnia_test_smile_connect");
    await resetTestDatabase(url);
    vi.stubEnv("DATABASE_URL", url);
    vi.stubEnv("AGENT_TOOLS_SECRET", "secreto-de-prueba");
    vi.stubEnv("SESSION_SECRET", "sesion-de-prueba");
    vi.stubEnv("PANEL_PASSWORD", "clave");
    vi.stubEnv("APP_URL", "https://turnia.example");

    ({ sql } = await import("@/lib/db"));
    service = await import("@/lib/agent/service");
    campaigns = await import("@/lib/campaigns");
    const time = await import("@/lib/time");
    zoned = time.zonedTimeToUtc;

    futureDay = time.addDaysKey(time.localDateKey(new Date(), "America/Argentina/Buenos_Aires"), 5);
    while ([0, 6].includes(new Date(`${futureDay}T12:00:00Z`).getUTCDay())) {
      futureDay = time.addDaysKey(futureDay, 1);
    }

    const { createSessionToken } = await import("@/lib/session");
    mocks.cookies.set("turnia_session", createSessionToken());
  }, 60000);

  afterAll(async () => {
    const { closeDb } = await import("@/lib/db");
    await closeDb();
    vi.unstubAllEnvs();
  });

  it("genera el userscript con clave propia, valida Bearer y permite renovarla", async () => {
    const getScript = (await import("@/app/api/smile-connect/turnia.user.js/route")).GET;
    const syncPost = (await import("@/app/api/smile-connect/sync/route")).POST;
    const { rotateSmileConnectTokenAction } = await import("@/app/panel/calendar-actions");

    const scriptRes = await getScript(new Request(`https://turnia.example/api/smile-connect/turnia.user.js?clinic_id=${CLINIC}`));
    expect(scriptRes.status).toBe(200);
    const scriptText = await scriptRes.text();
    expect(scriptText).toContain("https://turnia.example/api/smile-connect/sync");
    const tokenMatch = /const SECRET = "(sc_[^"]+)"/.exec(scriptText);
    expect(tokenMatch?.[1]).toBeTruthy();
    const token = tokenMatch![1];

    // Con clave incorrecta rechaza con 401
    const badRes = await syncPost(
      new Request("https://turnia.example/api/smile-connect/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer sc_invalida_1234567890" },
        body: JSON.stringify({ appointments: [], events: [] }),
      }),
    );
    expect(badRes.status).toBe(401);

    // Con la clave generada sincroniza en blanco con 200
    const okRes = await syncPost(
      new Request("https://turnia.example/api/smile-connect/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ appointments: [], events: [] }),
      }),
    );
    expect(okRes.status).toBe(200);

    // Al rotar la clave, la anterior deja de valer
    const form = new FormData();
    form.set("clinic_id", CLINIC);
    form.set("rotate", "1");
    expect((await rotateSmileConnectTokenAction(undefined, form)).ok).toBe(true);

    const revokedRes = await syncPost(
      new Request("https://turnia.example/api/smile-connect/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ appointments: [], events: [] }),
      }),
    );
    expect(revokedRes.status).toBe(401);
  });

  it("importa pacientes, sobreturnos y bloqueos sin tocar horarios semanales, y Sofi respeta todo", async () => {
    const { syncSmileConnect } = await import("@/lib/smile-connect");
    const { getClinic } = await import("@/lib/clinic");

    const schedulesBefore = await sql`select id, weekday, start_time, end_time from schedules where professional_id = ${RUIZ} order by weekday, start_time`;

    // Mañana entre las 12 y 36h para probar que Whatsapp Sent no vuelve a mandar recordatorio
    const tomorrow = new Date(Date.now() + 24 * 3600_000);
    const tomorrowStart1 = new Date(Math.ceil(tomorrow.getTime() / 1800_000) * 1800_000).toISOString();
    const tomorrowEnd1 = new Date(new Date(tomorrowStart1).getTime() + 30 * 60_000).toISOString();
    const tomorrowStart2 = new Date(new Date(tomorrowStart1).getTime() + 60 * 60_000).toISOString();
    const tomorrowEnd2 = new Date(new Date(tomorrowStart2).getTime() + 30 * 60_000).toISOString();

    const exportPayload = {
      clinica: {
        professionals: [
          { professional_id: 335, name: "Carolina", surname: "Ruiz", active: true, box_id: 1 },
          { professional_id: 634, name: "Lara", surname: "Nueva", active: true, box_id: 2 },
        ],
        boxes: [
          { box_id: 1, name: "Consultorio 1" },
          { box_id: 2, name: "Consultorio 2" },
        ],
      },
      pacientes: [
        // Dos fichas duplicadas en Smile Connect de la misma persona -> se unifican en 1 ficha de Turnia
        {
          lista: { patient_id: 1001, name: "Lucía", surname: "Duplicada", phone_number: "1167770001", phone_country_code: "AR" },
          ficha: { patient_id: 1001, name: "Lucía", surname: "Duplicada", id_number: "32100200", sex: "female" },
        },
        {
          lista: { patient_id: 1002, name: "Lucia", surname: "Duplicada", phone_number: "1167770001", phone_country_code: "AR" },
          ficha: { patient_id: 1002, name: "Lucia", surname: "Duplicada", id_number: "32100200", email: "lucia@example.com" },
        },
        // Otro paciente distinto para probar sobreturno real a las 10:00
        {
          lista: { patient_id: 1003, name: "Martín", surname: "Sobreturno", phone_number: "1167770002", phone_country_code: "AR" },
          ficha: { patient_id: 1003, name: "Martín", surname: "Sobreturno", id_number: "33100200", sex: "male" },
        },
      ],
      turnos: [
        // Sobreturno real: Lucía (1001) y Martín (1003) ambos a las 10:00 con Dra. Ruiz (335)
        {
          appointment_id: 9001,
          start_date: at("10:00"),
          end_date: at("10:30"),
          patient_id: 1001,
          professional_ids: [335, 634],
          patient_attended: "Whatsapp Sent",
          notes: "Cirugía guiada",
          box_id: 1,
          created_at: new Date().toISOString(),
        },
        {
          appointment_id: 9002,
          start_date: at("10:00"),
          end_date: at("10:30"),
          patient_id: 1003,
          professional_ids: [335],
          patient_attended: null,
          notes: "Urgencia control",
          box_id: 2,
          created_at: new Date().toISOString(),
        },
        // Turnos de mañana para verificar recordatorios: 9003 ya tiene Whatsapp Sent, 9004 no
        {
          appointment_id: 9003,
          start_date: tomorrowStart1,
          end_date: tomorrowEnd1,
          patient_id: 1002,
          professional_ids: [335],
          patient_attended: "Whatsapp Sent",
          notes: "Control",
          created_at: new Date().toISOString(),
        },
        {
          appointment_id: 9004,
          start_date: tomorrowStart2,
          end_date: tomorrowEnd2,
          patient_id: 1003,
          professional_ids: [335],
          patient_attended: null,
          notes: "Limpieza dental",
          created_at: new Date().toISOString(),
        },
      ],
      bloqueos_agenda: [
        {
          event_id: 501,
          name: "outOfService",
          type: "outOfService",
          start_date: at("15:00"),
          end_date: at("17:00"),
          professional_id: 335,
          notes: "Congreso",
        },
      ],
    };

    const { summary } = await syncSmileConnect(CLINIC, exportPayload, { mode: "import", actor: "Prueba" });
    expect(summary).toMatchObject({
      patientsCreated: 2,
      appointmentsCreated: 4,
      blocksCreated: 1,
      professionalsCreated: 1,
    });
    expect(mocks.notifyN8n).not.toHaveBeenCalled();

    // Reimportar el mismo archivo es idempotente y no duplica fichas, turnos ni bloqueos
    const { summary: reimport } = await syncSmileConnect(CLINIC, exportPayload, { mode: "import", actor: "Prueba" });
    expect(reimport).toMatchObject({
      patientsCreated: 0,
      appointmentsCreated: 0,
      blocksCreated: 0,
      professionalsCreated: 0,
    });

    // Los horarios semanales de Dra. Ruiz no se tocaron
    const schedulesAfter = await sql`select id, weekday, start_time, end_time from schedules where professional_id = ${RUIZ} order by weekday, start_time`;
    expect(schedulesAfter).toEqual(schedulesBefore);

    // Los dos IDs externos de Lucía apuntan a la misma ficha unificada
    const extRows = await sql<Array<{ external_id: string; patient_id: string }>>`
      select external_id, patient_id from patient_external_ids where clinic_id = ${CLINIC} and external_id in ('sc:1001', 'sc:1002')`;
    expect(extRows).toHaveLength(2);
    expect(extRows[0].patient_id).toBe(extRows[1].patient_id);

    // Los dos turnos superpuestos a las 10:00 quedaron guardados como sobreturno
    const overlapRows = await sql`
      select id from appointments where clinic_id = ${CLINIC} and professional_id = ${RUIZ} and starts_at = ${at("10:00")} and status = 'confirmado'`;
    expect(overlapRows).toHaveLength(2);

    // Sofi NO ofrece las 10:00 (ocupado) ni las 15:00-17:00 (bloqueado por Smile Connect), y NO puede superponer
    const sofiCtx = { clinicId: CLINIC, patientPhone: "5491167770099", channel: "whatsapp" };
    await service.registerPatient(sofiCtx, { nombre_completo: "Sofi Cliente" });
    const avail = await service.checkAvailability(sofiCtx, { tipo_turno_id: LIMPIEZA, profesional_id: RUIZ, desde: futureDay, hasta: futureDay });
    const starts = avail.turnos.map((t) => t.inicio);
    expect(starts).not.toContain(at("10:00"));
    expect(starts).not.toContain(at("15:00"));
    await expect(
      service.bookAppointment(sofiCtx, { tipo_turno_id: LIMPIEZA, profesional_id: RUIZ, inicio: at("10:00") }),
    ).rejects.toBeInstanceOf(service.ToolError);

    // Audiencia de recordatorios: incluye 9004 (sin Whatsapp Sent) y excluye 9003 (con Whatsapp Sent)
    const clinic = await getClinic(CLINIC);
    const reminders = await campaigns.computeAudience(clinic, "recordatorio");
    const phonesToRemind = reminders.map((m) => m.phone);
    expect(phonesToRemind).toContain("5491167770002");
    expect(phonesToRemind).not.toContain("5491167770001");
  });

  it("respeta cancelaciones hechas por Sofi, adopta turnos dados en Turnia y da de baja los borrados en ventana en vivo", async () => {
    const { syncSmileConnect } = await import("@/lib/smile-connect");

    // 1) Lucía cancela su turno 9001 con Sofi por WhatsApp
    const luciaCtx = { clinicId: CLINIC, patientPhone: "5491167770001", channel: "whatsapp" };
    const luciaList = await service.listPatientAppointments(luciaCtx);
    const appt9001 = luciaList.turnos.find((t) => t.inicio === at("10:00"))!;
    expect(appt9001).toBeTruthy();
    await service.cancelAppointment(luciaCtx, { turno_id: appt9001.turno_id, motivo: "viaje" });

    // 2) Lucía reserva con Sofi un turno nuevo a las 11:00
    const bookedBySofi = await service.bookAppointment(luciaCtx, {
      tipo_turno_id: LIMPIEZA,
      profesional_id: RUIZ,
      inicio: at("11:00"),
    });

    // 3) En Smile Connect: 9001 sigue igual (recepción aún no lo borró), 9002 desapareció (se borró en Smile Connect),
    //    y recepción copió a mano el turno de las 11:00 de Lucía como appointment_id 9099.
    const windowFrom = at("00:00");
    const windowTo = at("23:59");
    const livePayload = {
      from: windowFrom,
      to: windowTo,
      metadata: {
        professionals: [{ professional_id: 335, name: "Carolina", surname: "Ruiz", active: true }],
        boxes: [{ box_id: 1, name: "Consultorio 1" }],
      },
      appointments: [
        {
          appointment_id: 9001,
          start_date: at("10:00"),
          end_date: at("10:30"),
          patient_id: 1001,
          professional_ids: [335, 634],
          patient_attended: "Whatsapp Sent",
          notes: "Cirugía guiada",
          box_id: 1,
        },
        {
          appointment_id: 9099,
          start_date: at("11:00"),
          end_date: at("11:40"),
          patient_id: 1001,
          professional_ids: [335],
          patient_attended: "Whatsapp Sent",
          patient_name: "Lucía",
          patient_surname: "Duplicada",
          patient_phone_number: "1167770001",
          patient_phone_country_code: "AR",
        },
      ],
      events: [],
    };

    const { summary } = await syncSmileConnect(CLINIC, livePayload, { mode: "live" });
    // 9002 pasó a cancelado y el bloqueo 501 se eliminó; 9099 adoptó el turno de Sofi sin duplicarlo
    expect(summary.appointmentsCancelled).toBe(1);
    expect(summary.blocksDeleted).toBe(1);
    expect(summary.appointmentsCreated).toBe(0);

    const [row9001] = await sql<Array<{ status: string }>>`select status from appointments where id = ${appt9001.turno_id}`;
    expect(row9001.status).toBe("cancelado");

    const [row9002] = await sql<Array<{ status: string }>>`select status from appointments where clinic_id = ${CLINIC} and external_id = 'sc:9002'`;
    expect(row9002.status).toBe("cancelado");

    const at1100 = await sql<Array<{ id: string; source: string; external_id: string }>>`
      select id, source, external_id from appointments where clinic_id = ${CLINIC} and starts_at = ${at("11:00")} and status = 'confirmado'`;
    expect(at1100).toEqual([{ id: bookedBySofi.turno_id, source: "whatsapp", external_id: "sc:9099" }]);
  });
});
