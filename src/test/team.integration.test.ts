import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Configuración → Equipo por WhatsApp: una sola lista para los avisos, el resumen y el acceso total.
// Por dentro siguen las dos tablas (los avisos de Smile Connect y el acceso de Sofi no cambian).
// El consultorio carga avisos y elige quién recibe el resumen; el acceso total lo da Turnia. Datos ficticios.

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
const form = (data: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
};

describe.runIf(url)("equipo por WhatsApp", () => {
  let sql: typeof import("@/lib/db").sql;
  let clinicId: string;
  let actions: typeof import("@/app/panel/notice-actions");
  let protocol: typeof import("@/app/panel/protocol-actions");
  let session: typeof import("@/lib/session");

  beforeAll(async () => {
    const db = await scratchDatabase(url!, "turnia_team_test");
    await resetTestDatabase(db);
    for (const [k, v] of Object.entries({ DATABASE_URL: db, SESSION_SECRET: "test-session", AGENT_TOOLS_SECRET: "x", PANEL_PASSWORD: "clave" })) vi.stubEnv(k, v);
    ({ sql } = await import("@/lib/db"));
    actions = await import("@/app/panel/notice-actions");
    protocol = await import("@/app/panel/protocol-actions");
    session = await import("@/lib/session");
    [{ id: clinicId }] = await sql`insert into clinics (name, specialty, is_demo, retained_at) values ('Consultorio del equipo', 'Odontología', false, now()) returning id`;
  });

  afterAll(async () => {
    await (await import("@/lib/db")).closeDb();
    vi.unstubAllEnvs();
  });

  const asAdmin = () => {
    mocks.cookies.set("turnia_session", session.createSessionToken());
    mocks.cookies.set("turnia_clinic", clinicId);
  };
  async function asClinic() {
    const { createClinicAccess } = await import("@/lib/clinic-access");
    const { access } = await createClinicAccess(clinicId, "Recepción");
    mocks.cookies.set("turnia_session", session.createClinicSessionToken(access.id));
  }

  it("Turnia agrega a alguien con avisos, acceso total y resumen en un solo paso", async () => {
    asAdmin();
    const r = await actions.addTeamMember({}, form({ clinic_id: clinicId, name: "Dra. Prueba", phone: "11 0000-7001", event_nuevo: "on", event_cancelado: "on", access: "on", summary: "on" }));
    expect(r).toMatchObject({ ok: true });
    expect(await sql`select phone, events from clinic_notice_phones where clinic_id = ${clinicId}`).toEqual([{ phone: "5491100007001", events: ["nuevo", "cancelado"] }]);
    expect(await sql`select phone, daily_summary from clinic_staff_phones where clinic_id = ${clinicId}`).toEqual([{ phone: "5491100007001", daily_summary: true }]);
  });

  it("el resumen va con el acceso total, y hay que elegir algo", async () => {
    asAdmin();
    expect(await actions.addTeamMember({}, form({ clinic_id: clinicId, name: "X", phone: "11 0000-7002", summary: "on" }))).toMatchObject({ ok: false });
    expect(await actions.addTeamMember({}, form({ clinic_id: clinicId, name: "X", phone: "11 0000-7002" }))).toMatchObject({ ok: false });
  });

  it("el consultorio carga avisos y elige quién recibe el resumen, pero no da acceso total ni lo quita", async () => {
    await asClinic();
    expect(await actions.addTeamMember({}, form({ clinic_id: clinicId, name: "Recepción", phone: "11 0000-7003", access: "on" }))).toMatchObject({ ok: false });
    expect(await actions.addTeamMember({}, form({ clinic_id: clinicId, name: "Recepción", phone: "11 0000-7003", event_nuevo: "on" }))).toMatchObject({ ok: true });
    expect(await sql`select count(*)::int as n from clinic_staff_phones where phone = '5491100007003'`).toEqual([{ n: 0 }]);

    const [{ id }] = await sql`select id from clinic_staff_phones where phone = '5491100007001'`;
    await protocol.toggleStaffSummary(form({ clinic_id: clinicId, id, on: "0" }));
    expect(await sql`select daily_summary from clinic_staff_phones where id = ${id}`).toEqual([{ daily_summary: false }]);

    // «Quitar» desde el consultorio: deja de recibir avisos, pero el acceso total sigue (lo quita Turnia).
    await actions.removeTeamMember(form({ clinic_id: clinicId, phone: "5491100007001" }));
    expect(await sql`select count(*)::int as n from clinic_notice_phones where phone = '5491100007001'`).toEqual([{ n: 0 }]);
    expect(await sql`select count(*)::int as n from clinic_staff_phones where phone = '5491100007001'`).toEqual([{ n: 1 }]);

    asAdmin();
    await actions.removeTeamMember(form({ clinic_id: clinicId, phone: "5491100007001" }));
    expect(await sql`select count(*)::int as n from clinic_staff_phones where phone = '5491100007001'`).toEqual([{ n: 0 }]);
  });

  it("cada celular aparece una vez, con lo de las dos listas", async () => {
    const { teamMembers } = await import("@/app/panel/(app)/configuracion/notice-card");
    const notice = { id: "n1", clinic_id: clinicId, phone: "5491100007009", name: "Recepción", events: ["nuevo"], created_at: "" };
    const staff = { id: "s1", clinic_id: clinicId, phone: "5491100007009", name: "Recepción", daily_summary: true, created_at: "" };
    const other = { ...notice, id: "n2", phone: "5491100007010", name: "Otra" };
    const members = teamMembers([notice, other] as never, [staff]);
    expect(members.map((m) => [m.phone, Boolean(m.notice), Boolean(m.staff)])).toEqual([["5491100007009", true, true], ["5491100007010", true, false]]);
  });

  it("opciones de la clínica que antes eran solo de Guerra–Mininni: identidad, ficha de salud y días del resumen", async () => {
    await asClinic();
    const { healthFormSheet } = await import("@/lib/health-form");
    const r = await protocol.saveBookingRules({}, form({
      clinic_id: clinicId, rules_form: "1", verify_appointment_access: "on",
      health_form_field: "1", health_form_monogram: "ae", health_form_text: "DRA. ANA EJEMPLO\r\nODONTÓLOGA\r\nM. N. 00000\r\n\r\nDR. JUAN EJEMPLO\nODONTÓLOGO",
    }));
    expect(r).toMatchObject({ ok: true });
    const [c] = await sql`select verify_appointment_access, health_form from clinics where id = ${clinicId}`;
    expect(c.verify_appointment_access).toBe(true);
    expect(healthFormSheet(c)).toEqual({
      monogram: "AE",
      professionals: [{ name: "DRA. ANA EJEMPLO", lines: ["ODONTÓLOGA", "M. N. 00000"] }, { name: "DR. JUAN EJEMPLO", lines: ["ODONTÓLOGO"] }],
    });
    // Vaciar la ficha la apaga; la casilla sin marcar apaga la verificación.
    await protocol.saveBookingRules({}, form({ clinic_id: clinicId, rules_form: "1", health_form_field: "1", health_form_text: "" }));
    const [off] = await sql`select verify_appointment_access, health_form from clinics where id = ${clinicId}`;
    expect(off).toEqual({ verify_appointment_access: false, health_form: null });

    await actions.setSummaryDays(form({ clinic_id: clinicId, summary_last_weekday: "4" }));
    expect((await sql`select summary_last_weekday from clinics where id = ${clinicId}`)[0].summary_last_weekday).toBe(4);
    await actions.setSummaryDays(form({ clinic_id: clinicId, summary_last_weekday: "9" }));
    expect((await sql`select summary_last_weekday from clinics where id = ${clinicId}`)[0].summary_last_weekday).toBe(4);
  });
});
