import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDaysKey, localDateKey, zonedParts, zonedTimeToUtc } from "@/lib/time";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Resumen diario de Sofi para el equipo (pedido del Dr. Mininni, 16/11): a las 10, por WhatsApp, lo
// que dio, movió y canceló Sofi, con los datos para cargarlo en Smile Connect; y «¿este turno lo diste
// vos?» por WhatsApp (ver_agenda dice quién lo dio, detalle_turno da todo). Datos ficticios.

const mocks = vi.hoisted(() => ({ cookies: new Map<string, string>(), sent: [] as Array<{ chatId: string; text: string }> }));
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
vi.mock("@/lib/waha", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/waha")>()),
  wahaSendText: vi.fn(async (chatId: string, text: string) => {
    mocks.sent.push({ chatId, text });
    return { id: "msg" };
  }),
}));

const url = testDatabaseUrl();
const tz = "America/Argentina/Buenos_Aires";
const secret = "turnia-test-secret";
const day = (offset: number) => addDaysKey(localDateKey(new Date(), tz), offset);
const at = (offset: number, time: string) => new Date(`${day(offset)}T${time}:00-03:00`).toISOString();
const doctor = "5491100008888";
const patientPhone = "5491100008001";
const form = (data: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
};

/** El próximo día hábil a las 10:30 (hora de la clínica) que todavía no pasó. */
function nextWeekdayAt(hour: number, minute: number): Date {
  for (let i = 0; i < 8; i++) {
    const key = day(i);
    const [y, m, d] = key.split("-").map(Number);
    const when = zonedTimeToUtc(y, m, d, hour, minute, tz);
    const weekday = zonedParts(when, tz).weekday;
    if (weekday !== 0 && weekday !== 6 && when.getTime() > Date.now()) return when;
  }
  throw new Error("sin día hábil");
}

type Result = Record<string, unknown> & { ok: boolean; error?: string };

