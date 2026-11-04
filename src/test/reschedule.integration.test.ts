import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GUERRA_MININNI } from "@/lib/agent/reschedule-policy";
import { addDaysKey, localDateKey } from "@/lib/time";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

const url = testDatabaseUrl();
const clinicId = GUERRA_MININNI;
const phone = "5491100004001";
const otherPhone = "5491100004002";
const timezone = "America/Argentina/Buenos_Aires";
const secret = "turnia-test-secret";
const day = (offset: number) => addDaysKey(localDateKey(new Date(), timezone), offset + 7);
const at = (offset: number, time: string) => new Date(`${day(offset)}T${time}:00-03:00`).toISOString();

vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn(async () => {}) }));

describe.runIf(url)("agenda de Guerra–Mininni a través de las herramientas de Sofi", () => {
  let sql: typeof import("@/lib/db").sql;
  let panelMove: typeof import("@/lib/agent/service").rescheduleClinicAppointment;
  let handler: typeof import("@/app/api/agent/tools/[name]/route").POST;
  let pro: string, alternate: string, patient: string, other: string;
  let control: string, cleaning: string, fallback: string, endodontics: string, implant: string;

  async function tool(name: string, input: Record<string, unknown> = {}, patientPhone = phone, channel = "whatsapp") {
    const request = new Request(`https://turnia.test/api/agent/tools/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-turnia-secret": secret },
      body: JSON.stringify({ clinic_id: clinicId, patient_phone: patientPhone, canal: channel, ...input }),
    });
    return (await handler(request, { params: Promise.resolve({ name }) })).json();
  }

  beforeAll(async () => {
    const db = await scratchDatabase(url!, "turnia_reschedule_test");
    await resetTestDatabase(db);
    vi.stubEnv("DATABASE_URL", db);
    vi.stubEnv("AGENT_TOOLS_SECRET", secret);
    ({ sql } = await import("@/lib/db"));
    ({ rescheduleClinicAppointment: panelMove } = await import("@/lib/agent/service"));
    ({ POST: handler } = await import("@/app/api/agent/tools/[name]/route"));
    await sql`insert into clinics (id, name) values (${clinicId}, 'Guerra–Mininni ficticia')`;
    [{ id: pro }, { id: alternate }] = await sql`
      insert into professionals (clinic_id, full_name, specialty)
      values (${clinicId}, 'Odontóloga de prueba', 'Odontología'), (${clinicId}, 'Odontólogo de prueba', 'Odontología')
      returning id`;
    await sql`
      insert into schedules (professional_id, weekday, start_time, end_time)
      select id, day, '09:00', '18:00' from professionals cross join generate_series(0, 6) as day where clinic_id = ${clinicId}`;
    [{ id: control }, { id: cleaning }, { id: fallback }, { id: endodontics }, { id: implant }] = await sql`
      insert into appointment_types (clinic_id, name, specialty, duration_min, panel_only) values
      (${clinicId}, 'Control', 'Odontología', 30, false),
      (${clinicId}, 'Mantenimiento periodontal (limpieza)', 'Odontología', 45, false),
      (${clinicId}, 'Turno Smile Connect', 'Odontología', 30, true),
      (${clinicId}, 'Endodoncia', 'Odontología', 120, true),
      (${clinicId}, 'Implante', 'Odontología', 90, true)
      returning id`;
    [{ id: patient }, { id: other }] = await sql`
      insert into patients (clinic_id, phone, full_name) values
      (${clinicId}, ${phone}, 'Paciente de prueba'), (${clinicId}, ${otherPhone}, 'Otra persona ficticia') returning id`;
  }, 60000);

  afterAll(async () => {
    const { closeDb } = await import("@/lib/db");
    await closeDb();
    vi.unstubAllEnvs();
  });

  async function seed(offset: number, minutes: number, opts: {
    type?: string; title?: string; notes?: string; source?: string; time?: string; pro?: string; patient?: string;
  } = {}) {
    const start = at(offset, opts.time ?? "10:00");
    const end = new Date(Date.parse(start) + minutes * 60_000).toISOString();
    const [{ id }] = await sql`
      insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, title, notes, source)
      values (${clinicId}, ${opts.patient ?? patient}, ${opts.pro ?? pro}, ${opts.type ?? control},
        ${start}, ${end}, 'confirmado', ${opts.title ?? null}, ${opts.notes ?? null}, ${opts.source ?? "panel"}) returning id`;
    return id as string;
  }

  const search = (id: string, offset: number, extra: Record<string, unknown> = {}, who = phone) =>
    tool("consultar_disponibilidad", { turno_id: id, desde: day(offset), hasta: day(offset), ...extra }, who);

  it("reserva con datos ficticios, ofrece mover sin cambiar la agenda, reprograma y cancela", async () => {
    const result = await tool("consultar_disponibilidad", { tipo_turno_id: control, profesional_id: pro, desde: day(0), hasta: day(0) });
    const booked = await tool("reservar_turno", { tipo_turno_id: control, profesional_id: pro, inicio: result.turnos[0].inicio });
    expect(booked.ok).toBe(true);
    const offers = await search(booked.turno_id, 1);
    expect(offers).toMatchObject({ ok: true, duracion_min: 30, turno_id: booked.turno_id });
    expect((await tool("ver_turnos_paciente")).turnos.map((a: { turno_id: string }) => a.turno_id)).toEqual([booked.turno_id]);
    const moved = await tool("reprogramar_turno", { turno_id: booked.turno_id, nuevo_inicio: offers.turnos[0].inicio });
    expect(moved.ok).toBe(true);
    expect((await tool("ver_turnos_paciente")).turnos).toEqual([
      expect.objectContaining({ turno_id: moved.turno_id, inicio: offers.turnos[0].inicio, profesional_id: pro }),
    ]);
    expect(await tool("confirmar_turno", { turno_id: moved.turno_id })).toMatchObject({ ok: true });
    expect(await tool("cancelar_turno", { turno_id: moved.turno_id })).toMatchObject({ ok: true });
    expect((await tool("ver_turnos_paciente")).turnos).toEqual([]);
    expect((await sql`select status from appointments where id in (${booked.turno_id}, ${moved.turno_id}) order by starts_at`).map((r) => r.status))
      .toEqual(["reprogramado", "cancelado"]);
  });

  it.each([
    ["colocación de implante", 60, () => ({ type: implant })],
    ["cirugía de regeneración", 90, () => ({ type: fallback, source: "smile_connect", notes: "Cirugía de regeneración ósea" })],
    ["extracción dental", 45, () => ({ type: fallback, source: "smile_connect", notes: "Extracción dental" })],
    ["extracción dental (exodoncia)", 45, () => ({ type: fallback, source: "smile_connect", notes: "EXODONCIA de pieza 18" })],
    ["más de dos horas", 121, () => ({ type: fallback, source: "smile_connect" })],
  ] as const)("deriva %s sin tocar el turno, tanto en WhatsApp como por teléfono", async (_label, minutes, opts) => {
    const id = await seed(2, minutes, opts());
    try {
      expect(await search(id, 3)).toMatchObject({ ok: false, error: expect.stringContaining("turno original sigue reservado") });
      for (const channel of ["whatsapp", "phone"]) {
        expect(await tool("reprogramar_turno", { turno_id: id, nuevo_inicio: at(3, "10:00") }, phone, channel))
          .toMatchObject({ ok: false, error: expect.stringContaining("derivacion_humana") });
      }
      const [original] = await sql`select status, starts_at from appointments where id = ${id}`;
      expect(original).toEqual({ status: "confirmado", starts_at: at(2, "10:00") });
      expect((await sql`select id from appointments where starts_at = ${at(3, "10:00")}`)).toHaveLength(0);
    } finally {
      await sql`delete from appointments where id = ${id}`;
    }
  });

  it("mueve una endodoncia de 120 minutos ya reservada y conserva el tipo, aun siendo solo de recepción para reservas", async () => {
    const id = await seed(4, 120, { type: endodontics, source: "smile_connect" });
    expect(await tool("consultar_disponibilidad", { tipo_turno_id: endodontics })).toMatchObject({ ok: false, error: expect.stringContaining("solo el consultorio") });
    const offers = await search(id, 5);
    expect(offers).toMatchObject({ ok: true, duracion_min: 120 });
    const moved = await tool("reprogramar_turno", { turno_id: id, nuevo_inicio: offers.turnos[0].inicio }, phone, "phone");
    expect(moved.ok).toBe(true);
    expect(await search(moved.turno_id, 6)).toMatchObject({ ok: true, duracion_min: 120 });
    expect((await sql`select appointment_type_id from appointments where id = ${moved.turno_id}`)[0].appointment_type_id).toBe(endodontics);
  });

  it("una consulta de implantes se puede cambiar de profesional y conserva su título", async () => {
    const id = await seed(7, 30, { title: "Consulta de implantes" });
    const offers = await search(id, 8, { profesional_id: alternate });
    expect(offers.turnos[0].profesional_id).toBe(alternate);
    const moved = await tool("reprogramar_turno", { turno_id: id, nuevo_inicio: offers.turnos[0].inicio, profesional_id: alternate });
    expect(moved.ok).toBe(true);
    expect((await sql`select title, professional_id from appointments where id = ${moved.turno_id}`)[0])
      .toEqual({ title: "Consulta de implantes", professional_id: alternate });
  });

  it("una visita de control y limpieza se mueve completa, y cada cancelación afecta al turno solicitado", async () => {
    const id = await seed(9, 30);
    await seed(9, 45, { type: cleaning, time: "10:30" });
    const offers = await search(id, 10);
    expect(offers).toMatchObject({ ok: true, duracion_min: 75, segunda_practica: "Mantenimiento periodontal (limpieza)" });
    const moved = await tool("reprogramar_turno", { turno_id: id, nuevo_inicio: offers.turnos[0].inicio });
    expect(moved).toMatchObject({ ok: true, segundo_turno_id: expect.any(String) });
    const cancelled = await tool("cancelar_turno", { turno_id: moved.turno_id });
    expect(cancelled).toMatchObject({ ok: true, aviso: expect.stringContaining(moved.segundo_turno_id) });
    expect((await sql`select status from appointments where id = ${moved.segundo_turno_id}`)[0].status).toBe("confirmado");
    expect(await tool("cancelar_turno", { turno_id: moved.segundo_turno_id })).toMatchObject({ ok: true });
  });

  it("mover un control no arrastra una extracción consecutiva y recepción puede mover la extracción", async () => {
    const id = await seed(11, 30);
    const extraction = await seed(11, 40, { type: fallback, source: "smile_connect", notes: "Extracción dental", time: "10:30" });
    expect(await search(id, 12)).toMatchObject({ ok: false, error: expect.stringContaining("recepción") });
    expect(await tool("reprogramar_turno", { turno_id: id, nuevo_inicio: at(12, "10:00") })).toMatchObject({ ok: false });
    expect(await panelMove(clinicId, extraction, { nuevo_inicio: at(12, "10:30") })).toMatchObject({ ok: true });
    expect((await sql`select status from appointments where id = ${id}`)[0].status).toBe("confirmado");
  });

  it("una visita consecutiva de 125 minutos se deriva aunque cada práctica dure menos de dos horas", async () => {
    const id = await seed(17, 80, { type: fallback, source: "smile_connect" });
    await seed(17, 45, { type: cleaning, time: "11:20" });
    expect(await search(id, 18)).toMatchObject({ ok: false, error: expect.stringContaining("más de dos horas") });
    expect(await tool("reprogramar_turno", { turno_id: id, nuevo_inicio: at(18, "10:00") }))
      .toMatchObject({ ok: false, error: expect.stringContaining("más de dos horas") });
  });

  it("un turno de Smile sin tipo específico conserva sus 55 minutos y respeta los bloqueos de agenda", async () => {
    const id = await seed(19, 55, { type: fallback, source: "smile_connect" });
    await sql`insert into schedule_blocks (clinic_id, professional_id, starts_at, ends_at, reason)
      values (${clinicId}, ${pro}, ${at(20, "09:00")}, ${at(20, "18:00")}, 'Bloqueo ficticio')`;
    expect(await search(id, 20)).toMatchObject({ ok: true, turnos: [], mensaje: expect.stringContaining("sigue reservado") });
    const result = await search(id, 21);
    expect(result).toMatchObject({ ok: true, duracion_min: 55 });
    const moved = await tool("reprogramar_turno", { turno_id: id, nuevo_inicio: result.turnos[0].inicio });
    expect(moved.ok).toBe(true);
    expect(await search(moved.turno_id, 22)).toMatchObject({ ok: true, duracion_min: 55 });
  });

  it("rechaza IDs ajenos y horarios que se ocuparon sin soltar el original; dos cambios simultáneos solo crean un turno", async () => {
    const id = await seed(13, 30);
    expect(await search(id, 14, {}, otherPhone)).toMatchObject({ ok: false, error: expect.stringContaining("para este paciente") });
    const offers = await search(id, 14);
    const [chosen] = offers.turnos;
    const hour = new Date(Date.parse(chosen.inicio) - 3 * 3600_000).toISOString().slice(11, 16);
    await seed(14, 30, { time: hour, patient: other });
    expect(await tool("reprogramar_turno", { turno_id: id, nuevo_inicio: chosen.inicio }))
      .toMatchObject({ ok: false, error: expect.stringContaining("ocupado") });
    expect((await sql`select status from appointments where id = ${id}`)[0].status).toBe("confirmado");
    const proposals = await Promise.all([15, 16].map((offset) => tool("reprogramar_turno", { turno_id: id, nuevo_inicio: at(offset, "11:00") })));
    expect(proposals.filter((r) => r.ok)).toHaveLength(1);
    expect(await sql`select id from appointments where patient_id = ${patient} and starts_at in (${at(15, "11:00")}, ${at(16, "11:00")}) and status = 'confirmado'`)
      .toHaveLength(1);
  });
});
