import { createHmac } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, testDatabaseUrl } from "./db-setup";

// Integración con un Postgres real y descartable (local o el servicio de CI).
// Corre con TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/turnia_test
// No llama a ElevenLabs ni a n8n: esas salidas se reemplazan por espías.

const mocks = vi.hoisted(() => ({
  notifyN8n: vi.fn(async () => {}),
  sendWhatsAppTemplate: vi.fn<(msg: unknown) => Promise<{ conversation_id: string }>>(async () => ({ conversation_id: "conv_saliente" })),
  session: undefined as string | undefined,
}));

vi.mock("@/lib/n8n", () => ({ notifyN8n: mocks.notifyN8n }));
vi.mock("@/lib/elevenlabs", async (original) => ({
  ...(await original<typeof import("@/lib/elevenlabs")>()),
  sendWhatsAppTemplate: mocks.sendWhatsAppTemplate,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (mocks.session ? { value: mocks.session } : undefined), set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
  usePathname: () => "/panel",
  useRouter: () => ({ refresh: () => {} }),
}));

const url = testDatabaseUrl();
const CLINIC = "00000000-0000-4000-8000-000000000001";
const LIMPIEZA = "00000000-0000-4000-8000-0000000000b5";
const RUIZ = "00000000-0000-4000-8000-0000000000a3";
const GOMEZ = "00000000-0000-4000-8000-0000000000a2";
const LUNARES = "00000000-0000-4000-8000-0000000000b4";

