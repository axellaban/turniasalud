import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Turnia Activa · secuencias: seguimiento a los 5 días a quien no respondió, hasta 2 mensajes, que se
// corta si responde, saca turno o pide la baja; horario de lunes a viernes de 9 a 20 y tope de 60
// mensajes por día y por línea. Apagadas por defecto.

const mocks = vi.hoisted(() => ({
  sent: [] as Array<{ phone: string; text?: string; context: string }>,
}));
vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn(async () => {}) }));
vi.mock("@/lib/whatsapp", async (original) => ({
  ...(await original<typeof import("@/lib/whatsapp")>()),
  whatsappReadiness: () => null,
  pauseBetweenSends: async () => {},
  sendPatientMessage: vi.fn(async (_clinic: unknown, msg: { phone: string; text?: string; context: string }) => {
    mocks.sent.push(msg);
    return { conversation_id: null };
  }),
}));

const base = testDatabaseUrl();
const CLINIC = "00000000-0000-4000-8000-000000000001";
const LIMPIEZA = "00000000-0000-4000-8000-0000000000b5";
const PRO = "00000000-0000-4000-8000-0000000000a3";
const isoAgo = (days: number) => new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

/** El próximo martes a las 11 de Buenos Aires (dentro del horario), y su sábado. */
function nextTuesday11(): Date {
  const d = new Date(Date.now() + 7 * 86400_000);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 14, 0));
}

