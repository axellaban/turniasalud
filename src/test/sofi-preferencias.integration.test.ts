import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDaysKey, localDateKey } from "@/lib/time";
import { SYSTEM_PROMPT } from "@/lib/agent/prompt";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Charla real con Guerra–Mininni (26/11/2026): la paciente pidió «con una mujer» y «después de las 17».
// Sofi dijo que no había nada «hasta mediados de enero» (había el 23/12), y dos mensajes después le
// ofreció a un profesional hombre. Acá, que la búsqueda recuerde lo pedido y busque lejos antes de
// decir que no hay.

vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn(async () => true) }));

const url = testDatabaseUrl();
const timezone = "America/Argentina/Buenos_Aires";
const secret = "turnia-test-secret";
const today = () => localDateKey(new Date(), timezone);
const day = (offset: number) => addDaysKey(today(), offset);
const dm = (key: string) => `${Number(key.slice(8, 10))}/${Number(key.slice(5, 7))}`;
const local = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
// Números ficticios.
const carla = "5491100008001";
const otra = "5491100008002";

type Slot = { profesional_id: string; inicio: string };
type Result = Record<string, unknown> & { ok: boolean; turnos?: Slot[]; mensaje?: string; error?: string };

describe("reglas del prompt para las preferencias del paciente", () => {
  it("pregunta la preferencia junto con los datos y la mantiene toda la charla", () => {
    expect(SYSTEM_PROMPT).toContain("Tiene preferencia de profesional o de horario?");
    expect(SYSTEM_PROMPT).toContain("vale para toda la charla");
    expect(SYSTEM_PROMPT).toContain("no le ofrezcas nunca un horario o un profesional que no lo cumpla sin preguntarle antes");
  });
  it("dice hasta dónde buscó y reconoce el error", () => {
    expect(SYSTEM_PROMPT).toContain("Busqué hasta el 31/12 y no encontré");
    expect(SYSTEM_PROMPT).toContain("Nunca digas que no hay hasta una fecha que no buscaste");
    expect(SYSTEM_PROMPT).toContain("Perdón, me fijé de nuevo y sí hay");
  });
});

