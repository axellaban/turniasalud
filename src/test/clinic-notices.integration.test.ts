import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDaysKey, localDateKey } from "@/lib/time";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Avisos al consultorio por WhatsApp: cuando Sofi da, mueve o cancela un turno a pedido de un
// paciente, a los celulares cargados en Configuración les llega el detalle. WhatsApp está simulado:
// ningún mensaje sale a un número real (todos los números son ficticios).

const mocks = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  after: [] as Array<() => unknown>,
  sent: [] as Array<{ chatId: string; text: string }>,
  fail: { next: false },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.cookies.has(name) ? { value: mocks.cookies.get(name) } : undefined),
    set: (name: string, value: string) => mocks.cookies.set(name, value),
    delete: (name: string) => mocks.cookies.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); }, notFound: () => { throw new Error("notFound"); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (fn: () => unknown) => mocks.after.push(fn) }));
vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn(async () => {}) }));
vi.mock("@/lib/waha", async (original) => ({
  ...(await original<typeof import("@/lib/waha")>()),
  wahaSendText: vi.fn(async (chatId: string, text: string) => {
    if (mocks.fail.next) {
      mocks.fail.next = false;
      throw new Error("WAHA POST /api/sendText → 500");
    }
    mocks.sent.push({ chatId, text });
    return { id: "msg" };
  }),
}));

const url = testDatabaseUrl();
const timezone = "America/Argentina/Buenos_Aires";
const secret = "turnia-test-secret";
const at = (offset: number, time: string) => new Date(`${addDaysKey(localDateKey(new Date(), timezone), offset)}T${time}:00-03:00`).toISOString();
// Números ficticios.
const patientPhone = "5491100007001";
const reception = "5491100007100";
const doctor = "5491100007200";
const staffPhone = "5491100007300";
const form = (data: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
};

type Result = Record<string, unknown> & { ok: boolean; error?: string; turno_id?: string };

