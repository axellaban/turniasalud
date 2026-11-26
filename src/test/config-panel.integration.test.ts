import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Configuración: feriados nacionales en un toque, quitar un período agrupado de una vez y el horario
// que recibe Sofi armado con la agenda. Datos ficticios; el calendario de feriados, simulado.

const mocks = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.cookies.has(name) ? { value: mocks.cookies.get(name) } : undefined),
    set: (name: string, value: string) => mocks.cookies.set(name, value),
    delete: (name: string) => mocks.cookies.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); }, notFound: () => { throw new Error("notFound"); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const url = testDatabaseUrl();
const form = (data: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) for (const x of [v].flat()) f.append(k, x);
  return f;
};

describe.runIf(url)("Configuración del consultorio", () => {
  let sql: typeof import("@/lib/db").sql;
  let clinicId: string;
  let actions: typeof import("@/app/panel/actions");
  let session: typeof import("@/lib/session");
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    const db = await scratchDatabase(url!, "turnia_config_panel_test");
    await resetTestDatabase(db);
    for (const [k, v] of Object.entries({ DATABASE_URL: db, SESSION_SECRET: "test-session", AGENT_TOOLS_SECRET: "x", PANEL_PASSWORD: "clave" })) vi.stubEnv(k, v);
    ({ sql } = await import("@/lib/db"));
    actions = await import("@/app/panel/actions");
    session = await import("@/lib/session");
    [{ id: clinicId }] = await sql`insert into clinics (name, specialty, is_demo, retained_at) values ('Consultorio de prueba', 'Odontología', false, now()) returning id`;
    mocks.cookies.set("turnia_session", session.createSessionToken());
    mocks.cookies.set("turnia_clinic", clinicId);
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-26T15:00:00Z") });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const year = String(input).match(/feriados\/(\d{4})/)?.[1];
      if (year === "2026") return Response.json([
        { fecha: "2026-05-01", tipo: "inamovible", nombre: "Día del Trabajador" },
        { fecha: "2026-12-07", tipo: "puente", nombre: "Puente turístico no laborable" },
        { fecha: "2026-12-08", tipo: "inamovible", nombre: "Inmaculada Concepción" },
        { fecha: "2026-12-25", tipo: "inamovible", nombre: "Navidad" },
      ]);
      if (year === "2027") return Response.json([{ fecha: "2027-01-01", tipo: "inamovible", nombre: "Año nuevo" }, { fecha: "2027-12-25", tipo: "inamovible", nombre: "Navidad" }]);
      return realFetch(input);
    }) as typeof fetch;
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
    await (await import("@/lib/db")).closeDb();
    vi.unstubAllEnvs();
  });

  it("carga los feriados que faltan del próximo año, sin puentes y sin repetirlos", async () => {
    expect(await actions.loadNationalHolidays({}, form({ clinic_id: clinicId }))).toEqual({ ok: true, message: "Se cargaron 3 feriados." });
    const rows = await sql`select reason, professional_id, starts_at, ends_at, external_id from schedule_blocks where clinic_id = ${clinicId} order by starts_at`;
    expect(rows.map((r) => r.external_id)).toEqual(["feriado:2026-12-08", "feriado:2026-12-25", "feriado:2027-01-01"]);
    // Todo el día en Buenos Aires (de 00:00 a 00:00 del siguiente) y para toda la clínica.
    expect(rows[0]).toMatchObject({ reason: "Inmaculada Concepción", professional_id: null });
    expect(new Date(rows[0].starts_at).toISOString()).toBe("2026-12-08T03:00:00.000Z");
    expect(new Date(rows[0].ends_at).toISOString()).toBe("2026-12-09T03:00:00.000Z");
    expect(await actions.loadNationalHolidays({}, form({ clinic_id: clinicId }))).toMatchObject({ ok: true, message: expect.stringContaining("Ya estaban") });
    expect(await actions.loadNationalHolidays({}, form({ clinic_id: clinicId, bridges: "on" }))).toEqual({ ok: true, message: "Se cargó 1 feriado." });
  });

  it("quita de una vez todos los bloqueos de un período agrupado, solo de esta clínica", async () => {
    const [{ id: other }] = await sql`insert into clinics (name, specialty) values ('Otra', 'Odontología') returning id`;
    const [foreign] = await sql`insert into schedule_blocks (clinic_id, starts_at, ends_at) values (${other}, now(), now() + interval '1 day') returning id`;
    const ids = (await sql`select id from schedule_blocks where clinic_id = ${clinicId} and external_id in ('feriado:2026-12-07', 'feriado:2026-12-08')`).map((r) => r.id);
    await actions.deleteScheduleBlock(form({ clinic_id: clinicId, id: [...ids, foreign.id, "no-es-un-id"] }));
    expect((await sql`select external_id from schedule_blocks where clinic_id = ${clinicId} order by starts_at`).map((r) => r.external_id)).toEqual(["feriado:2026-12-25", "feriado:2027-01-01"]);
    expect(await sql`select id from schedule_blocks where id = ${foreign.id}`).toHaveLength(1);
  });

  it("Sofi recibe el horario armado con la agenda si el texto quedó viejo o falta", async () => {
    const { clinicInfoText, getClinic } = await import("@/lib/clinic");
    const clinic = await getClinic(clinicId);
    const schedules = [1, 2, 3].map((weekday) => ({ id: String(weekday), professional_id: "p", weekday, start_time: "09:00:00", end_time: "17:30:00", urgent_only: false, appointment_type_ids: null }));
    expect(clinicInfoText({ ...clinic, hours_text: null }, undefined, { schedules })).toContain("Horario de atención: Lunes a miércoles de 9 a 17:30");
    const stale = clinicInfoText({ ...clinic, hours_text: "Lunes a miércoles de 10 a 17:30" }, undefined, { schedules });
    expect(stale).toContain("Horario de atención: Lunes a miércoles de 10 a 17:30");
    expect(stale).toContain("Horario según la agenda de turnos: Lunes a miércoles de 9 a 17:30. Si no coincide con el de arriba, vale este.");
    expect(clinicInfoText({ ...clinic, hours_text: "Lunes a miércoles de 9 a 17:30" }, undefined, { schedules })).not.toContain("según la agenda");
    // El mismo teléfono para el paciente y para derivar: una sola línea.
    const phones = clinicInfoText({ ...clinic, phone: "223 555-0000", handoff_phone: "2235550000" });
    expect(phones).toContain("Teléfono: 223 555-0000 (es también el de recepción para derivaciones)");
    expect(phones).not.toContain("Teléfono de recepción para derivaciones");
  });
});