describe.runIf(url)("resumen diario de Sofi para el equipo", () => {
  let sql: typeof import("@/lib/db").sql;
  let handler: typeof import("@/app/api/agent/tools/[name]/route").POST;
  let clinicId: string, pro: string, control: string, patient: string, otherPatient: string;
  let oldSmile: string, oldPanel: string, oldSofi: string, newSofi: string, panelNew: string;

  async function tool(name: string, input: Record<string, unknown> = {}, phone = doctor, canal = "custom"): Promise<Result> {
    const request = new Request(`https://turnia.test/api/agent/tools/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-turnia-secret": secret },
      body: JSON.stringify({ clinic_id: clinicId, patient_phone: phone, canal, conversation_id: `conv-${phone}`, ...input }),
    });
    return (await handler(request, { params: Promise.resolve({ name }) })).json();
  }

  beforeAll(async () => {
    const db = await scratchDatabase(url!, "turnia_daily_summary_test");
    await resetTestDatabase(db);
    for (const [k, v] of Object.entries({ DATABASE_URL: db, AGENT_TOOLS_SECRET: secret, SESSION_SECRET: "test-session", APP_URL: "https://turnia.test", WAHA_CONNECTIONS: "" })) vi.stubEnv(k, v);
    ({ sql } = await import("@/lib/db"));
    ({ POST: handler } = await import("@/app/api/agent/tools/[name]/route"));
    await sql`update messaging_settings set active_channel = 'whatsapp' where id`;
    [{ id: clinicId }] = await sql`
      insert into clinics (name, specialty, is_demo, retained_at, whatsapp_provider, agent_name)
      values ('Consultorio con resumen', 'Odontología', false, now(), 'waha', 'Sofi') returning id`;
    [{ id: pro }] = await sql`insert into professionals (clinic_id, full_name, specialty) values (${clinicId}, 'Dr. Prueba', 'Odontología') returning id`;
    await sql`insert into schedules (professional_id, weekday, start_time, end_time) select ${pro}::uuid, d, '09:00', '18:00' from generate_series(0, 6) d`;
    [{ id: control }] = await sql`
      insert into appointment_types (clinic_id, name, specialty, duration_min) values (${clinicId}, 'Control', 'Odontología', 30) returning id`;
    // Una paciente de antes (de Smile Connect) y uno nuevo.
    [{ id: patient }] = await sql`
      insert into patients (clinic_id, phone, full_name, dni, coverage, coverage_plan, member_number, created_at)
      values (${clinicId}, ${patientPhone}, 'Marta Ficticia', '30111222', 'OSDE', '210', '999', now() - interval '30 days') returning id`;
    [{ id: otherPatient }] = await sql`
      insert into patients (clinic_id, phone, full_name, dni) values (${clinicId}, '5491100008002', 'Juan Nuevo', '40111222') returning id`;
    const insert = async (patientId: string, offset: number, time: string, source: string, createdDaysAgo: number, notes: string | null = null) => {
      const [{ id }] = await sql`
        insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, source, notes, created_at)
        values (${clinicId}, ${patientId}, ${pro}, ${control}, ${at(offset, time)}, ${new Date(Date.parse(at(offset, time)) + 30 * 60_000).toISOString()},
          'confirmado', ${source}, ${notes}, now() - make_interval(days => ${createdDaysAgo})) returning id`;
      return id as string;
    };
    oldSmile = await insert(patient, 9, "10:00", "smile_connect", 6);
    oldPanel = await insert(otherPatient, 9, "12:00", "panel", 6);
    oldSofi = await insert(otherPatient, 10, "11:00", "whatsapp", 6);
    newSofi = await insert(otherPatient, 11, "15:00", "whatsapp", 0, "Le duele una muela de abajo");
    panelNew = await insert(otherPatient, 12, "16:00", "panel", 0);
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

  it("Sofi registra por dónde cancela y mueve; el panel también", async () => {
    // La paciente le pide a Sofi mover su turno de Smile Connect.
    const offers = await tool("consultar_disponibilidad", { turno_id: oldSmile, desde: day(13), hasta: day(13) }, patientPhone);
    expect(offers).toMatchObject({ ok: true });
    const moved = await tool("reprogramar_turno", { turno_id: oldSmile, nuevo_inicio: (offers.turnos as Array<{ inicio: string }>)[0].inicio }, patientPhone);
    expect(moved).toMatchObject({ ok: true });
    expect(await sql`select status, cancelled_via from appointments where id = ${oldSmile}`).toEqual([{ status: "reprogramado", cancelled_via: "whatsapp" }]);
    expect(await sql`select replaced_by from appointments where id = ${oldSmile}`).toEqual([{ replaced_by: moved.turno_id }]);
    // El consultorio cancela uno desde el panel: no es de Sofi.
    const { cancelClinicAppointment } = await import("@/lib/agent/service");
    await cancelClinicAppointment(clinicId, panelNew, "Lo pidió por teléfono");
    expect(await sql`select cancelled_via from appointments where id = ${panelNew}`).toEqual([{ cancelled_via: "panel" }]);
  });

  it("el equipo con acceso por WhatsApp: el resumen se prende por celular y ver_agenda dice quién dio cada turno", async () => {
    const actions = await import("@/app/panel/protocol-actions");
    expect(await actions.addStaffPhone({}, form({ clinic_id: clinicId, name: "Dr. Prueba", phone: "11 0000-8888" }))).toMatchObject({ ok: true });
    const [{ id, daily_summary }] = await sql`select id, daily_summary from clinic_staff_phones where clinic_id = ${clinicId}`;
    expect(daily_summary).toBe(true);
    await actions.toggleStaffSummary(form({ clinic_id: clinicId, id, on: "0" }));
    expect(await sql`select daily_summary from clinic_staff_phones where id = ${id}`).toEqual([{ daily_summary: false }]);
    await actions.toggleStaffSummary(form({ clinic_id: clinicId, id, on: "1" }));

    const agenda = await tool("ver_agenda", { desde: day(9) });
    expect(agenda).toMatchObject({ ok: true, turnos: [expect.objectContaining({ turno_id: oldPanel, dio: "el consultorio desde el panel" })] });
    expect(await tool("ver_agenda", { desde: day(10) })).toMatchObject({ turnos: [expect.objectContaining({ turno_id: oldSofi, dio: "Sofi por WhatsApp" })] });
    // El equipo mueve un turno del panel por WhatsApp: cuenta como movido por Sofi.
    const offers = await tool("consultar_disponibilidad", { turno_id: oldPanel, desde: day(14), hasta: day(14) });
    const moved = await tool("reprogramar_turno", { turno_id: oldPanel, nuevo_inicio: (offers.turnos as Array<{ inicio: string }>)[0].inicio });
    expect(moved).toMatchObject({ ok: true });
    expect(await sql`select source from appointments where id = ${moved.turno_id as string}`).toEqual([{ source: "panel" }]);
    // Y Sofi cancela, a pedido del paciente, uno que había dado antes.
    expect(await tool("cancelar_turno", { turno_id: oldSofi, motivo: "Viaja" }, "5491100008002")).toMatchObject({ ok: true });
  });

  it("detalle_turno: quién lo dio, los datos del paciente y la nota para copiar; turnos_de_sofi: lo de un período", async () => {
    // Un paciente no puede.
    expect(await tool("detalle_turno", { turno_id: newSofi }, patientPhone)).toMatchObject({ ok: false, error: expect.stringContaining("solo para el equipo") });
    const detail = await tool("detalle_turno", { turno_id: newSofi });
    expect(detail).toMatchObject({
      ok: true,
      turno: expect.objectContaining({
        paciente: "Juan Nuevo",
        dni: "40111222",
        celular: "+54 9 11 0000-8002",
        prestacion: "Control",
        notas: "Le duele una muela de abajo",
        dio: expect.stringMatching(/^Sofi por WhatsApp, el /),
        nota: "Control · sin cobertura cargada · «Le duele una muela de abajo» · Dio Sofi por WhatsApp",
      }),
    });
    const [{ id: movedId }] = await sql`select replaced_by as id from appointments where id = ${oldSmile}`;
    expect(await tool("detalle_turno", { turno_id: movedId })).toMatchObject({
      turno: expect.objectContaining({ antes: expect.stringContaining("lo movió Sofi por WhatsApp"), cobertura: "OSDE 210 afiliado 999" }),
    });
    expect(await tool("detalle_turno", { turno_id: "no-es-un-id" })).toMatchObject({ ok: false });

    const activity = await tool("turnos_de_sofi", { desde: day(-1) });
    expect(activity).toMatchObject({ ok: true });
    expect((activity.nuevos as Array<{ turno_id: string }>).map((t) => t.turno_id)).toEqual([newSofi]);
    expect((activity.movidos as Array<{ paciente: string }>).map((t) => t.paciente).sort()).toEqual(["Juan Nuevo", "Marta Ficticia"]);
    expect(activity.cancelados).toEqual([expect.objectContaining({ turno_id: oldSofi, motivo: "Viaja" })]);
  });

  it("el resumen sale una vez por día hábil desde las 10, por la línea del consultorio, con nuevos, movidos y cancelados", async () => {
    const { sendDueSummaries, summaryText, buildSummary } = await import("@/lib/daily-summary");
    const when = nextWeekdayAt(10, 30);
    // Antes de las 10, no.
    mocks.sent.length = 0;
    expect(await sendDueSummaries(new Date(when.getTime() - 60 * 60_000))).toEqual([]);
    expect(mocks.sent).toHaveLength(0);

    const results = await sendDueSummaries(when);
    expect(results).toEqual([{ clinic: "Consultorio con resumen", enviados: 1, turnos: { nuevos: 1, movidos: 2, cancelados: 1 } }]);
    expect(mocks.sent).toHaveLength(1);
    const { chatId, text } = mocks.sent[0];
    expect(chatId).toBe(`${doctor}@c.us`);
    expect(text).toContain("Buen día. Soy Sofi.");
    expect(text).toContain("1 turno nuevo, 2 movidos y 1 cancelado");
    expect(text).toContain("*Turnos nuevos (1)*");
    expect(text).toContain("Juan Nuevo (paciente nuevo) · DNI 40111222 · +54 9 11 0000-8002");
    expect(text).toContain("Marta Ficticia · DNI 30111222");
    expect(text).toContain("Nota: Control · sin cobertura cargada · «Le duele una muela de abajo» · Dio Sofi por WhatsApp");
    expect(text).toContain("*Turnos movidos (2)*");
    expect(text).toContain("(antes: ");
    expect(text).toContain("*Turnos cancelados (1)*");
    expect(text).toContain("motivo: Viaja");
    // Lo del panel no figura.
    expect(text).not.toContain(panelNew);
    expect(text.match(/Juan Nuevo/g)).toHaveLength(3);
    // Si contesta, Sofi sabe qué le mandó.
    expect(await sql`select context from channel_conversations where clinic_id = ${clinicId} and phone = ${doctor} and closed_at is null`)
      .toEqual([{ context: expect.stringContaining("resumen diario") }]);

    // El mismo día no se repite; el día hábil siguiente arranca donde terminó este (sin turnos nuevos).
    expect(await sendDueSummaries(new Date(when.getTime() + 2 * 3600_000))).toEqual([]);
    const next = new Date(when.getTime() + (zonedParts(when, tz).weekday === 5 ? 3 : 1) * 86400_000);
    expect(await sendDueSummaries(next)).toEqual([expect.objectContaining({ enviados: 1, turnos: { nuevos: 0, movidos: 0, cancelados: 0 } })]);
    expect(mocks.sent[1].text).toContain("no di, moví ni cancelé turnos");
    // Sábado, no.
    const saturday = new Date(when.getTime() + ((6 - zonedParts(when, tz).weekday + 7) % 7) * 86400_000 + 7 * 86400_000);
    expect(zonedParts(saturday, tz).weekday).toBe(6);
    expect(await sendDueSummaries(saturday)).toEqual([]);

    // El texto corta las listas largas.
    const clinic = await (await import("@/lib/clinic")).getClinic(clinicId);
    const summary = await buildSummary(clinic, new Date(Date.now() - 86400_000), when);
    const many = { ...summary, nuevos: Array.from({ length: 45 }, () => summary.nuevos[0]) };
    expect(summaryText(many, clinic)).toContain("…y 5 más");
  });

  it("«Mandar el resumen ahora» desde el panel; sin nadie que lo reciba, avisa", async () => {
    const actions = await import("@/app/panel/protocol-actions");
    mocks.sent.length = 0;
    expect(await actions.sendSummaryNowAction({}, form({ clinic_id: clinicId }))).toMatchObject({ ok: true, message: expect.stringContaining("salió a 1 celular") });
    expect(mocks.sent).toHaveLength(1);
    await sql`update clinic_staff_phones set daily_summary = false where clinic_id = ${clinicId}`;
    expect(await actions.sendSummaryNowAction({}, form({ clinic_id: clinicId }))).toMatchObject({ ok: false, message: expect.stringContaining("Nadie del equipo") });
  });
});