describe.runIf(url)("avisos al consultorio por WhatsApp", () => {
  let sql: typeof import("@/lib/db").sql;
  let handler: typeof import("@/app/api/agent/tools/[name]/route").POST;
  let actions: typeof import("@/app/panel/notice-actions");
  let notices: typeof import("@/lib/clinic-notices");
  let clinicId: string, pro: string, cleaning: string;

  async function tool(name: string, input: Record<string, unknown>, phone = patientPhone, canal = "whatsapp"): Promise<Result> {
    const request = new Request(`https://turnia.test/api/agent/tools/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-turnia-secret": secret },
      body: JSON.stringify({ clinic_id: clinicId, patient_phone: phone, canal, conversation_id: `conv-${phone}`, ...input }),
    });
    return (await handler(request, { params: Promise.resolve({ name }) })).json();
  }

  async function runAfter() {
    const pending = mocks.after.splice(0);
    for (const fn of pending) await fn();
  }

  beforeAll(async () => {
    const db = await scratchDatabase(url!, "turnia_clinic_notices_test");
    await resetTestDatabase(db);
    for (const [k, v] of Object.entries({
      DATABASE_URL: db,
      AGENT_TOOLS_SECRET: secret,
      SESSION_SECRET: "test-session",
      APP_URL: "https://turnia.test",
      WAHA_URL: "https://waha.test.invalid",
      WAHA_API_KEY: "clave-de-prueba-waha",
      WAHA_WEBHOOK_HMAC: "hmac-de-prueba-waha",
      ELEVENLABS_CHANNEL_URL: "https://canal.test.invalid",
      ELEVENLABS_CHANNEL_SECRET: "secreto-de-prueba-canal",
      ELEVENLABS_CHANNEL_SIGNING_SECRET: "firma-de-prueba-canal",
    })) vi.stubEnv(k, v);
    ({ sql } = await import("@/lib/db"));
    ({ POST: handler } = await import("@/app/api/agent/tools/[name]/route"));
    actions = await import("@/app/panel/notice-actions");
    notices = await import("@/lib/clinic-notices");
    [{ id: clinicId }] = await sql`
      insert into clinics (name, specialty, is_demo, retained_at, whatsapp_provider, agent_name)
      values ('Consultorio de avisos', 'Odontología', true, now(), 'waha', 'Sofi') returning id`;
    [{ id: pro }] = await sql`insert into professionals (clinic_id, full_name, specialty) values (${clinicId}, 'Dra. Prueba', 'Odontología') returning id`;
    await sql`insert into schedules (professional_id, weekday, start_time, end_time) select ${pro}::uuid, d, '09:00', '18:00' from generate_series(0, 6) d`;
    [{ id: cleaning }] = await sql`
      insert into appointment_types (clinic_id, name, specialty, duration_min) values (${clinicId}, 'Limpieza', 'Odontología', 30) returning id`;
    await sql`insert into clinic_staff_phones (clinic_id, phone, name) values (${clinicId}, ${staffPhone}, 'Recepción con acceso')`;
    await tool("registrar_paciente", { nombre_completo: "Juana Ficticia", dni: "30111222", cobertura: "Particular", fecha_nacimiento: "1990-05-20" });
  }, 60000);

  beforeEach(async () => {
    mocks.cookies.clear();
    mocks.cookies.set("turnia_session", (await import("@/lib/session")).createSessionToken());
    mocks.cookies.set("turnia_clinic", clinicId);
    mocks.sent.length = 0;
    mocks.after.length = 0;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await sql?.end();
  });

  it("sin celulares cargados, no se avisa nada", async () => {
    const booked = await tool("reservar_turno", { tipo_turno_id: cleaning, profesional_id: pro, inicio: at(5, "10:00") });
    expect(booked.ok).toBe(true);
    await runAfter();
    expect(mocks.sent).toEqual([]);
    expect((await sql`select count(*)::int as n from clinic_notices`)[0].n).toBe(0);
    await tool("cancelar_turno", { turno_id: booked.turno_id });
  });

  it("el panel valida y guarda los celulares, con los avisos que quiere cada uno", async () => {
    expect(await actions.addNoticePhone({}, form({ clinic_id: clinicId, name: "Recepción", phone: "123", event_nuevo: "on" })))
      .toMatchObject({ ok: false, message: expect.stringContaining("Revisá el celular") });
    expect(await actions.addNoticePhone({}, form({ clinic_id: clinicId, name: "Recepción", phone: "11 0000-7100" })))
      .toMatchObject({ ok: false, message: expect.stringContaining("al menos un aviso") });
    expect(await actions.addNoticePhone({}, form({ clinic_id: clinicId, name: "Recepción", phone: "11 0000-7100", event_nuevo: "on", event_movido: "on", event_cancelado: "on" })))
      .toMatchObject({ ok: true });
    expect(await actions.addNoticePhone({}, form({ clinic_id: clinicId, name: "Dra. Prueba", phone: "11 0000-7200", event_nuevo: "on" })))
      .toMatchObject({ ok: true });
    const phones = await notices.listNoticePhones(clinicId);
    expect(phones.map((p) => [p.name, p.phone, p.events])).toEqual([
      ["Recepción", reception, ["nuevo", "movido", "cancelado"]],
      ["Dra. Prueba", doctor, ["nuevo"]],
    ]);
  });

  it("turno nuevo: llega el detalle con la prestación, el motivo y el paciente", async () => {
    const booked = await tool("reservar_turno", {
      tipo_turno_id: cleaning, profesional_id: pro, inicio: at(6, "11:30"), notas: "Le sangran las encías al cepillarse", titulo: "Limpieza y control",
    });
    expect(booked.ok).toBe(true);
    await runAfter();
    expect(mocks.sent.map((m) => m.chatId).sort()).toEqual([`${reception}@c.us`, `${doctor}@c.us`]);
    const text = mocks.sent[0].text;
    expect(text).toContain("*Turno nuevo* · lo dio Sofi por WhatsApp");
    expect(text).toMatch(/\*\S+ \d{1,2}\/\d{1,2}, 11:30 a 12:00\* · Dra\. Prueba/);
    expect(text).toContain("Paciente: Juana Ficticia · +54 9 11 0000-7001 · DNI 30111222");
    expect(text).toContain("Prestación: Limpieza (Limpieza y control)");
    expect(text).toContain("Motivo: Le sangran las encías al cepillarse");
    const rows = await sql`select status, kind, sent_at from clinic_notices order by created_at`;
    expect(rows.every((r) => r.status === "enviado" && r.kind === "nuevo" && r.sent_at)).toBe(true);
  });

  it("turno movido y cancelado: solo a quien eligió esos avisos, con el antes y el motivo", async () => {
    const [appt] = await sql`select id from appointments where clinic_id = ${clinicId} and status = 'confirmado' and notes is not null`;
    const moved = await tool("reprogramar_turno", { turno_id: appt.id, nuevo_inicio: at(7, "15:00") });
    expect(moved.ok).toBe(true);
    await runAfter();
    expect(mocks.sent.map((m) => m.chatId)).toEqual([`${reception}@c.us`]);
    expect(mocks.sent[0].text).toContain("*Turno movido* · lo movió Sofi por WhatsApp");
    expect(mocks.sent[0].text).toMatch(/Antes: \S+ \d{1,2}\/\d{1,2}, 11:30 · Dra\. Prueba/);
    expect(mocks.sent[0].text).toMatch(/\*Ahora: \S+ \d{1,2}\/\d{1,2}, 15:00 a 15:30\* · Dra\. Prueba/);

    mocks.sent.length = 0;
    const cancelled = await tool("cancelar_turno", { turno_id: moved.turno_id, motivo: "Se va de viaje" });
    expect(cancelled.ok).toBe(true);
    await runAfter();
    expect(mocks.sent.map((m) => m.chatId)).toEqual([`${reception}@c.us`]);
    expect(mocks.sent[0].text).toContain("*Turno cancelado* · lo canceló Sofi por WhatsApp");
    expect(mocks.sent[0].text).toContain("Motivo de la cancelación: Se va de viaje");
  });

  it("lo que hace el equipo por WhatsApp no se avisa", async () => {
    const [patient] = await sql`select id from patients where clinic_id = ${clinicId} and phone = ${patientPhone}`;
    const booked = await tool("reservar_turno", { paciente_id: patient.id, tipo_turno_id: cleaning, profesional_id: pro, inicio: at(8, "10:00") }, staffPhone);
    expect(booked.ok).toBe(true);
    await runAfter();
    expect(mocks.sent).toEqual([]);
    await tool("cancelar_turno", { turno_id: booked.turno_id }, staffPhone);
  });

  it("si WhatsApp falla, el aviso queda en la cola y sale con la automatización", async () => {
    mocks.fail.next = true;
    await sql`update clinic_notice_phones set events = array['nuevo']::text[] where phone = ${doctor}`;
    await sql`delete from clinic_notice_phones where phone = ${reception}`;
    const booked = await tool("reservar_turno", { tipo_turno_id: cleaning, profesional_id: pro, inicio: at(9, "10:00") });
    expect(booked.ok).toBe(true);
    await runAfter();
    expect(mocks.sent).toEqual([]);
    const [failed] = await sql`select status, attempts, error from clinic_notices where appointment_id = ${booked.turno_id!}`;
    expect(failed).toMatchObject({ status: "error", attempts: 1, error: expect.stringContaining("500") });

    const { POST: automation } = await import("@/app/api/automations/[job]/route");
    const res = await automation(
      new Request("https://turnia.test/api/automations/calendario", { method: "POST", headers: { "x-turnia-secret": secret } }),
      { params: Promise.resolve({ job: "calendario" }) },
    );
    expect(await res.json()).toMatchObject({ ok: true, avisos_al_consultorio: { enviados: 1, errores: 0 } });
    expect(mocks.sent.map((m) => m.chatId)).toEqual([`${doctor}@c.us`]);
    const [sent] = await sql`select status, attempts from clinic_notices where appointment_id = ${booked.turno_id!}`;
    expect(sent).toEqual({ status: "enviado", attempts: 2 });
  });

  it("aviso de prueba desde el panel; un aviso viejo ya no sale", async () => {
    const [phone] = await sql`select id from clinic_notice_phones where phone = ${doctor}`;
    expect(await actions.testNoticePhone({}, form({ clinic_id: clinicId, id: phone.id }))).toMatchObject({ ok: true });
    expect(mocks.sent).toHaveLength(1);
    expect(mocks.sent[0].text).toContain("*Aviso de prueba* de Sofi (Consultorio de avisos)");

    mocks.sent.length = 0;
    await sql`
      insert into clinic_notices (clinic_id, phone, kind, body, created_at)
      values (${clinicId}, ${doctor}, 'nuevo', 'Aviso de ayer', now() - interval '2 days')`;
    expect(await notices.sendPendingNotices(clinicId)).toMatchObject({ enviados: 0, vencidos: 1 });
    expect(mocks.sent).toEqual([]);
  });
});