describe.runIf(base)("secuencias de campañas", () => {
  let sql: typeof import("@/lib/db").sql;
  let campaigns: typeof import("@/lib/campaigns");
  let sequences: typeof import("@/lib/campaign-sequences");
  let limits: typeof import("@/lib/campaign-limits");
  let clinicLib: typeof import("@/lib/clinic");
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const url = await scratchDatabase(base!, "turnia_test_sequences");
    await resetTestDatabase(url);
    for (const [key, value] of Object.entries({ DATABASE_URL: url, SESSION_SECRET: "test-session", AGENT_TOOLS_SECRET: "test-tools" })) vi.stubEnv(key, value);
    ({ sql } = await import("@/lib/db"));
    await sql`update clinics set whatsapp_provider = 'waha' where id = ${CLINIC}`;
    campaigns = await import("@/lib/campaigns");
    sequences = await import("@/lib/campaign-sequences");
    limits = await import("@/lib/campaign-limits");
    clinicLib = await import("@/lib/clinic");
    for (const [i, name] of ["Ana Uno", "Beto Dos", "Ceci Tres", "Dani Cuatro", "Eli Cinco"].entries()) {
      const [p] = await sql<Array<{ id: string }>>`insert into patients (clinic_id, full_name, phone) values (${CLINIC}, ${name}, ${`54911880000${i}`}) returning id`;
      await sql`insert into patient_visits (clinic_id, patient_id, service, visited_at) values (${CLINIC}, ${p.id}, 'Consulta', ${isoAgo(600 + i)})`;
      ids[name] = p.id;
    }
  }, 60000);

  afterAll(async () => {
    await (await import("@/lib/db")).closeDb();
    vi.unstubAllEnvs();
  });

  it("el horario es de lunes a viernes de 9 a 20, en la zona de la clínica", () => {
    const tz = { timezone: "America/Argentina/Buenos_Aires" };
    const tue = nextTuesday11();
    expect(limits.inSendWindow(tz, tue)).toBe(true);
    expect(limits.inSendWindow(tz, new Date(tue.getTime() + 9 * 3600_000))).toBe(false); // 20:00
    expect(limits.inSendWindow(tz, new Date(tue.getTime() - 3 * 3600_000))).toBe(false); // 8:00
    expect(limits.inSendWindow(tz, new Date(tue.getTime() + 4 * 86400_000))).toBe(false); // sábado
    expect(sequences.followupMessage(null, "Ana Uno", "x")).toBe("Hola Ana, te escribo de nuevo por si se te pasó el mensaje. ¿Querés que te busque un turno?");
    expect(sequences.followupMessage("{nombre}: ¿seguimos con {detalle}?", "Beto", "la limpieza")).toBe("Beto: ¿seguimos con la limpieza?");
  });

  it("el primer mensaje agenda el seguimiento; sale solo con las secuencias prendidas, en horario y hasta cortarse", async () => {
    let clinic = await clinicLib.getClinic(CLINIC);
    expect(clinic.sequences_enabled).toBe(false);
    const campaign = await campaigns.prepareCampaign(clinic, { type: "reactivacion" });
    expect(await sql`select position, delay_days, message from campaign_steps where campaign_id = ${campaign.id}`).toEqual([{ position: 2, delay_days: 5, message: null }]);
    await sql`update campaign_recipients set status = 'excluido' where campaign_id = ${campaign.id} and not (patient_id = any(${Object.values(ids)}::uuid[]))`;

    const first = await campaigns.sendCampaign(campaign.id);
    expect(first).toMatchObject({ sent: 5, remaining: 0 });
    const rows = await sql<Array<{ patient_id: string; messages_sent: number; days: number }>>`
      select patient_id, messages_sent, round(extract(epoch from next_step_at - sent_at) / 86400)::int as days
      from campaign_recipients where campaign_id = ${campaign.id} and status = 'enviado'`;
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.messages_sent === 1 && r.days === 5)).toBe(true);
    expect((await limits.lineUsage(clinic)).sent).toBe(5);

    const NOW = nextTuesday11();
    const recipient = (name: string) => sql`select * from campaign_recipients where campaign_id = ${campaign.id} and patient_id = ${ids[name]}`.then((r) => r[0]);
    await sql`update campaign_recipients set next_step_at = ${new Date(NOW.getTime() - 3600_000)} where campaign_id = ${campaign.id} and status = 'enviado'`;

    // Apagadas: no pasa nada.
    mocks.sent.length = 0;
    expect(await sequences.runSequences(NOW)).toEqual([]);
    expect(mocks.sent).toHaveLength(0);

    await sql`update clinics set sequences_enabled = true where id = ${CLINIC}`;
    clinic = await clinicLib.getClinic(CLINIC);
    // El sábado no sale nada.
    expect((await sequences.runSequences(new Date(NOW.getTime() + 4 * 86400_000 - 3 * 3600_000)))[0]).toMatchObject({ sent: 0, skipped: expect.stringContaining("horario") });

    // Con la línea en el tope del día, espera.
    await sql`insert into campaign_messages (clinic_id, line, sent_at) select ${CLINIC}, 'general', ${new Date(NOW.getTime() - 60_000)} from generate_series(1, 60)`;
    expect((await sequences.runSequences(NOW))[0]).toMatchObject({ sent: 0, waiting: 5 });
    await sql`delete from campaign_messages where recipient_id is null`;

    // Beto sacó turno por teléfono, Ceci pidió la baja, Dani respondió y Eli contestó el chat.
    const start = new Date(Date.now() + 10 * 86400_000);
    await sql`
      insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, source)
      values (${CLINIC}, ${ids["Beto Dos"]}, ${PRO}, ${LIMPIEZA}, ${start}, ${new Date(start.getTime() + 40 * 60_000)}, 'confirmado', 'panel')`;
    await sql`update patients set contact_opt_out = true where id = ${ids["Ceci Tres"]}`;
    await sql`update campaign_recipients set status = 'respondio' where campaign_id = ${campaign.id} and patient_id = ${ids["Dani Cuatro"]}`;
    await sql`
      insert into channel_conversations (clinic_id, phone, chat_id, campaign_id, transcript)
      values (${CLINIC}, '549118800004', '549118800004@c.us', ${campaign.id}, ${sql.json([{ role: "agent", message: "Hola" }, { role: "user", message: "¡Hola! Sí" }])})`;

    const run = await sequences.runSequences(NOW);
    expect(run[0]).toMatchObject({ sent: 1, stopped: 4, failed: 0 });
    expect(mocks.sent.map((m) => m.phone)).toEqual(["549118800000"]);
    expect(mocks.sent[0].text).toBe("Hola Ana, te escribo de nuevo por si se te pasó el mensaje. ¿Querés que te busque un turno?");
    expect(mocks.sent[0].context).toContain("seguimiento (mensaje 2 de 2)");
    expect(await recipient("Ana Uno")).toMatchObject({ messages_sent: 2, next_step_at: null, sequence_stopped: "Terminó la secuencia" });
    expect((await recipient("Beto Dos")).sequence_stopped).toBe("Sacó turno");
    expect((await recipient("Ceci Tres")).sequence_stopped).toBe("Pidió la baja");
    expect((await recipient("Dani Cuatro")).sequence_stopped).toBe("Respondió");
    expect((await recipient("Eli Cinco")).sequence_stopped).toBe("Respondió");
    expect((await limits.lineUsage(clinic, NOW)).sent).toBe(1);

    // Nadie recibe un tercero: la secuencia terminó.
    mocks.sent.length = 0;
    expect((await sequences.runSequences(new Date(NOW.getTime() + 6 * 86400_000)))[0]).toMatchObject({ sent: 0 });
    expect(mocks.sent).toHaveLength(0);

    // Lo que venció hace más de 4 días (por ejemplo, con las secuencias apagadas) se cierra sin mandar.
    await sql`update campaign_recipients set next_step_at = ${new Date(NOW.getTime() - 5 * 86400_000)}, sequence_stopped = null where campaign_id = ${campaign.id} and patient_id = ${ids["Ana Uno"]}`;
    await sequences.runSequences(NOW);
    expect((await recipient("Ana Uno")).sequence_stopped).toBe("Venció sin enviarse");
    expect(mocks.sent).toHaveLength(0);
  });

  it("enviar con Sofi frena en el tope de 60 por día de la línea, y lo enviado a mano cuenta pero no tiene seguimiento", async () => {
    const clinic = await clinicLib.getClinic(CLINIC);
    const before = await limits.lineUsage(clinic);
    await sql`insert into campaign_messages (clinic_id, line, sent_at) select ${CLINIC}, 'general', now() from generate_series(1, ${limits.DAILY_LINE_CAP - before.sent - 1})`;
    const campaign = await campaigns.prepareCampaign(clinic, { type: "personalizada", name: "Vacaciones" });
    const result = await campaigns.sendCampaign(campaign.id);
    expect(result).toMatchObject({ sent: 1, capped: true });
    expect(result.remaining).toBeGreaterThan(0);
    expect((await limits.lineUsage(clinic)).left).toBe(0);
    // Sin pasos de seguimiento (el aviso general no los trae).
    expect(await sql`select id from campaign_recipients where campaign_id = ${campaign.id} and next_step_at is not null`).toHaveLength(0);

    const [pending] = await sql<Array<{ id: string }>>`select id from campaign_recipients where campaign_id = ${campaign.id} and status = 'pendiente' limit 1`;
    await campaigns.markManualSent(CLINIC, pending.id);
    expect((await sql`select messages_sent, next_step_at from campaign_recipients where id = ${pending.id}`)[0]).toEqual({ messages_sent: 1, next_step_at: null });
    expect((await sql`select manual from campaign_messages where recipient_id = ${pending.id}`)[0].manual).toBe(true);
    // Si el chat al final no se mandó, deja de contar.
    await campaigns.setRecipientIncluded(CLINIC, pending.id, true);
    expect(await sql`select id from campaign_messages where recipient_id = ${pending.id}`).toHaveLength(0);
  });
});
