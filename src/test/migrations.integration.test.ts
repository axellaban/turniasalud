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

  it("las reglas de Guerra–Mininni pasan a su ficha una sola vez y después manda el panel", async () => {
    const mininni = "67c3954a-8df8-46c2-a604-f818832bee36";
    const schema = readFileSync("supabase/schema.sql", "utf8");
    // Como en producción: la clínica ya existe cuando corre el deploy con la migración nueva.
    await db`insert into clinics (id, name) values (${mininni}, 'Guerra–Mininni ficticia')`;
    await db`delete from data_migrations where name = '2026-11-04-reglas-guerra-mininni'`;
    await db.unsafe(schema);
    const rules = () => db`
      select reschedule_notice_hours, reschedule_max_minutes, keep_duration_on_reschedule, reception_only_terms, move_panel_only, cancel_notice_hours
      from clinics where id = ${mininni}`;
    expect((await rules())[0]).toEqual({
      reschedule_notice_hours: 24, reschedule_max_minutes: 120, keep_duration_on_reschedule: true,
      reception_only_terms: "implante, implantación, exodoncia, extracción, regeneración", move_panel_only: true, cancel_notice_hours: null,
    });
    // Las demás clínicas no cambian.
    expect((await db`select reschedule_notice_hours, move_panel_only from clinics where id = '00000000-0000-4000-8000-000000000001'`)[0])
      .toEqual({ reschedule_notice_hours: null, move_panel_only: false });
    // El consultorio cambia una regla desde el panel: el próximo deploy no la pisa.
    await db`update clinics set reschedule_notice_hours = 12, move_panel_only = false where id = ${mininni}`;
    await db.unsafe(schema);
    expect((await rules())[0]).toMatchObject({ reschedule_notice_hours: 12, move_panel_only: false, reschedule_max_minutes: 120 });
    await db`delete from clinics where id = ${mininni}`;
  }, 60000);
});
