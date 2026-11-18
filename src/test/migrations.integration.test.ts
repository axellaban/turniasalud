import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

const base = testDatabaseUrl();
// La frase de las radiografías como estaba en las instrucciones de Guerra–Mininni.
const OLD_RADIOGRAFIAS = "- Una vez confirmado, si es primera consulta o el paciente refiere una molestia, preguntá brevemente si tiene radiografías actuales (de menos de un año). Si no las tiene, decí «Le conviene traer las radiografías para que el doctor pueda verlas en la primera consulta y evitar otra visita solo para traer los estudios. Si no llega a hacerlas, su turno sigue confirmado». No lo menciones en un control o mantenimiento de rutina sin molestias, salvo que el paciente pregunte.";
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

  it("las opciones que estaban atadas a Guerra–Mininni en el código pasan a su ficha una sola vez", async () => {
    const mininni = "67c3954a-8df8-46c2-a604-f818832bee36";
    const schema = readFileSync("supabase/schema.sql", "utf8");
    await db`insert into clinics (id, name) values (${mininni}, 'Guerra–Mininni ficticia')`;
    await db`delete from data_migrations where name = '2026-11-18-opciones-guerra-mininni'`;
    await db.unsafe(schema);
    const options = async () => (await db`
      select verify_appointment_access, summary_last_weekday, health_form from clinics where id = ${mininni}`)[0];
    const set = await options();
    expect(set).toMatchObject({ verify_appointment_access: true, summary_last_weekday: 4 });
    expect(set.health_form).toMatchObject({ monogram: "CG", professionals: [expect.objectContaining({ name: "DR. CLAUDIO M. GUERRA" }), expect.objectContaining({ name: "DR. MARIANO MININNI" })] });
    // Las demás clínicas quedan como estaban: sin permiso temporal, resumen de lunes a viernes, sin ficha.
    expect((await db`select verify_appointment_access, summary_last_weekday, health_form from clinics where id = '00000000-0000-4000-8000-000000000001'`)[0])
      .toEqual({ verify_appointment_access: false, summary_last_weekday: 5, health_form: null });
    // Si después se cambia desde el panel, el próximo deploy no lo pisa.
    await db`update clinics set summary_last_weekday = 5, health_form = null where id = ${mininni}`;
    await db.unsafe(schema);
    expect(await options()).toMatchObject({ summary_last_weekday: 5, health_form: null, verify_appointment_access: true });
    await db`delete from clinics where id = ${mininni}`;
  }, 60000);
  it("el primer turno del día queda prendido para Guerra–Mininni una sola vez", async () => {
    const mininni = "67c3954a-8df8-46c2-a604-f818832bee36";
    const schema = readFileSync("supabase/schema.sql", "utf8");
    await db`insert into clinics (id, name) values (${mininni}, 'Guerra–Mininni ficticia')`;
    await db`delete from data_migrations where name = '2026-11-18-primer-turno-guerra-mininni'`;
    await db.unsafe(schema);
    const cutoff = async (id: string) => (await db`select first_slot_cutoff_hour from clinics where id = ${id}`)[0].first_slot_cutoff_hour;
    expect(await cutoff(mininni)).toBe(0);
    expect(await cutoff("00000000-0000-4000-8000-000000000001")).toBeNull();
    // Si después lo cambian desde el panel, el próximo deploy no lo pisa.
    await db`update clinics set first_slot_cutoff_hour = 18 where id = ${mininni}`;
    await db.unsafe(schema);
    expect(await cutoff(mininni)).toBe(18);
    await db`delete from clinics where id = ${mininni}`;
  }, 60000);

  it("el feedback de Guerra–Mininni cambia solo esas frases de sus instrucciones, una sola vez", async () => {
    const mininni = "67c3954a-8df8-46c2-a604-f818832bee36";
    const schema = readFileSync("supabase/schema.sql", "utf8");
    const before = [
      "A QUIÉN DAR EL TURNO",
      "- Primera vez: con el Dr. Mininni. Solo con la Dra. Coldeira si la solicita explícitamente para su primera consulta. Explicá la diferencia antes de ofrecer un horario.",
      "- Si pide control, preguntá una vez si también quiere mantenimiento periodontal (limpieza), salvo que ya lo haya aclarado.",
      "- El mantenimiento periodontal (limpieza) lo hace la Dra. María Emilia Coldeira.",
      "- No sustituyas una limpieza por un control.",
      "- Para un paciente nuevo, pedí nombre y DNI. Pedí de a uno o dos datos y aprovechá lo que ya escribió o dijo.",
      "- Si habla de un caso urgente o de dolor, atendé ese pedido antes de volver a las preguntas administrativas y seguí el protocolo de urgencias.",
    ].join("\n");
    await db`insert into clinics (id, name, agent_context) values (${mininni}, 'Guerra–Mininni ficticia', ${before})`;
    await db`delete from data_migrations where name = '2026-11-18-feedback-sofi-guerra-mininni'`;
    await db.unsafe(schema);
    const [row] = await db`select agent_context, context_revision from clinics where id = ${mininni}`;
    const text = row.agent_context as string;
    expect(text).not.toContain("Explicá la diferencia");
    expect(text).toContain("Si no la nombró, no menciones a la Dra. Coldeira");
    expect(text).not.toContain("mantenimiento periodontal (limpieza)");
    expect(text).not.toContain("una limpieza por un control");
    expect(text).toContain("Por WhatsApp pedí en un solo mensaje todos los datos que falten");
    expect(text).toContain("Una molestia o sensibilidad no es una urgencia");
    expect(text).toContain("nunca escribas la palabra «limpieza»");
    expect(text.startsWith("A QUIÉN DAR EL TURNO\n- Primera vez: con el Dr. Mininni.")).toBe(true);
    expect(row.context_revision).toBe(1);
    // Una sola vez: lo que editen después desde el panel no se pisa ni se repite.
    await db`update clinics set agent_context = 'Editado desde el panel' where id = ${mininni}`;
    await db.unsafe(schema);
    expect((await db`select agent_context from clinics where id = ${mininni}`)[0].agent_context).toBe("Editado desde el panel");
    await db`delete from clinics where id = ${mininni}`;
  }, 60000);

  it("la frase de las radiografías de Guerra–Mininni cambia una sola vez", async () => {
    const mininni = "67c3954a-8df8-46c2-a604-f818832bee36";
    const schema = readFileSync("supabase/schema.sql", "utf8");
    const old = OLD_RADIOGRAFIAS;
    await db`insert into clinics (id, name, agent_context) values (${mininni}, 'Guerra–Mininni ficticia', ${`ESTUDIOS\n${old}\nOtra regla.`})`;
    await db`delete from data_migrations where name = '2026-11-18-radiografias-guerra-mininni'`;
    await db.unsafe(schema);
    const text = (await db`select agent_context from clinics where id = ${mininni}`)[0].agent_context as string;
    expect(text).not.toContain("preguntá brevemente");
    expect(text).toContain("también si el turno quedó pendiente de confirmación");
    expect(text).toContain("Nunca digas que no hace falta ni que «no pasa nada»");
    expect(text).toContain("«Le conviene traer las radiografías para que el doctor pueda verlas en la primera consulta");
    expect(text.startsWith("ESTUDIOS\n- Después de reservar")).toBe(true);
    expect(text.endsWith("\nOtra regla.")).toBe(true);
    await db`update clinics set agent_context = 'Editado desde el panel' where id = ${mininni}`;
    await db.unsafe(schema);
    expect((await db`select agent_context from clinics where id = ${mininni}`)[0].agent_context).toBe("Editado desde el panel");
    await db`delete from clinics where id = ${mininni}`;
  }, 60000);

  it("Guerra–Mininni pasa de demo conservada a cliente una sola vez", async () => {
    const mininni = "67c3954a-8df8-46c2-a604-f818832bee36";
    const schema = readFileSync("supabase/schema.sql", "utf8");
    await db`insert into clinics (id, name, is_demo) values (${mininni}, 'Guerra–Mininni ficticia', true)`;
    await db`delete from data_migrations where name = '2026-11-18-guerra-mininni-cliente'`;
    await db.unsafe(schema);
    const [row] = await db`select is_demo, retained_at from clinics where id = ${mininni}`;
    expect(row.is_demo).toBe(false);
    expect(row.retained_at).not.toBeNull();
    // Las demás clínicas no cambian.
    expect((await db`select is_demo from clinics where id = '00000000-0000-4000-8000-000000000001'`)[0].is_demo).toBe(false);
    // Una sola vez.
    await db`update clinics set is_demo = true where id = ${mininni}`;
    await db.unsafe(schema);
    expect((await db`select is_demo from clinics where id = ${mininni}`)[0].is_demo).toBe(true);
    await db`delete from clinics where id = ${mininni}`;
  }, 60000);
});