describe.runIf(url)("consultar_disponibilidad con las preferencias del paciente", () => {
  let sql: typeof import("@/lib/db").sql;
  let handler: typeof import("@/app/api/agent/tools/[name]/route").POST;
  let clinicId: string, mininni: string, coldeira: string, lara: string, control: string, implante: string;

  async function tool(input: Record<string, unknown>, phone = carla): Promise<Result> {
    const request = new Request("https://turnia.test/api/agent/tools/consultar_disponibilidad", {
      method: "POST",
      headers: { "content-type": "application/json", "x-turnia-secret": secret },
      body: JSON.stringify({ clinic_id: clinicId, patient_phone: phone, canal: "custom", conversation_id: `conv_${phone}`, ...input }),
    });
    return (await handler(request, { params: Promise.resolve({ name: "consultar_disponibilidad" }) })).json();
  }

  beforeAll(async () => {
    const db = await scratchDatabase(url!, "turnia_sofi_preferencias_test");
    await resetTestDatabase(db);
    for (const [k, v] of Object.entries({ DATABASE_URL: db, AGENT_TOOLS_SECRET: secret, SESSION_SECRET: "test-session", APP_URL: "https://turnia.test" })) vi.stubEnv(k, v);
    ({ sql } = await import("@/lib/db"));
    ({ POST: handler } = await import("@/app/api/agent/tools/[name]/route"));
    [{ id: clinicId }] = await sql`
      insert into clinics (name, specialty, is_demo, retained_at) values ('Consultorio de prueba', 'Odontología', true, now()) returning id`;
    [{ id: mininni }] = await sql`insert into professionals (clinic_id, full_name, specialty) values (${clinicId}, 'Dr. Prueba Hombre', 'Odontología') returning id`;
    [{ id: coldeira }] = await sql`insert into professionals (clinic_id, full_name, specialty) values (${clinicId}, 'Dra. Prueba Mujer', 'Odontología') returning id`;
    [{ id: lara }] = await sql`insert into professionals (clinic_id, full_name, specialty) values (${clinicId}, 'Lara Prueba', 'Odontología') returning id`;
    await sql`insert into schedules (professional_id, weekday, start_time, end_time) select ${mininni}::uuid, d, '09:00', '19:00' from generate_series(0, 6) d`;
    await sql`insert into schedules (professional_id, weekday, start_time, end_time) select ${coldeira}::uuid, d, '09:00', '19:00' from generate_series(0, 6) d`;
    await sql`insert into schedules (professional_id, weekday, start_time, end_time) select ${lara}::uuid, d, '09:00', '19:00' from generate_series(0, 6) d`;
    // La profesional mujer está de vacaciones las próximas tres semanas (lo de la charla: recién el 23/12).
    await sql`
      insert into schedule_blocks (clinic_id, professional_id, starts_at, ends_at, reason)
      values (${clinicId}, ${coldeira}, now() - interval '1 day', ${`${day(21)}T23:59:00-03:00`}, 'Vacaciones')`;
    [{ id: control }] = await sql`insert into appointment_types (clinic_id, name, specialty, duration_min) values (${clinicId}, 'Control', 'Odontología', 30) returning id`;
    [{ id: implante }] = await sql`insert into appointment_types (clinic_id, name, specialty, duration_min) values (${clinicId}, 'Implante', 'Odontología', 60) returning id`;
    // El implante lo hace solo el profesional hombre: las otras dos hacen solo el control.
    await sql`insert into professional_appointment_types (professional_id, appointment_type_id) values (${coldeira}, ${control}), (${lara}, ${control})`;
  }, 60000);

  afterAll(async () => {
    await sql?.end();
  });

  it("con «una mujer, después de las 17» busca más allá de dos semanas y encuentra lo que hay", async () => {
    const r = await tool({ tipo_turno_id: control, profesional_genero: "mujer", desde_hora: "17:00" });
    expect(r.ok).toBe(true);
    expect(r.turnos!.length).toBeGreaterThan(0);
    for (const t of r.turnos!) {
      expect(t.profesional_id).toBe(coldeira);
      expect(local(t.inicio) >= "17:00").toBe(true);
      expect(t.inicio > `${day(21)}T23:00`).toBe(true);
    }
    expect(r.buscado).toEqual({ desde: dm(today()), hasta: dm(day(60)) });
    expect(String(r.preferencias_del_paciente)).toContain("con una profesional mujer");
    expect(String(r.preferencias_del_paciente)).toContain("desde las 17:00");
    // Lara no tiene «Dra.» ni el dato cargado: no se adivina por el nombre.
    expect(String(r.aviso_preferencias)).toContain("Lara Prueba");
  });

  it("dos mensajes después, sin repetirlo, sigue ofreciendo solo a la mujer y después de las 17", async () => {
    const r = await tool({ tipo_turno_id: control });
    expect(r.turnos!.length).toBeGreaterThan(0);
    for (const t of r.turnos!) {
      expect(t.profesional_id).toBe(coldeira);
      expect(local(t.inicio) >= "17:00").toBe(true);
    }
  });

  it("las preferencias son de ese paciente: otro número busca sin ellas", async () => {
    const r = await tool({ tipo_turno_id: control }, otra);
    expect(r.turnos!.some((t) => t.profesional_id !== coldeira)).toBe(true);
    expect(r.preferencias_del_paciente).toBeUndefined();
  });

  it("un horario nuevo reemplaza al anterior", async () => {
    const r = await tool({ tipo_turno_id: control, franja: "manana" });
    for (const t of r.turnos!) {
      expect(t.profesional_id).toBe(coldeira);
      expect(local(t.inicio) < "13:00").toBe(true);
    }
  });

  it("si nadie cumple la preferencia, no ofrece a otro: pide preguntar antes", async () => {
    const r = await tool({ tipo_turno_id: implante });
    expect(r.turnos).toEqual([]);
    expect(r.mensaje).toContain("Ninguna profesional mujer hace Implante");
    expect(r.mensaje).toContain("preguntale si le sirve con un profesional hombre");
  });

  it("con «cualquiera» la borra y vuelven todos", async () => {
    const r = await tool({ tipo_turno_id: control, profesional_genero: "cualquiera", franja: "cualquiera" });
    expect(r.turnos!.some((t) => t.profesional_id === mininni)).toBe(true);
    expect(r.preferencias_del_paciente).toBeUndefined();
  });

  it("si no hay nada hasta el tope, dice hasta qué fecha buscó", async () => {
    await sql`update professionals set gender = 'mujer' where id = ${lara}`;
    await sql`
      insert into schedule_blocks (clinic_id, professional_id, starts_at, ends_at, reason)
      values (${clinicId}, ${coldeira}, now(), now() + interval '90 days', 'Licencia'),
             (${clinicId}, ${lara}, now(), now() + interval '90 days', 'Licencia')`;
    const r = await tool({ tipo_turno_id: control, profesional_genero: "mujer" });
    expect(r.turnos).toEqual([]);
    expect(r.mensaje).toContain(`Busqué hasta el ${dm(day(60))}`);
    expect(r.mensaje).toContain("preguntale si quiere que busque sin esa condición");
    expect(r.aviso_preferencias).toBeUndefined();
  });

  it("con Smile Connect busca de a dos semanas y pide seguir antes de decir que no hay", async () => {
    await sql`
      insert into smile_connect_connections (clinic_id, token_hash, token_hint, encrypted_token, api_key_encrypted, api_mode)
      values (${clinicId}, 'hash-prueba', 'prueba', 'x', 'x', 'lectura')`;
    try {
      const r = await tool({ tipo_turno_id: control });
      expect(r.turnos).toEqual([]);
      expect(r.buscado).toEqual({ desde: dm(today()), hasta: dm(day(14)) });
      expect(r.seguir_buscando).toEqual({ desde: day(15), hasta: day(28) });
      expect(r.mensaje).toContain("Todavía no le digas que no hay turnos");
    } finally {
      await sql`delete from smile_connect_connections where clinic_id = ${clinicId}`;
    }
  });
});
