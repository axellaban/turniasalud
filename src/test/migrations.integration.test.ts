import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

const base = testDatabaseUrl();
describe.runIf(base)("migraciones sobre una agenda ya sincronizada", () => {
  let db: ReturnType<typeof postgres>;
  beforeAll(async () => {
    const url = await scratchDatabase(base!, "turnia_test_migrations");
    await resetTestDatabase(url);
    db = postgres(url, { max: 1, onnotice: () => {} });
  }, 60000);
  afterAll(async () => { await db?.end(); });

  it("reaplica el esquema con turnos de Smile Connect existentes, sin perderlos ni quitar la validación", async () => {
    const [patient] = await db`insert into patients (clinic_id, full_name, phone)
      values ('00000000-0000-4000-8000-000000000001', 'Prueba de migración', '5491155559999') returning id`;
    const [appointment] = await db`insert into appointments
      (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, source, external_id)
      values ('00000000-0000-4000-8000-000000000001', ${patient.id},
        '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000b5',
        '2040-01-02T14:00:00Z', '2040-01-02T14:45:00Z', 'smile_connect', 'prueba-migracion-smile') returning id`;
    const schema = readFileSync("supabase/schema.sql", "utf8");
    await db.unsafe(schema);
    await db.unsafe(schema);
    expect(await db`select patient_id, source, external_id from appointments where id = ${appointment.id}`)
      .toMatchObject([{ patient_id: patient.id, source: "smile_connect", external_id: "prueba-migracion-smile" }]);
    await expect(db`update appointments set source = 'origen-invalido' where id = ${appointment.id}`)
      .rejects.toMatchObject({ code: "23514" });
    expect((await db`select source from appointments where id = ${appointment.id}`)[0].source).toBe("smile_connect");
  }, 60000);
});
