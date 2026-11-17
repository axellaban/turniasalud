import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Ficha del paciente → «Editar datos»: el equipo corrige nombre, celular, DNI, cobertura, memoria y
// notas. El celular anterior sigue reconociendo la ficha y la sincronización con Smile Connect (que
// solo completa campos vacíos) no pisa lo editado. Datos ficticios.

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

describe.runIf(url)("editar la ficha del paciente", () => {
  let sql: typeof import("@/lib/db").sql;
  let actions: typeof import("@/app/panel/actions");
  let clinicId: string, patientId: string, otherClinicPatient: string;

  beforeAll(async () => {
    const db = await scratchDatabase(url!, "turnia_patient_edit_test");
    await resetTestDatabase(db);
    for (const [k, v] of Object.entries({ DATABASE_URL: db, SESSION_SECRET: "test-session", AGENT_TOOLS_SECRET: "x", PANEL_PASSWORD: "clave" })) vi.stubEnv(k, v);
    ({ sql } = await import("@/lib/db"));
    actions = await import("@/app/panel/actions");
    [{ id: clinicId }] = await sql`insert into clinics (name, specialty, is_demo, retained_at) values ('Consultorio de fichas', 'Odontología', false, now()) returning id`;
    [{ id: patientId }] = await sql`
      insert into patients (clinic_id, full_name, phone, dni, coverage, memory_summary)
      values (${clinicId}, 'Ana Ficticia', '5491100006001', '30111000', 'OSDE', 'Dice que le duele una muela.') returning id`;
    const [{ id: other }] = await sql`insert into clinics (name, specialty) values ('Otra clínica', 'Odontología') returning id`;
    [{ id: otherClinicPatient }] = await sql`insert into patients (clinic_id, full_name, phone) values (${other}, 'De otra', '5491100006009') returning id`;
    const { createSessionToken } = await import("@/lib/session");
    mocks.cookies.set("turnia_session", createSessionToken());
    mocks.cookies.set("turnia_clinic", clinicId);
  });

  afterAll(async () => {
    await (await import("@/lib/db")).closeDb();
    vi.unstubAllEnvs();
  });

  it("guarda los datos, corrige la memoria y el celular anterior sigue reconociendo la ficha", async () => {
    const r = await actions.updatePatientDetails({}, form({
      clinic_id: clinicId, id: patientId, full_name: "Ana María Ficticia", phone: "11 0000-6002", dni: "30.111.000",
      birth_date: "1990-05-04", sex: "femenino", email: "ANA@EJEMPLO.COM", coverage: "Swiss Medical", coverage_plan: "SMG20",
      memory_summary: "", notes: "Prefiere que la llamen.",
    }));
    expect(r).toMatchObject({ ok: true });
    const [p] = await sql`select full_name, phone, dni, birth_date::text, sex, email, coverage, coverage_plan, memory_summary, notes from patients where id = ${patientId}`;
    expect(p).toEqual({
      full_name: "Ana María Ficticia", phone: "5491100006002", dni: "30111000", birth_date: "1990-05-04", sex: "femenino",
      email: "ana@ejemplo.com", coverage: "Swiss Medical", coverage_plan: "SMG20", memory_summary: null, notes: "Prefiere que la llamen.",
    });
    expect(await sql`select patient_id from patient_phones where phone = '5491100006001'`).toEqual([{ patient_id: patientId }]);
  });

  it("rechaza datos que no sirven y no toca fichas de otra clínica", async () => {
    expect(await actions.updatePatientDetails({}, form({ clinic_id: clinicId, id: patientId, full_name: "" }))).toMatchObject({ ok: false });
    expect(await actions.updatePatientDetails({}, form({ clinic_id: clinicId, id: patientId, full_name: "Ana", phone: "123" }))).toMatchObject({ ok: false });
    expect(await actions.updatePatientDetails({}, form({ clinic_id: clinicId, id: patientId, full_name: "Ana", email: "sin-arroba" }))).toMatchObject({ ok: false });
    expect(await actions.updatePatientDetails({}, form({ clinic_id: clinicId, id: otherClinicPatient, full_name: "Cambiada" }))).toMatchObject({ ok: false });
    expect(await sql`select full_name from patients where id = ${otherClinicPatient}`).toEqual([{ full_name: "De otra" }]);
  });
});