describe.runIf(url)("integración con Postgres", () => {
  let sql: typeof import("@/lib/db").sql;
  let service: typeof import("@/lib/agent/service");
  let clinicLib: typeof import("@/lib/clinic");

  const ctx = (phone: string) => ({ clinicId: CLINIC, patientPhone: phone, channel: "whatsapp", conversationId: "conv_test" });
  const inTwoDays = () => new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    await resetTestDatabase(url!);
    vi.stubEnv("DATABASE_URL", url!);
    vi.stubEnv("AGENT_TOOLS_SECRET", "secreto-de-prueba");
    vi.stubEnv("SESSION_SECRET", "sesion-de-prueba");
    vi.stubEnv("ELEVENLABS_API_KEY", "clave-falsa");
    vi.stubEnv("ELEVENLABS_WEBHOOK_SECRET", "wsec_prueba");
    ({ sql } = await import("@/lib/db"));
    await sql`update messaging_settings set active_channel = 'whatsapp' where id`;
    service = await import("@/lib/agent/service");
    clinicLib = await import("@/lib/clinic");
    const { createSessionToken } = await import("@/lib/session");
    mocks.session = createSessionToken();
  }, 60000);

  afterAll(async () => {
    const { closeDb } = await import("@/lib/db");
    await closeDb();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    mocks.notifyN8n.mockClear();
    mocks.sendWhatsAppTemplate.mockClear();
  });

  it("lee la clínica, el catálogo y arma todas las variables dinámicas", async () => {
    const clinic = await clinicLib.getClinic();
    expect(clinic.id).toBe(CLINIC);
    expect(clinic.accepted_coverages).toContain("OSDE");
    expect(clinic.templates.recordatorio).toBe("recordatorio_turno");
    // Un ID inválido o inexistente cae en la clínica por defecto, sin romper.
    expect((await clinicLib.getClinic("no-es-uuid")).id).toBe(CLINIC);
    expect((await clinicLib.resolveClinic({ agentId: "agente-desconocido" })).id).toBe(CLINIC);

    const catalog = await clinicLib.getCatalog(CLINIC);
    expect(catalog.professionals).toHaveLength(4);
    expect(catalog.appointmentTypes).toHaveLength(8);
    expect(catalog.schedules.length).toBeGreaterThan(10);
    expect(catalog.schedules[0].start_time).toMatch(/^\d\d:\d\d:\d\d$/);

    const vars = await clinicLib.buildDynamicVariables(clinic, "5491155550001");
    for (const key of [
      "clinic_id", "clinic_name", "agent_name", "clinic_info", "clinic_catalog", "urgency_instructions",
      "patient_phone", "patient_name", "patient_context", "conversation_context", "campaign_id",
    ]) {
      expect(vars[key], key).toBeTruthy();
    }
    expect(vars.patient_name).toBe("María González");
    expect(vars.patient_context).toContain("Prefiere turnos a la mañana");
    expect(vars.clinic_catalog).toContain(`id=${LIMPIEZA}`);
  });

  it("registra pacientes nuevos y actualiza sus datos", async () => {
    const r = await service.registerPatient(ctx("011 15 6666-0001"), {
      nombre_completo: "Paula Prueba",
      dni: "30.111.222",
      fecha_nacimiento: "1990-05-04",
      cobertura: "OSDE",
      plan: "210",
    });
    expect(r.paciente).toMatchObject({ nombre: "Paula Prueba", dni: "30111222", cobertura: "OSDE", plan: "210" });
    const patient = await clinicLib.findPatientByPhone(CLINIC, "5491166660001");
    expect(patient?.birth_date).toBe("1990-05-04");
    expect(patient?.last_contact_at).toMatch(/Z$/);
    // Otra llamada con el teléfono en otro formato encuentra al mismo paciente.
    await service.registerPatient(ctx("+54 9 11 6666-0001"), { email: "paula@example.com" });
    const [{ count }] = await sql<Array<{ count: number }>>`select count(*)::int as count from patients where phone = '5491166660001'`;
    expect(count).toBe(1);
  });

  it("consulta disponibilidad, reserva, reprograma y cancela", async () => {
    const c = ctx("5491166660002");
    await service.registerPatient(c, { nombre_completo: "Rodrigo Reserva", cobertura: "Galeno" });
    const availability = await service.checkAvailability(c, { tipo_turno_id: LIMPIEZA, desde: inTwoDays() });
    expect(availability.turnos.length).toBeGreaterThan(2);
    const [first, second] = availability.turnos;

    const booked = await service.bookAppointment(c, { tipo_turno_id: LIMPIEZA, profesional_id: first.profesional_id, inicio: first.inicio });
    expect(booked.ok).toBe(true);
    expect(mocks.notifyN8n).toHaveBeenCalledWith("turno.reservado", expect.objectContaining({ clinic_id: CLINIC }));

    // El mismo horario ya no aparece ni se puede volver a reservar.
    const again = await service.checkAvailability(c, { tipo_turno_id: LIMPIEZA, desde: inTwoDays() });
    expect(again.turnos.map((t) => t.inicio)).not.toContain(first.inicio);
    await expect(
      service.bookAppointment(ctx("5491166660003"), { tipo_turno_id: LIMPIEZA, profesional_id: first.profesional_id, inicio: first.inicio, nombre_completo: "Otra Persona" }),
    ).rejects.toBeInstanceOf(service.ToolError);

    const listed = await service.listPatientAppointments(c);
    expect(listed.turnos).toHaveLength(1);
    expect(listed.turnos[0]).toMatchObject({ turno_id: booked.turno_id, tipo_turno: "Limpieza dental", profesional: "Dra. Carolina Ruiz" });

    const moved = await service.rescheduleAppointment(c, { turno_id: booked.turno_id, nuevo_inicio: second.inicio });
    expect(moved.ok).toBe(true);
    const [old] = await sql<Array<{ status: string }>>`select status from appointments where id = ${booked.turno_id}`;
    expect(old.status).toBe("reprogramado");
    const afterMove = await service.listPatientAppointments(c);
    expect(afterMove.turnos).toHaveLength(1);
    expect(afterMove.turnos[0].inicio).toBe(second.inicio);

    const cancelled = await service.cancelAppointment(c, { turno_id: moved.turno_id, motivo: "viaje" });
    expect(cancelled.ok).toBe(true);
    expect((await service.listPatientAppointments(c)).turnos).toHaveLength(0);
    await expect(service.cancelAppointment(c, { turno_id: moved.turno_id })).rejects.toThrow("ya está cancelado");
    await expect(service.cancelAppointment(c, { turno_id: "inventado" })).rejects.toBeInstanceOf(service.ToolError);
  });

  it("si la reserva nueva choca, reprogramar deja el turno original intacto", async () => {
    const a = ctx("5491166660004");
    const b = ctx("5491166660005");
    await service.registerPatient(a, { nombre_completo: "Ana Original" });
    await service.registerPatient(b, { nombre_completo: "Beto Ocupa" });
    const { turnos } = await service.checkAvailability(a, { tipo_turno_id: LIMPIEZA, desde: inTwoDays() });
    const mine = await service.bookAppointment(a, { tipo_turno_id: LIMPIEZA, profesional_id: turnos[0].profesional_id, inicio: turnos[0].inicio });
    await service.bookAppointment(b, { tipo_turno_id: LIMPIEZA, profesional_id: turnos[1].profesional_id, inicio: turnos[1].inicio });
    await expect(service.rescheduleAppointment(a, { turno_id: mine.turno_id, nuevo_inicio: turnos[1].inicio })).rejects.toBeInstanceOf(service.ToolError);
    const [row] = await sql<Array<{ status: string }>>`select status from appointments where id = ${mine.turno_id}`;
    expect(row.status).toBe("confirmado");
  });

  it("reservas simultáneas del mismo horario: entra una sola y el resto recibe un motivo claro", async () => {
    const people = ["5491166660006", "5491166660016", "5491166660017", "5491166660018"].map(ctx);
    for (const [i, p] of people.entries()) await service.registerPatient(p, { nombre_completo: `Paciente Carrera ${i}` });
    const { turnos } = await service.checkAvailability(people[0], { tipo_turno_id: LIMPIEZA, desde: inTwoDays(), franja: "tarde" });
    const slot = turnos[0];
    const results = await Promise.allSettled(
      people.map((p) => service.bookAppointment(p, { tipo_turno_id: LIMPIEZA, profesional_id: slot.profesional_id, inicio: slot.inicio })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    // Ni deadlocks ni errores técnicos: el agente siempre puede explicar qué pasó.
    for (const r of results.filter((r): r is PromiseRejectedResult => r.status === "rejected")) {
      expect(r.reason).toBeInstanceOf(service.ToolError);
    }
    const [{ count }] = await sql<Array<{ count: number }>>`
      select count(*)::int as count from appointments where professional_id = ${slot.profesional_id} and starts_at = ${slot.inicio} and status = 'confirmado'`;
    expect(count).toBe(1);
  });

  it("reprogramar y reservar el horario que se libera al mismo tiempo no traba la base", async () => {
    const mover = ctx("5491166660019");
    const taker = ctx("5491166660020");
    await service.registerPatient(mover, { nombre_completo: "Mora Mueve" });
    await service.registerPatient(taker, { nombre_completo: "Tomás Toma" });
    const { turnos } = await service.checkAvailability(mover, { tipo_turno_id: LIMPIEZA, desde: inTwoDays(), franja: "manana" });
    const [s1, s2] = turnos;
    const original = await service.bookAppointment(mover, { tipo_turno_id: LIMPIEZA, profesional_id: s1.profesional_id, inicio: s1.inicio });
    const [moved, taken] = await Promise.allSettled([
      service.rescheduleAppointment(mover, { turno_id: original.turno_id, nuevo_inicio: s2.inicio }),
      service.bookAppointment(taker, { tipo_turno_id: LIMPIEZA, profesional_id: s1.profesional_id, inicio: s1.inicio }),
    ]);
    expect(moved.status).toBe("fulfilled");
    if (taken.status === "rejected") expect(taken.reason).toBeInstanceOf(service.ToolError);
  });

  it("valida profesional, especialidad y cobertura", async () => {
    const c = ctx("5491166660008");
    await service.registerPatient(c, { nombre_completo: "Elena Cobertura", cobertura: "IOMA" });
    const { turnos } = await service.checkAvailability(c, { tipo_turno_id: LUNARES, desde: inTwoDays() });
    await expect(
      service.bookAppointment(c, { tipo_turno_id: LUNARES, profesional_id: turnos[0].profesional_id, inicio: turnos[0].inicio }),
    ).rejects.toThrow("no atiende por IOMA");
    await expect(
      service.bookAppointment(c, { tipo_turno_id: LIMPIEZA, profesional_id: GOMEZ, inicio: turnos[0].inicio }),
    ).rejects.toThrow("no hace Limpieza dental");
    await expect(service.checkAvailability(c, { tipo_turno_id: "inventado" })).rejects.toBeInstanceOf(service.ToolError);
  });

  it("crea tareas y anota en lista de espera; al cancelar ofrece el turno por WhatsApp", async () => {
    await sql`update clinics set whatsapp_phone_number_id = 'wa_test', elevenlabs_agent_id = 'agent_test' where id = ${CLINIC}`;
    const waiting = ctx("5491166660009");
    await service.registerPatient(waiting, { nombre_completo: "Fede Espera" });
    const task = await service.createTask(waiting, { tipo: "receta", titulo: "Renovar receta", detalle: "Ibuprofeno" });
    const [taskRow] = await sql<Array<{ priority: string; conversation_id: string }>>`select priority, conversation_id from tasks where id = ${task.tarea_id}`;
    expect(taskRow).toEqual({ priority: "normal", conversation_id: "conv_test" });
    await service.joinWaitlist(waiting, { tipo_turno_id: LIMPIEZA, profesional_id: RUIZ, preferencias: "tardes" });

    const holder = ctx("5491166660010");
    await service.registerPatient(holder, { nombre_completo: "Gabi Cancela" });
    const { turnos } = await service.checkAvailability(holder, { tipo_turno_id: LIMPIEZA, desde: inTwoDays() });
    const booked = await service.bookAppointment(holder, { tipo_turno_id: LIMPIEZA, profesional_id: turnos[0].profesional_id, inicio: turnos[0].inicio });
    const result = await service.cancelAppointment(holder, { turno_id: booked.turno_id });
    expect(result.avisados_lista_espera).toBe(1);
    expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "5491166660009", templateName: "turno_liberado", params: ["Fede", expect.any(String)] }),
    );
    const [entry] = await sql<Array<{ status: string }>>`
      select w.status from waitlist w join patients p on p.id = w.patient_id where p.phone = '5491166660009'`;
    expect(entry.status).toBe("ofrecida");

    // Si después reserva ese tipo de turno, la lista de espera queda resuelta.
    await service.bookAppointment(waiting, { tipo_turno_id: LIMPIEZA, profesional_id: turnos[0].profesional_id, inicio: turnos[0].inicio });
    const [resolved] = await sql<Array<{ status: string }>>`
      select w.status from waitlist w join patients p on p.id = w.patient_id where p.phone = '5491166660009'`;
    expect(resolved.status).toBe("resuelta");
  });

  it("arma las audiencias de las campañas y registra los envíos", async () => {
    const { computeAudience, createCampaign, sendCampaign } = await import("@/lib/campaigns");
    const clinic = await clinicLib.getClinic();

    const recall = await computeAudience(clinic, "recall");
    // María (limpieza cada 6 meses, hace 7), Ana (lunares cada 12, hace 13) y Jorge (control cada 3, hace 4).
    expect(recall.map((m) => m.name).sort()).toEqual(["Ana Romero", "Jorge Pérez", "María González"]);
    expect((await computeAudience(clinic, "reactivacion")).map((m) => m.name)).toEqual(["Ana Romero"]);
    expect((await computeAudience(clinic, "no_show")).map((m) => m.name)).toEqual(["Lucas Díaz"]);

    // Un turno para mañana entra en el recordatorio.
    const tomorrow = new Date(Date.now() + 24 * 3600_000);
    tomorrow.setUTCMinutes(0, 0, 0);
    const [appt] = await sql<Array<{ id: string }>>`
      insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, source)
      values (${CLINIC}, '00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000b8',
              ${tomorrow}, ${new Date(tomorrow.getTime() + 20 * 60_000)}, 'confirmado', 'panel')
      returning id`;
    const reminders = await computeAudience(clinic, "recordatorio");
    expect(reminders.map((m) => m.name)).toContain("Lucas Díaz");
    // Lucas ahora tiene un turno futuro: ya no es un ausente a recuperar.
    expect(await computeAudience(clinic, "no_show")).toHaveLength(0);

    const campaign = await createCampaign({ clinicId: CLINIC, name: "Recordatorios de prueba", type: "recordatorio", templateName: "recordatorio_turno" });
    const sent = await sendCampaign(campaign.id);
    expect(sent.sent).toBe(reminders.length);
    expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledWith(expect.objectContaining({ userId: "5491155550004", templateName: "recordatorio_turno" }));
    const [reminded] = await sql<Array<{ reminder_sent_at: string | null }>>`select reminder_sent_at from appointments where id = ${appt.id}`;
    expect(reminded.reminder_sent_at).not.toBeNull();
    const recipients = await sql<Array<{ status: string; elevenlabs_conversation_id: string }>>`
      select status, elevenlabs_conversation_id from campaign_recipients where campaign_id = ${campaign.id}`;
    expect(recipients.every((r) => r.status === "enviado" && r.elevenlabs_conversation_id === "conv_saliente")).toBe(true);

    // Reenviar la misma campaña no le vuelve a escribir a nadie.
    mocks.sendWhatsAppTemplate.mockClear();
    const resend = await sendCampaign(campaign.id);
    expect(resend.sent).toBe(0);
    expect(mocks.sendWhatsAppTemplate).not.toHaveBeenCalled();

    // Un error de envío queda registrado por destinatario.
    mocks.sendWhatsAppTemplate.mockRejectedValueOnce(new Error("template no aprobado"));
    const failing = await createCampaign({ clinicId: CLINIC, name: "Reactivación de prueba", type: "reactivacion", templateName: "reactivacion_paciente" });
    const failed = await sendCampaign(failing.id);
    expect(failed.failed).toBe(1);
    const [errorRow] = await sql<Array<{ status: string; error: string }>>`select status, error from campaign_recipients where campaign_id = ${failing.id}`;
    expect(errorRow).toEqual({ status: "error", error: "template no aprobado" });
  });

  it("guarda la conversación del webhook firmado, la memoria y el resultado de la campaña", async () => {
    const { POST } = await import("@/app/api/elevenlabs/post-call/route");
    const [campaign] = await sql<Array<{ id: string }>>`select id from campaigns where name = 'Recordatorios de prueba'`;
    const payload = {
      type: "post_call_transcription",
      data: {
        agent_id: "agent_test",
        conversation_id: "conv_post_1",
        status: "done",
        user_id: "5491155550004",
        transcript: [
          { role: "agent", message: "¡Hola Lucas!", time_in_call_secs: 0 },
          { role: "user", message: "Sí, voy mañana", time_in_call_secs: 3 },
        ],
        metadata: { start_time_unix_secs: Math.floor(Date.now() / 1000), call_duration_secs: 42, whatsapp: { id: "x" } },
        analysis: {
          call_successful: "success",
          transcript_summary: "Confirmó el turno de mañana.",
          call_summary_title: "Confirmación de turno",
          data_collection_results: {
            motivo: { value: "confirmar_turno" },
            resultado: { value: "resuelto" },
            memoria: { value: "Prefiere que le escriban por la tarde." },
            sentimiento: { value: "positivo" },
          },
        },
        conversation_initiation_client_data: {
          dynamic_variables: { clinic_id: CLINIC, patient_phone: "5491155550004", campaign_id: campaign.id, conversation_context: "Recordatorio" },
        },
      },
    };
    const body = JSON.stringify(payload);
    const signed = (raw: string) => {
      const t = Math.floor(Date.now() / 1000);
      return `t=${t},v0=${createHmac("sha256", "wsec_prueba").update(`${t}.${raw}`).digest("hex")}`;
    };
    const send = (raw: string, signature: string) =>
      POST(new Request("https://turnia.example/api/elevenlabs/post-call", { method: "POST", body: raw, headers: { "elevenlabs-signature": signature } }));

    expect((await send(body, "t=1,v0=falsa")).status).toBe(401);
    expect((await send(body, signed(body))).status).toBe(200);
    // ElevenLabs puede reintentar: no duplica la conversación.
    expect((await send(body, signed(body))).status).toBe(200);

    const conversations = await sql<Array<{ channel: string; direction: string; outcome: string; transcript: unknown[]; analysis: { sentimiento: string } }>>`
      select channel, direction, outcome, transcript, analysis from conversations where elevenlabs_conversation_id = 'conv_post_1'`;
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({ channel: "whatsapp", direction: "saliente", outcome: "resuelto", analysis: { sentimiento: "positivo" } });
    expect(conversations[0].transcript).toHaveLength(2);
    const lucas = await clinicLib.findPatientByPhone(CLINIC, "5491155550004");
    // Con el día en que lo contó, para que el agente sepa de cuándo es.
    expect(lucas?.memory_summary).toMatch(/\[\d{1,2} de \S+ de \d{4}\] Prefiere que le escriban por la tarde\./);
    const [recipient] = await sql<Array<{ status: string }>>`
      select r.status from campaign_recipients r join patients p on p.id = r.patient_id
      where r.campaign_id = ${campaign.id} and p.phone = '5491155550004'`;
    expect(recipient.status).toBe("respondio");
  });

  it("expone las herramientas por HTTP con el secreto y valida los parámetros", async () => {
    const { POST } = await import("@/app/api/agent/tools/[name]/route");
    const call = (name: string, body: unknown, secret = "secreto-de-prueba") =>
      POST(
        new Request(`https://turnia.example/api/agent/tools/${name}`, {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "x-turnia-secret": secret, "content-type": "application/json" },
        }),
        { params: Promise.resolve({ name }) },
      );
    const base = { clinic_id: CLINIC, patient_phone: "5491155550001", conversation_id: "conv_http", canal: "whatsapp" };
    expect((await call("ver_turnos_paciente", base, "otro")).status).toBe(401);
    expect((await call("inexistente", base)).status).toBe(404);
    expect(await (await call("consultar_disponibilidad", { ...base, tipo_turno_id: "" })).json()).toMatchObject({ ok: false });
    const list = await (await call("ver_turnos_paciente", base)).json();
    expect(list).toEqual({ ok: true, turnos: [] });
    const slots = await (await call("consultar_disponibilidad", { ...base, tipo_turno_id: LIMPIEZA, franja: "manana", profesional_id: "" })).json();
    expect(slots.ok).toBe(true);
    expect(slots.turnos.length).toBeGreaterThan(0);
  });

  it("confirma la asistencia a un turno", async () => {
    const c = ctx("5491166660012");
    await service.registerPatient(c, { nombre_completo: "Irene Confirma" });
    const { turnos } = await service.checkAvailability(c, { tipo_turno_id: LIMPIEZA, desde: inTwoDays() });
    const booked = await service.bookAppointment(c, { tipo_turno_id: LIMPIEZA, profesional_id: turnos[0].profesional_id, inicio: turnos[0].inicio });
    const confirmed = await service.confirmAppointment(c, { turno_id: booked.turno_id });
    expect(confirmed.ok).toBe(true);
    expect(mocks.notifyN8n).toHaveBeenCalledWith("turno.confirmado", expect.objectContaining({ clinic_id: CLINIC }));
    const [row] = await sql<Array<{ status: string; confirmed_at: string | null }>>`select status, confirmed_at from appointments where id = ${booked.turno_id}`;
    expect(row.status).toBe("confirmado");
    expect(row.confirmed_at).not.toBeNull();
    // Otro paciente no puede confirmar un turno ajeno.
    await expect(service.confirmAppointment(ctx("5491166660013"), { turno_id: booked.turno_id })).rejects.toBeInstanceOf(service.ToolError);
  });

  it("los feriados y bloqueos sacan turnos de la oferta y el agente los conoce", async () => {
    const actions = await import("@/app/panel/actions");
    const c = ctx("5491166660014");
    await service.registerPatient(c, { nombre_completo: "Julia Feriado" });
    const before = await service.checkAvailability(c, { tipo_turno_id: LIMPIEZA, desde: inTwoDays() });
    const day = before.turnos[0].inicio;
    const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(day));

    const f = new FormData();
    f.set("date_from", dayKey);
    f.set("reason", "Feriado de prueba");
    const saved = await actions.addScheduleBlock(undefined, f);
    expect(saved.ok).toBe(true);

    const after = await service.checkAvailability(c, { tipo_turno_id: LIMPIEZA, desde: dayKey, hasta: dayKey });
    expect(after.turnos).toHaveLength(0);
    await expect(
      service.bookAppointment(c, { tipo_turno_id: LIMPIEZA, profesional_id: before.turnos[0].profesional_id, inicio: day }),
    ).rejects.toThrow("feriado");
    const vars = await clinicLib.buildDynamicVariables(await clinicLib.getClinic(), "5491166660014");
    expect(vars.clinic_catalog).toContain("DÍAS SIN ATENCIÓN");
    expect(vars.clinic_catalog).toContain("Feriado de prueba");
    expect(vars.clinic_info).toMatch(/Ahora mismo: (dentro|fuera) del horario/);

    // Un bloqueo de un solo profesional no afecta a los demás.
    const [block] = await sql<Array<{ id: string }>>`select id from schedule_blocks where reason = 'Feriado de prueba'`;
    const del = new FormData();
    del.set("id", block.id);
    await actions.deleteScheduleBlock(del);
    const partial = new FormData();
    partial.set("date_from", dayKey);
    partial.set("professional_id", RUIZ);
    partial.set("time_from", "10:00");
    partial.set("time_to", "12:00");
    expect((await actions.addScheduleBlock(undefined, partial)).ok).toBe(true);
    const restored = await service.checkAvailability(c, { tipo_turno_id: LIMPIEZA, desde: dayKey, hasta: dayKey, franja: "tarde" });
    expect(restored.turnos.length).toBeGreaterThan(0);
    const morning = await service.checkAvailability(c, { tipo_turno_id: LIMPIEZA, desde: dayKey, hasta: dayKey, franja: "manana" });
    expect(morning.turnos.every((t) => new Date(t.inicio).getUTCHours() >= 15)).toBe(true);
  });

  it("resolver un pedido con respuesta avisa al paciente y el agente la conoce", async () => {
    const { resolveTask } = await import("@/lib/tasks");
    const c = ctx("5491166660015");
    await service.registerPatient(c, { nombre_completo: "Karina Receta" });
    const { tarea_id } = await service.createTask(c, { tipo: "receta", titulo: "Renovar receta de levotiroxina" });
    const pending = await clinicLib.buildDynamicVariables(await clinicLib.getClinic(), "5491166660015");
    expect(pending.patient_context).toContain("Renovar receta de levotiroxina");
    expect(pending.patient_context).toContain("pendiente");

    const result = await resolveTask(CLINIC, tarea_id, "Ya está en tu mail.\nCualquier cosa escribinos.");
    expect(result).toMatchObject({ ok: true, notified: true });
    expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "5491166660015", templateName: "respuesta_pedido", params: ["Karina", "Ya está en tu mail. Cualquier cosa escribinos."] }),
    );
    const [task] = await sql<Array<{ status: string; response: string; responded_at: string | null }>>`select status, response, responded_at from tasks where id = ${tarea_id}`;
    expect(task).toMatchObject({ status: "resuelta", response: "Ya está en tu mail. Cualquier cosa escribinos." });
    const after = await clinicLib.buildDynamicVariables(await clinicLib.getClinic(), "5491166660015");
    expect(after.patient_context).toContain("Respuesta del equipo: Ya está en tu mail.");

    // Sin respuesta escrita, solo se resuelve.
    const other = await service.createTask(c, { tipo: "administrativo", titulo: "Pedido sin respuesta" });
    mocks.sendWhatsAppTemplate.mockClear();
    expect(await resolveTask(CLINIC, other.tarea_id, "  ")).toMatchObject({ ok: true, notified: false });
    expect(mocks.sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it("la encuesta post-consulta llega a los atendidos y guarda el puntaje", async () => {
    const { computeAudience, createCampaign, sendCampaign } = await import("@/lib/campaigns");
    const { recordConversation } = await import("@/lib/conversations");
    const yesterday = new Date(Date.now() - 20 * 3600_000);
    const [appt] = await sql<Array<{ id: string }>>`
      insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, source)
      values (${CLINIC}, '00000000-0000-4000-8000-0000000000c3', ${GOMEZ}, ${LUNARES}, ${yesterday}, ${new Date(yesterday.getTime() + 30 * 60_000)}, 'atendido', 'panel')
      returning id`;
    const clinic = await clinicLib.getClinic();
    const audience = await computeAudience(clinic, "encuesta");
    expect(audience.map((m) => m.name)).toEqual(["Ana Romero"]);
    expect(audience[0].detail).toBe("tu control anual de lunares con Dr. Martín Gómez");

    const campaign = await createCampaign({ clinicId: CLINIC, name: "Encuesta de prueba", type: "encuesta", templateName: "encuesta_visita" });
    expect((await sendCampaign(campaign.id)).sent).toBe(1);
    const [sent] = await sql<Array<{ survey_sent_at: string | null }>>`select survey_sent_at from appointments where id = ${appt.id}`;
    expect(sent.survey_sent_at).not.toBeNull();
    expect(await computeAudience(clinic, "encuesta")).toHaveLength(0);

    await recordConversation({
      agent_id: "agent_test",
      conversation_id: "conv_encuesta",
      transcript: [{ role: "user", message: "Un 9, muy bien atendida" }],
      analysis: { data_collection_results: { satisfaccion: { value: 9 }, motivo: { value: "encuesta" } } },
      conversation_initiation_client_data: { dynamic_variables: { clinic_id: CLINIC, patient_phone: "5491155550003", campaign_id: campaign.id } },
    });
    const [conv] = await sql<Array<{ satisfaction: number }>>`select satisfaction from conversations where elevenlabs_conversation_id = 'conv_encuesta'`;
    expect(conv.satisfaction).toBe(9);
  });

  it("respeta la baja de mensajes: sin campañas, pero con recordatorios", async () => {
    const { computeAudience } = await import("@/lib/campaigns");
    const clinic = await clinicLib.getClinic();
    expect((await computeAudience(clinic, "recall")).map((m) => m.phone)).toContain("5491155550001");
    const r = await service.registerPatient(ctx("5491155550001"), { no_recibir_mensajes: true });
    expect(r.mensaje).toContain("no le vamos a mandar más campañas");
    expect((await computeAudience(clinic, "recall")).map((m) => m.phone)).not.toContain("5491155550001");
    expect((await computeAudience(clinic, "personalizada")).map((m) => m.phone)).not.toContain("5491155550001");
    // El panel puede volver a habilitarla.
    const actions = await import("@/app/panel/actions");
    const f = new FormData();
    f.set("id", "00000000-0000-4000-8000-0000000000c1");
    f.set("opt_out", "false");
    await actions.setContactOptOut(f);
    expect((await computeAudience(clinic, "recall")).map((m) => m.phone)).toContain("5491155550001");
  });

  it("valida el teléfono de derivación antes de configurar la transferencia", async () => {
    const { handoffNumber } = await import("@/lib/agent/setup");
    expect(handoffNumber("+54 11 5555-0100")).toBe("+541155550100");
    expect(handoffNumber("011 5555-0100")).toBeNull();
    expect(handoffNumber(null)).toBeNull();
  });

  it("las server actions del panel modifican la agenda y la configuración", async () => {
    const actions = await import("@/app/panel/actions");
    const form = (data: Record<string, string | string[]>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(data)) for (const x of [v].flat()) f.append(k, x);
      return f;
    };
    const day = inTwoDays();
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    // Un horario nuevo para el Dr. Sosa ese día a la noche, así el turno manual siempre entra.
    await actions.addSchedule(form({ professional_id: "00000000-0000-4000-8000-0000000000a4", weekday: String(weekday), start_time: "20:00", end_time: "22:00" }));
    const sosa = { appointment_type_id: "00000000-0000-4000-8000-0000000000b8", professional_id: "00000000-0000-4000-8000-0000000000a4" };
    // El formulario ofrece los horarios libres del día, con el horario de atención.
    const free = await actions.loadDaySlots(form({ ...sosa, date: day }));
    expect(free.horario).toContain("20:00 a 22:00");
    expect(free.turnos.map((t) => t.hora)).toEqual(expect.arrayContaining(["20:00", "20:20", "20:40"]));
    expect((await actions.loadDaySlots(form({ ...sosa, date: "2020-01-01" }))).motivo).toBe("Ese día ya pasó.");
    // Una hora escrita a mano se entiende en sus formas habituales; si no, se explica.
    const bad = await actions.createManualAppointment(undefined, form({ ...sosa, phone: "11 6666-0011", full_name: "Hugo Manual", date: day, time: "cualquiera" }));
    expect(bad).toEqual({ ok: false, message: "No entendí la hora «cualquiera». Escribila como 9:15 o 19:30." });
    const outside = await actions.createManualAppointment(undefined, form({ ...sosa, phone: "11 6666-0011", full_name: "Hugo Manual", date: day, time: "23:30" }));
    // Fuera de horario el panel lo puede dar igual; el agente, nunca.
    expect(outside).toEqual({ ok: false, message: "El profesional no atiende en ese horario.", forzable: true });
    expect(await actions.createManualAppointment(undefined, form({ ...sosa, phone: "11 6", full_name: "Hugo Manual", date: day, time: "20:00" })))
      .toEqual({ ok: false, message: "Revisá el celular: va con código de área, por ejemplo 11 5555-0001." });
    const manual = await actions.createManualAppointment(undefined, form({
      phone: "11 6666-0011", full_name: "Hugo Manual", coverage: "Particular", date: day, time: "8:30 pm", ...sosa,
    }));
    expect(manual).toMatchObject({ ok: true });
    // El turno de 20:30 a 20:50 saca de la oferta los horarios que se le superponen.
    const after = (await actions.loadDaySlots(form({ ...sosa, date: day }))).turnos.map((t) => t.hora);
    expect(after).toContain("20:00");
    expect(after).not.toContain("20:20");
    expect(after).not.toContain("20:40");
    const [appt] = await sql<Array<{ id: string; source: string }>>`
      select a.id, a.source from appointments a join patients p on p.id = a.patient_id where p.phone = '5491166660011'`;
    expect(appt.source).toBe("panel");
    // Un turno que todavía no empezó no se marca como atendido; sí se cancela, como si lo cancelara el paciente.
    expect(await actions.changeAppointmentStatus(undefined, form({ id: appt.id, status: "atendido" })))
      .toMatchObject({ ok: false, message: "Todavía no empezó: se puede marcar cuando llegue el horario." });
    expect(await actions.changeAppointmentStatus(undefined, form({ id: appt.id, status: "cancelado", reason: "el doctor no viene" })))
      .toMatchObject({ ok: true });
    const [done] = await sql<Array<{ status: string; notes: string }>>`select status, notes from appointments where id = ${appt.id}`;
    expect(done).toMatchObject({ status: "cancelado", notes: "Cancelado: el doctor no viene" });
    expect(mocks.notifyN8n).toHaveBeenCalledWith("turno.cancelado", expect.objectContaining({ cancelado_por: "clinica" }));
    expect(await actions.changeAppointmentStatus(undefined, form({ id: appt.id, status: "cancelado" })))
      .toMatchObject({ ok: false, message: "Ese turno ya está cancelado." });

    const previousClinic = await clinicLib.getClinic();
    await actions.saveClinic(form({
      name: "Centro Médico Plaza (demo)", agent_name: "Sofi", accepted_coverages: "OSDE, Galeno",
      template_recordatorio: "recordatorio_turno", template_idioma: "es_AR", whatsapp_phone_number_id: "wa_test",
      handoff_phone: "+541155550100", after_hours_instructions: "Guardia odontológica: 11 5555-0199",
    }));
    const clinic = await clinicLib.getClinic();
    expect(clinic.accepted_coverages).toEqual(["OSDE", "Galeno"]);
    expect(clinic.templates).toEqual(previousClinic.templates);
    expect(clinic.whatsapp_phone_number_id).toBe(previousClinic.whatsapp_phone_number_id);
    expect(clinic.handoff_phone).toBe("+541155550100");
    const vars = await clinicLib.buildDynamicVariables(clinic, "5491155550001");
    expect(vars.urgency_instructions).toContain("Fuera del horario de atención: Guardia odontológica");

    const price = new FormData();
    price.set("id", LIMPIEZA);
    price.set("price", "$ 42.500");
    await actions.setAppointmentTypePrice(price);
    const [limpieza] = await sql<Array<{ price: string }>>`select price from appointment_types where id = ${LIMPIEZA}`;
    expect(Number(limpieza.price)).toBe(42500);

    await actions.addProfessional(form({ full_name: "Dra. Nueva", specialty: "Pediatría", accepted_coverages: "OSDE" }));
    await actions.addAppointmentType(form({ name: "Control pediátrico", specialty: "Pediatría", duration_min: "25", recall_months: "6" }));
    const catalog = await clinicLib.getCatalog(CLINIC);
    expect(catalog.professionals.map((p) => p.full_name)).toContain("Dra. Nueva");
    expect(catalog.appointmentTypes.find((t) => t.name === "Control pediátrico")?.recall_months).toBe(6);

    mocks.session = undefined;
    await expect(actions.setTaskStatus(form({ id: appt.id, status: "resuelta" }))).rejects.toThrow("redirect:/panel/login");
    const { createSessionToken } = await import("@/lib/session");
    mocks.session = createSessionToken();
  });

  it("turnos: coberturas, reservas repetidas, choques del paciente, turnos pasados y cambios desde el panel", async () => {
    const actions = await import("@/app/panel/actions");
    const form = (data: Record<string, string | string[]>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(data)) for (const x of [v].flat()) f.append(k, x);
      return f;
    };
    const c = ctx("5491166660031");
    await service.registerPatient(c, { nombre_completo: "Irene Casos", cobertura: "osde " });
    const { turnos } = await service.checkAvailability(c, { tipo_turno_id: LUNARES, desde: inTwoDays() });
    const [first, second] = turnos;

    // La cobertura se compara sin mayúsculas ni espacios, y queda como la cargó la clínica.
    const booked = await service.bookAppointment(c, { tipo_turno_id: LUNARES, profesional_id: first.profesional_id, inicio: first.inicio });
    const [row] = await sql<Array<{ coverage: string }>>`select coverage from appointments where id = ${booked.turno_id}`;
    expect(row.coverage).toBe("OSDE");

    // El agente reintenta la misma reserva: no es un error ni duplica el turno.
    const again = await service.bookAppointment(c, { tipo_turno_id: LUNARES, profesional_id: first.profesional_id, inicio: first.inicio });
    expect(again).toMatchObject({ ok: true, turno_id: booked.turno_id });
    expect(again.mensaje).toContain("ya estaba reservado");

    // Una persona no puede estar en dos turnos a la vez (aunque sea con otro profesional y forzando el horario).
    await expect(service.bookAppointment(c, { tipo_turno_id: LIMPIEZA, profesional_id: RUIZ, inicio: first.inicio }, { force: true }))
      .rejects.toThrow("ya tiene un turno a esa hora");

    // Otro turno de lo mismo: se da, con un aviso para preguntarle si quiere los dos.
    const twice = await service.bookAppointment(c, { tipo_turno_id: LUNARES, profesional_id: second.profesional_id, inicio: second.inicio });
    expect(twice).toMatchObject({ ok: true });
    expect("aviso" in twice && twice.aviso).toContain("Ya tenía otro turno de Control anual de lunares");

    // Desde el panel se mueve: conserva el canal por el que lo pidió el paciente y se puede corregir el horario.
    const moved = await service.rescheduleClinicAppointment(CLINIC, twice.turno_id, { nuevo_inicio: turnos[3].inicio });
    const [after] = await sql<Array<{ source: string; status: string }>>`select source, status from appointments where id = ${moved.turno_id}`;
    expect(after).toEqual({ source: "whatsapp", status: "confirmado" });
    const [old] = await sql<Array<{ status: string }>>`select status from appointments where id = ${twice.turno_id}`;
    expect(old.status).toBe("reprogramado");
    // A otro profesional que no atiende su cobertura, no.
    const [other] = await sql<{ id: string }[]>`
      insert into professionals (clinic_id, full_name, specialty, accepted_coverages) values (${CLINIC}, 'Dra. Otra Piel', 'Dermatología', array['Galeno']) returning id`;
    await expect(service.rescheduleClinicAppointment(CLINIC, moved.turno_id, { nuevo_inicio: turnos[3].inicio, profesional_id: other.id }, { force: true }))
      .rejects.toThrow("no atiende por OSDE");
    await sql`delete from professionals where id = ${other.id}`;

    // Desde la ficha del panel: mueve y abre la ficha del turno nuevo, en su día y con la misma vista.
    const local = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .format(new Date(iso)).split(", ");
    const [date5, time5] = local(turnos[5].inicio);
    await expect(actions.rescheduleFromPanel(undefined, form({ appointment_id: moved.turno_id, date: date5, time: time5, back: "vista=dia&turno=viejo&x=1" })))
      .rejects.toThrow(new RegExp(`^redirect:/panel/agenda\\?vista=dia&fecha=${date5}&turno=[0-9a-f-]{36}$`));
    const [{ id: movedAgain }] = await sql<{ id: string }[]>`select id from appointments where patient_id = (select patient_id from appointments where id = ${moved.turno_id}) and status = 'confirmado' and starts_at = ${turnos[5].inicio}`;
    Object.assign(moved, { turno_id: movedAgain });

    // Dos cancelaciones a la vez (paciente y panel): una sola cuenta.
    const results = await Promise.allSettled([
      service.cancelAppointment(c, { turno_id: moved.turno_id }),
      service.cancelClinicAppointment(CLINIC, moved.turno_id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(mocks.notifyN8n.mock.calls.filter((call) => (call as unknown[])[0] === "turno.cancelado")).toHaveLength(1);

    // Un turno que ya pasó no se cancela ni se mueve: se marca. Y la marca se puede corregir.
    const [past] = await sql<Array<{ id: string }>>`
      insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, source)
      select ${CLINIC}, p.id, ${GOMEZ}, ${LUNARES}, now() - interval '3 hours', now() - interval '2 hours 40 minutes', 'confirmado', 'whatsapp'
      from patients p where p.phone = '5491166660031' returning id`;
    await expect(service.cancelAppointment(c, { turno_id: past.id })).rejects.toThrow("ya pasó");
    await expect(service.rescheduleAppointment(c, { turno_id: past.id, nuevo_inicio: turnos[4].inicio })).rejects.toThrow("ya pasó");
    expect(await actions.changeAppointmentStatus(undefined, form({ id: past.id, status: "ausente" }))).toMatchObject({ ok: true, message: "Marcado como ausente." });
    expect(await actions.changeAppointmentStatus(undefined, form({ id: past.id, status: "confirmado" }))).toMatchObject({ ok: true });
    // «Marcar todos como atendidos» solo toca los que ya terminaron.
    expect(await actions.markDayAttended(undefined, form({ id: [past.id, booked.turno_id] }))).toMatchObject({ ok: true, message: "1 turno marcado como atendido." });
    const states = await sql<Array<{ id: string; status: string }>>`select id, status from appointments where id in ${sql([past.id, booked.turno_id])}`;
    expect(Object.fromEntries(states.map((s) => [s.id, s.status]))).toEqual({ [past.id]: "atendido", [booked.turno_id]: "confirmado" });

    // Al escribir el celular en el turno a mano, el panel reconoce al paciente.
    expect(await actions.lookupPatient(form({ phone: "11 6666-0031" }))).toMatchObject({ name: "Irene Casos", coverage: "osde " });
    expect(await actions.lookupPatient(form({ phone: "11 0000-0000" }))).toBeNull();
  });

  it("turno con dos profesionales: ocupa la agenda de los dos, se mueve y se cancela junto", async () => {
    const actions = await import("@/app/panel/actions");
    const form = (data: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(data)) f.append(k, v);
      return f;
    };
    const SOSA = "00000000-0000-4000-8000-0000000000a4";
    const APTO = "00000000-0000-4000-8000-0000000000b8";
    // Un día hábil sin los turnos de las otras pruebas: la Dra. Ruiz atiende de 10 a 17 y el Dr. Sosa de 8 a 12.
    let day = new Date(Date.now() + 20 * 86400_000).toISOString().slice(0, 10);
    while ([0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) day = new Date(Date.parse(`${day}T12:00:00Z`) + 86400_000).toISOString().slice(0, 10);
    const ruiz = { appointment_type_id: LIMPIEZA, professional_id: RUIZ };
    const sosa = { appointment_type_id: APTO, professional_id: SOSA };
    const sosaFree = async () => (await actions.loadDaySlots(form({ ...sosa, date: day }))).turnos;

    // Un paciente le pide al Dr. Sosa un turno a las 11:40 (por el agente).
    const at1140 = (await sosaFree()).find((t) => t.hora === "11:40")!;
    await service.registerPatient(ctx("5491166660042"), { nombre_completo: "Paula Previa" });
    await service.bookAppointment(ctx("5491166660042"), { tipo_turno_id: APTO, profesional_id: SOSA, inicio: at1140.inicio });

    // Con el Dr. Sosa como segundo profesional, solo se ofrecen horarios en que los dos están libres.
    const both = (await actions.loadDaySlots(form({ ...ruiz, second_professional_id: SOSA, date: day }))).turnos.map((t) => t.hora);
    expect(both).toEqual(expect.arrayContaining(["10:00", "10:40"]));
    expect(both).not.toContain("11:20");
    expect(both).not.toContain("12:00");
    expect((await actions.loadDaySlots(form({ ...ruiz, date: day }))).turnos.map((t) => t.hora)).toContain("12:00");

    // Si el segundo está ocupado no se da (ni forzando); fuera de su horario, el panel puede darlo igual.
    const joint = { ...ruiz, second_professional_id: SOSA, phone: "11 6666-0041", full_name: "Quique Cirugía", date: day };
    expect(await actions.createManualAppointment(undefined, form({ ...joint, time: "11:20", force: "1" })))
      .toEqual({ ok: false, message: "Dr. Pablo Sosa ya tiene un turno a esa hora.", forzable: false });
    expect(await actions.createManualAppointment(undefined, form({ ...joint, time: "14:00" })))
      .toEqual({ ok: false, message: "Dr. Pablo Sosa: El profesional no atiende en ese horario.", forzable: true });
    await expect(service.bookAppointment(ctx("5491166660041"), { tipo_turno_id: LIMPIEZA, profesional_id: RUIZ, inicio: at1140.inicio }, { secondProfessionalId: RUIZ }))
      .rejects.toThrow("tiene que ser distinto");

    const made = await actions.createManualAppointment(undefined, form({ ...joint, time: "10:00" }));
    expect(made).toMatchObject({ ok: true });
    expect(made.message).toContain("con Dra. Carolina Ruiz y Dr. Pablo Sosa");
    const [appt] = await sql<Array<{ id: string; second_professional_id: string }>>`
      select a.id, a.second_professional_id from appointments a join patients p on p.id = a.patient_id where p.phone = '5491166660041' and a.status = 'confirmado'`;
    expect(appt.second_professional_id).toBe(SOSA);

    // El Dr. Sosa queda ocupado de 10 a 10:40: ni el agente ni el panel le dan ese horario.
    const free = (await sosaFree()).map((t) => t.hora);
    expect(free).not.toContain("10:00");
    expect(free).not.toContain("10:20");
    expect(free).toContain("10:40");
    const sosa10 = (await actions.loadDaySlots(form({ ...sosa, date: day, ignore_id: appt.id }))).turnos.find((t) => t.hora === "10:00")!;
    await service.registerPatient(ctx("5491166660043"), { nombre_completo: "Rita Agente" });
    await expect(service.bookAppointment(ctx("5491166660043"), { tipo_turno_id: APTO, profesional_id: SOSA, inicio: sosa10.inicio }))
      .rejects.toThrow("ocupado");
    const { turnos: offered } = await service.checkAvailability(ctx("5491166660043"), { tipo_turno_id: APTO, desde: day, hasta: day });
    expect(offered.map((t) => t.inicio)).not.toContain(sosa10.inicio);

    // El paciente y el agente ven a los dos profesionales.
    const { turnos: mine } = await service.listPatientAppointments(ctx("5491166660041"));
    expect(mine[0].profesional).toBe("Dra. Carolina Ruiz y Dr. Pablo Sosa");

    // Se mueve para los dos: el Dr. Sosa queda libre a las 10 y ocupado a las 10:40.
    const slot1040 = (await actions.loadDaySlots(form({ ...ruiz, second_professional_id: SOSA, date: day, ignore_id: appt.id }))).turnos.find((t) => t.hora === "10:40")!;
    const moved = await service.rescheduleClinicAppointment(CLINIC, appt.id, { nuevo_inicio: slot1040.inicio });
    expect(moved.mensaje).toContain("y Dr. Pablo Sosa");
    const [after] = await sql<Array<{ second_professional_id: string }>>`select second_professional_id from appointments where id = ${moved.turno_id}`;
    expect(after.second_professional_id).toBe(SOSA);
    const freeAfter = (await sosaFree()).map((t) => t.hora);
    expect(freeAfter).toContain("10:00");
    expect(freeAfter).not.toContain("10:40");

    // Cancelado, el horario vuelve a estar libre para el Dr. Sosa.
    await service.cancelClinicAppointment(CLINIC, moved.turno_id);
    expect((await sosaFree()).map((t) => t.hora)).toContain("10:40");
  });

  it("una prestación que solo da el consultorio: el agente no la ofrece, no la reserva ni la mueve; el panel sí", async () => {
    const actions = await import("@/app/panel/actions");
    const form = (data: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(data)) f.append(k, v);
      return f;
    };
    const c = ctx("5491166660051");
    await service.registerPatient(c, { nombre_completo: "Sergio Conducto" });
    // Antes de marcarla: el agente reserva un turno (para probar después que no lo puede mover).
    const { turnos } = await service.checkAvailability(c, { tipo_turno_id: LIMPIEZA, desde: new Date(Date.now() + 25 * 86400_000).toISOString().slice(0, 10) });
    const booked = await service.bookAppointment(c, { tipo_turno_id: LIMPIEZA, profesional_id: RUIZ, inicio: turnos[0].inicio });

    await sql`update appointment_types set panel_only = true where id = ${LIMPIEZA}`;
    try {
      const catalog = clinicLib.catalogText(await clinicLib.getCatalog(CLINIC));
      expect(catalog).toMatch(/Limpieza dental .*Solo la da el consultorio: no la ofrezcas ni la reserves/);
      await expect(service.checkAvailability(c, { tipo_turno_id: LIMPIEZA })).rejects.toThrow("la da solo el consultorio");
      await expect(service.bookAppointment(c, { tipo_turno_id: LIMPIEZA, profesional_id: RUIZ, inicio: turnos[1].inicio })).rejects.toThrow("la da solo el consultorio");
      await expect(service.rescheduleAppointment(c, { turno_id: booked.turno_id, nuevo_inicio: turnos[1].inicio })).rejects.toThrow("la da solo el consultorio");
      await expect(service.joinWaitlist(c, { tipo_turno_id: LIMPIEZA })).rejects.toThrow("la da solo el consultorio");
      // El consultorio sí la da y la mueve desde el panel.
      const local = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .format(new Date(turnos[2].inicio)).split(", ");
      const made = await actions.createManualAppointment(undefined, form({
        appointment_type_id: LIMPIEZA, professional_id: RUIZ, phone: "11 6666-0052", full_name: "Tere Panel", date: local[0], time: local[1],
      }));
      expect(made).toMatchObject({ ok: true });
      expect((await service.rescheduleClinicAppointment(CLINIC, booked.turno_id, { nuevo_inicio: turnos[1].inicio })).turno_id).toBeTruthy();
      // La casilla del panel la marca y la desmarca.
      const [type] = await sql<Array<{ name: string; specialty: string; duration_min: number }>>`select name, specialty, duration_min from appointment_types where id = ${LIMPIEZA}`;
      const save = (extra: Record<string, string>) => actions.saveAppointmentTypeWithFeedback({}, form({ id: LIMPIEZA, name: type.name, specialty: type.specialty, duration_min: String(type.duration_min), ...extra }));
      expect(await save({})).toMatchObject({ ok: true });
      expect((await sql`select panel_only from appointment_types where id = ${LIMPIEZA}`)[0].panel_only).toBe(false);
      expect(await save({ panel_only: "on" })).toMatchObject({ ok: true });
      expect((await sql`select panel_only from appointment_types where id = ${LIMPIEZA}`)[0].panel_only).toBe(true);
    } finally {
      await sql`update appointment_types set panel_only = false where id = ${LIMPIEZA}`;
    }
  });

  it("todas las páginas del panel consultan y renderizan con datos reales", async () => {
    const pages: Array<[string, () => Promise<unknown>]> = [
      ["inicio", async () => (await import("@/app/panel/(app)/page")).default()],
      ["agenda", async () => (await import("@/app/panel/(app)/agenda/page")).default({ searchParams: Promise.resolve({ fecha: inTwoDays() }) } as never)],
      ["conversaciones", async () => (await import("@/app/panel/(app)/conversaciones/page")).default({ searchParams: Promise.resolve({ canal: "whatsapp" }) } as never)],
      ["tareas", async () => (await import("@/app/panel/(app)/tareas/page")).default({ searchParams: Promise.resolve({}) } as never)],
      ["pacientes", async () => (await import("@/app/panel/(app)/pacientes/page")).default({ searchParams: Promise.resolve({ q: "gonz" }) } as never)],
      ["campañas", async () => (await import("@/app/panel/(app)/campanas/page")).default()],
      ["configuración", async () => (await import("@/app/panel/(app)/configuracion/page")).default()],
      ["privacidad", async () => (await import("@/app/privacidad/page")).default()],
    ];
    const [conversation] = await sql<Array<{ id: string }>>`select id from conversations limit 1`;
    const [campaign] = await sql<Array<{ id: string }>>`select id from campaigns limit 1`;
    pages.push(
      ["conversación", async () => (await import("@/app/panel/(app)/conversaciones/[id]/page")).default({ params: Promise.resolve({ id: conversation.id }) } as never)],
      ["paciente", async () => (await import("@/app/panel/(app)/pacientes/[id]/page")).default({ params: Promise.resolve({ id: "00000000-0000-4000-8000-0000000000c2" }) } as never)],
      ["campaña", async () => (await import("@/app/panel/(app)/campanas/[id]/page")).default({ params: Promise.resolve({ id: campaign.id }), searchParams: Promise.resolve({}) } as never)],
    );
    for (const [name, render] of pages) {
      const html = renderToStaticMarkup((await render()) as React.ReactElement);
      expect(html.length, name).toBeGreaterThan(200);
    }
    const pacientes = renderToStaticMarkup((await (await import("@/app/panel/(app)/pacientes/page")).default({ searchParams: Promise.resolve({ q: "gonz" }) } as never)) as React.ReactElement);
    expect(pacientes).toContain("María González");
    expect(pacientes).not.toContain("Jorge Pérez");
    await expect((await import("@/app/panel/(app)/pacientes/[id]/page")).default({ params: Promise.resolve({ id: "no-existe" }) } as never)).rejects.toThrow("notFound");
  });

  it("el health check confirma que la base responde", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, database: "ok", clinics: 1 });
  });
});
