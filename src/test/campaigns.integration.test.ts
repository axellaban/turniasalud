import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Campañas para activar la base: importación de pacientes, audiencias con visitas importadas y
// controles indicados, lista que se revisa antes de enviar, envío a mano o con Sofi y tope de contacto.

const mocks = vi.hoisted(() => ({
  session: undefined as string | undefined,
  sendWhatsAppTemplate: vi.fn<(msg: unknown) => Promise<{ conversation_id: string }>>(async () => ({ conversation_id: "conv_campana" })),
}));
vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn(async () => {}) }));
// La prueba de las automáticas verifica el envío, no la franja horaria (lunes a viernes de 9 a 20): sin esto
// falla cuando el CI corre de noche o un fin de semana. Solo esa prueba fuerza la franja abierta.
const sendWindow = vi.hoisted(() => ({ open: false }));
vi.mock("@/lib/campaign-limits", async (original) => {
  const real = await original<typeof import("@/lib/campaign-limits")>();
  return { ...real, inSendWindow: (...args: Parameters<typeof real.inSendWindow>) => sendWindow.open || real.inSendWindow(...args) };
});
vi.mock("@/lib/elevenlabs", async (original) => ({ ...(await original<typeof import("@/lib/elevenlabs")>()), sendWhatsAppTemplate: mocks.sendWhatsAppTemplate }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "turnia_session" && mocks.session ? { value: mocks.session } : undefined), set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
  usePathname: () => "/panel/campanas",
  useRouter: () => ({ refresh: () => {} }),
}));

const base = testDatabaseUrl();
afterEach(() => vi.restoreAllMocks());
const CLINIC = "00000000-0000-4000-8000-000000000001";
const LIMPIEZA = "00000000-0000-4000-8000-0000000000b5";
const MARIA = "00000000-0000-4000-8000-0000000000c1";
const LUCAS = "00000000-0000-4000-8000-0000000000c4";

const form = (data: Record<string, string>) => {
  const out = new FormData();
  for (const [key, value] of Object.entries(data)) out.set(key, value);
  return out;
};
/** Fecha dd/mm/aaaa de hace `months` meses (y `days` días). */
const ago = (months: number, days = 0) => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  d.setUTCDate(d.getUTCDate() - days);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
};
const isoAgo = (days: number) => new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
/** La server action redirige al detalle: devuelve el id de la campaña. */
const redirectedId = async (run: Promise<unknown>) => {
  const error = await run.then(() => null, (e: Error) => e);
  const match = /redirect:\/panel\/campanas(?:\/|\?campana=)([0-9a-f-]{36})/.exec(error?.message ?? "");
  if (!match) throw new Error(`No redirigió a una campaña: ${error?.message}`);
  return match[1];
};

describe.runIf(base)("campañas para activar la base", () => {
  let sql: typeof import("@/lib/db").sql;
  let campaigns: typeof import("@/lib/campaigns");
  let actions: typeof import("@/app/panel/campaign-actions");
  let clinicLib: typeof import("@/lib/clinic");
  let importId: string;

  beforeAll(async () => {
    const url = await scratchDatabase(base!, "turnia_test_campaigns");
    await resetTestDatabase(url);
    for (const [key, value] of Object.entries({ DATABASE_URL: url, SESSION_SECRET: "test-session", AGENT_TOOLS_SECRET: "test-tools", ELEVENLABS_API_KEY: "fake" })) vi.stubEnv(key, value);
    ({ sql } = await import("@/lib/db"));
    await sql`update messaging_settings set active_channel = 'whatsapp' where id`;
    await sql`update clinics set whatsapp_phone_number_id = 'pn_test', elevenlabs_agent_id = 'agent_test' where id = ${CLINIC}`;
    campaigns = await import("@/lib/campaigns");
    actions = await import("@/app/panel/campaign-actions");
    clinicLib = await import("@/lib/clinic");
    mocks.session = (await import("@/lib/session")).createSessionToken();
  }, 60000);

  afterAll(async () => {
    await (await import("@/lib/db")).closeDb();
    vi.unstubAllEnvs();
  });

  it("importa una planilla: crea fichas, completa las que ya estaban y guarda las visitas", async () => {
    const text = [
      "Paciente;Celular;DNI;Email;Última visita;Prestación;Próximo control",
      `Carla Vega;11 5555-0101;31222333;;${ago(14)};LIMPIEZA DENTAL;`,
      `Carla Vega;1155550101;;;${ago(20)};Limpieza dental;`,
      `María González;011 15 5555-0001;28.111.222;maria@example.com;${ago(7)};Limpieza dental;`,
      `Pedro Luna;351 555-0102;;;${ago(2)};Ortodoncia;${ago(0, 3)}`,
      `Sin Celular;;;;${ago(3)};Consulta;`,
    ].join("\n");
    expect(await actions.importPatientsAction(undefined, form({ clinic_id: CLINIC, text }))).toMatchObject({ ok: false, message: expect.stringContaining("Confirmá") });

    const result = await actions.importPatientsAction(undefined, form({ clinic_id: CLINIC, text, consent: "on", source: "pacientes.csv" }));
    // «Sin Celular» entra igual, sin celular (no se le puede escribir hasta cargarlo).
    expect(result).toMatchObject({ ok: true, summary: { created: 3, existing: 1, visits: 5, skipped: 0, withoutPhone: 1, sharedPhones: 0, unmatched: ["Ortodoncia", "Consulta"] } });
    expect(await sql`select phone from patients where full_name = 'Sin Celular'`).toEqual([{ phone: null }]);

    const [carla] = await sql`select * from patients where phone = '5491155550101'`;
    expect(carla).toMatchObject({ full_name: "Carla Vega", dni: "31222333" });
    const visits = await sql<Array<{ appointment_type_id: string | null; service: string }>>`select appointment_type_id, service from patient_visits where patient_id = ${carla.id}`;
    expect(visits).toHaveLength(2);
    expect(visits.every((v) => v.appointment_type_id === LIMPIEZA)).toBe(true);
    // María ya estaba: conserva su DNI y suma el email que le faltaba.
    const [maria] = await sql`select dni, email from patients where id = ${MARIA}`;
    expect(maria).toEqual({ dni: "28111222", email: "maria@example.com" });
    const [pedro] = await sql`select next_control_at, next_control_reason from patients where phone = '5493515550102'`;
    expect(pedro.next_control_reason).toBe("control de ortodoncia");
    [{ id: importId }] = await sql<Array<{ id: string }>>`select id from patient_imports where source = 'pacientes.csv'`;

    // Importar lo mismo otra vez no duplica visitas.
    const again = await actions.importPatientsAction(undefined, form({ clinic_id: CLINIC, text, consent: "on" }));
    expect(again.summary).toMatchObject({ created: 0, existing: 4, visits: 0 });
  });

  it("las audiencias suman visitas importadas, controles indicados y respetan las reglas de la clínica", async () => {
    let clinic = await clinicLib.getClinic();
    const recall = await campaigns.computeAudience(clinic, "recall");
    expect(recall.map((m) => m.name)).toEqual(expect.arrayContaining(["Carla Vega", "Pedro Luna", "María González", "Jorge Pérez", "Ana Romero"]));
    const pedro = recall.find((m) => m.name === "Pedro Luna")!;
    expect(pedro).toMatchObject({ detail: "control de ortodoncia", reachable: true });
    expect(recall.find((m) => m.name === "Carla Vega")).toMatchObject({ detail: "limpieza dental", value: 40000, appointment_type_id: LIMPIEZA });
    expect((await campaigns.computeAudience(clinic, "reactivacion")).map((m) => m.name).sort()).toEqual(["Ana Romero", "Carla Vega"]);

    // Inactivo recién a los 18 meses: Carla (14) y Ana (13) ya no entran.
    expect(await actions.saveContactRulesAction(undefined, form({ clinic_id: CLINIC, reactivation_months: "18", contact_cooldown_days: "30" }))).toMatchObject({ ok: true });
    clinic = await clinicLib.getClinic();
    expect(await campaigns.computeAudience(clinic, "reactivacion")).toHaveLength(0);
    await actions.saveContactRulesAction(undefined, form({ clinic_id: CLINIC, reactivation_months: "12", contact_cooldown_days: "30" }));
    expect(await actions.saveContactRulesAction(undefined, form({ clinic_id: CLINIC, reactivation_months: "1", contact_cooldown_days: "30" }))).toMatchObject({ ok: false });

    // Sin control periódico de limpieza, Carla y María salen del recall.
    await actions.setRecallMonthsAction(undefined, form({ clinic_id: CLINIC, id: LIMPIEZA, recall_months: "" }));
    clinic = await clinicLib.getClinic();
    expect((await campaigns.computeAudience(clinic, "recall")).map((m) => m.name)).not.toContain("Carla Vega");
    expect(await actions.setRecallMonthsAction(undefined, form({ clinic_id: CLINIC, id: LIMPIEZA, recall_months: "6" }))).toMatchObject({ ok: true, message: "Control cada 6 meses." });

    // Un control indicado entra cuando llega su fecha.
    await actions.setNextControlAction(undefined, form({ clinic_id: CLINIC, id: LUCAS, next_control_at: isoAgo(-10), next_control_reason: "Control de presión" }));
    expect((await campaigns.computeAudience(clinic, "recall")).map((m) => m.name)).not.toContain("Lucas Díaz");
    await actions.setNextControlAction(undefined, form({ clinic_id: CLINIC, id: LUCAS, next_control_at: isoAgo(1), next_control_reason: "Control de presión" }));
    expect((await campaigns.computeAudience(clinic, "recall")).find((m) => m.name === "Lucas Díaz")?.detail).toBe("control de presión");
    await actions.setNextControlAction(undefined, form({ clinic_id: CLINIC, id: LUCAS, next_control_at: "" }));

    const opp = await campaigns.opportunities(clinic);
    expect(opp.patients).toBeGreaterThanOrEqual(6);
    expect(opp.value).toBeGreaterThan(0);
    expect(opp.list.find((o) => o.type === "recall")?.open).toBeNull();
  });

  it("la campaña guarda su lista, se revisa, se manda a mano o con Sofi y cuenta los turnos", async () => {
    const id = await redirectedId(actions.prepareCampaignAction(form({ clinic_id: CLINIC, type: "recall" })));
    // Con una sin terminar, volver a prepararla abre la misma.
    expect(await redirectedId(actions.prepareCampaignAction(form({ clinic_id: CLINIC, type: "recall" })))).toBe(id);

    const recipients = async () =>
      sql<Array<{ id: string; name: string; status: string; manual: boolean }>>`
        select r.id, p.full_name as name, r.status, r.manual from campaign_recipients r join patients p on p.id = r.patient_id
        where r.campaign_id = ${id} order by p.full_name`;
    const list = await recipients();
    expect(list.every((r) => r.status === "pendiente")).toBe(true);
    const byName = (name: string) => list.find((r) => r.name === name)!;

    // El equipo saca a María y le escribe a Carla desde su WhatsApp.
    await actions.toggleRecipientAction(form({ clinic_id: CLINIC, campaign_id: id, id: byName("María González").id, include: "false" }));
    await actions.markManualSentAction(form({ clinic_id: CLINIC, id: byName("Carla Vega").id }));
    // Si abrió el chat pero no lo mandó, vuelve a «Por enviar»; después sí lo manda.
    await actions.toggleRecipientAction(form({ clinic_id: CLINIC, campaign_id: id, id: byName("Carla Vega").id, include: "true" }));
    expect((await recipients()).find((r) => r.name === "Carla Vega")).toMatchObject({ status: "pendiente", manual: false });
    await actions.markManualSentAction(form({ clinic_id: CLINIC, id: byName("Carla Vega").id }));
    const [campaign] = await sql`select * from campaigns where id = ${id}`;
    expect(campaign.status).toBe("enviando");

    const custom = await actions.saveCampaignMessageAction(undefined, form({ clinic_id: CLINIC, id, message: "Hola {nombre}, te toca {detalle}. ¿Te reservo?" }));
    expect(custom.ok).toBe(true);
    const [saved] = await sql`select * from campaigns where id = ${id}`;
    expect(campaigns.manualMessage(saved as never, "Carla Vega", "limpieza dental")).toBe(
      "Hola Carla, te toca limpieza dental. ¿Te reservo?\n\nSi no querés recibir más mensajes, respondé BAJA.",
    );
    expect(campaigns.whatsappLinks("5491155550101", "Hola Carla").web).toBe("https://web.whatsapp.com/send?phone=5491155550101&text=Hola%20Carla");

    // Sofi le escribe al resto; María (quitada) y Carla (ya enviada) no reciben nada.
    const sent = await actions.sendCampaignAction(undefined, form({ clinic_id: CLINIC, id }));
    expect(sent.ok).toBe(true);
    const phones = mocks.sendWhatsAppTemplate.mock.calls.map(([msg]) => (msg as { userId: string }).userId);
    expect(phones).not.toContain("5491155550001");
    expect(phones).not.toContain("5491155550101");
    expect(phones).toContain("5493515550102");
    const after = await recipients();
    expect(after.find((r) => r.name === "María González")?.status).toBe("excluido");
    expect(after.find((r) => r.name === "Carla Vega")).toMatchObject({ status: "enviado", manual: true });
    expect((await sql`select status from campaigns where id = ${id}`)[0].status).toBe("finalizada");

    // Tope de contacto: a Carla le escribieron hace minutos, no entra en reactivación; sin tope, sí.
    let clinic = await clinicLib.getClinic();
    expect((await campaigns.computeAudience(clinic, "reactivacion")).map((m) => m.name)).not.toContain("Carla Vega");
    expect((await campaigns.computeAudience(clinic, "recall")).map((m) => m.name)).toContain("María González");
    await sql`update clinics set contact_cooldown_days = 0 where id = ${CLINIC}`;
    clinic = await clinicLib.getClinic();
    expect((await campaigns.computeAudience(clinic, "reactivacion")).map((m) => m.name)).toContain("Carla Vega");
    await sql`update clinics set contact_cooldown_days = 30 where id = ${CLINIC}`;

    // Carla saca turno (por teléfono, cargado en el panel): cuenta como turno de la campaña.
    const [carla] = await sql`select id from patients where phone = '5491155550101'`;
    const start = new Date(Date.now() + 3 * 86400_000);
    await sql`
      insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, source)
      values (${CLINIC}, ${carla.id}, '00000000-0000-4000-8000-0000000000a3', ${LIMPIEZA}, ${start}, ${new Date(start.getTime() + 40 * 60_000)}, 'confirmado', 'panel')`;
    const stats = (await campaigns.campaignStats(CLINIC, [id])).get(id)!;
    expect(stats).toMatchObject({ booked: 1, value: 40000, excluded: 1, pending: 0 });

    // Actualizar la lista suma a quien ahora cumple y la campaña vuelve a estar en curso.
    await sql`
      insert into patients (id, clinic_id, full_name, phone) values ('00000000-0000-4000-8000-0000000000d1', ${CLINIC}, 'Nora Paz', '5491155550199')`;
    await sql`
      insert into patient_visits (clinic_id, patient_id, appointment_type_id, service, visited_at)
      values (${CLINIC}, '00000000-0000-4000-8000-0000000000d1', ${LIMPIEZA}, 'Limpieza dental', ${isoAgo(200)})`;
    await actions.refreshAudienceAction(form({ clinic_id: CLINIC, id }));
    expect((await recipients()).find((r) => r.name === "Nora Paz")?.status).toBe("pendiente");
    expect((await sql`select status from campaigns where id = ${id}`)[0].status).toBe("enviando");

    // Un borrador sin envíos se descarta; una campaña con envíos, no.
    const draft = await redirectedId(actions.prepareCampaignAction(form({ clinic_id: CLINIC, type: "personalizada", name: "Vacaciones" })));
    await expect(actions.discardCampaignAction(form({ clinic_id: CLINIC, id: draft }))).rejects.toThrow("redirect:/panel/campanas");
    expect(await sql`select id from campaigns where id = ${draft}`).toHaveLength(0);
    await expect(actions.discardCampaignAction(form({ clinic_id: CLINIC, id }))).rejects.toThrow("redirect:/panel/campanas");
    expect(await sql`select id from campaigns where id = ${id}`).toHaveLength(1);
  });

  it("las pantallas de campañas, importación y paciente se arman con los datos", async () => {
    const [campaign] = await sql<Array<{ id: string }>>`select id from campaigns where type = 'recall'`;
    const render = async (page: Promise<unknown>) => renderToStaticMarkup((await page) as React.ReactElement);
    const index = await render((await import("@/app/panel/(app)/campanas/page")).default());
    for (const text of [
      "Audiencias",
      "Controles vencidos",
      "Inactivos +12 meses",
      "Presupuestos sin iniciar",
      "Conectar origen",
      "Del día a día",
      "Resultados ·",
      "Contactados",
      "Vinieron",
      "Cola de envíos",
      "Controles periódicos",
      "Reglas de contacto",
    ]) expect(index).toContain(text);
    const detail = await render(
      (await import("@/app/panel/(app)/campanas/[id]/page")).default({ params: Promise.resolve({ id: campaign.id }), searchParams: Promise.resolve({ ver: "enviados" }) } as never),
    );
    expect(detail).toContain("desde tu WhatsApp");
    expect(detail).toContain("Abrir el chat con Nora");
    expect(detail).toContain("https://wa.me/5491155550199?text=Hola%20Nora");
    const importPage = await render((await import("@/app/panel/(app)/pacientes/importar/page")).default());
    expect(importPage).toContain("pacientes.csv");
    const patient = await render((await import("@/app/panel/(app)/pacientes/[id]/page")).default({ params: Promise.resolve({ id: MARIA }) } as never));
    expect(patient).toContain("Próximo control");
    expect(patient).toContain("Visitas anteriores");
  });

  it("deshacer una importación borra sus visitas y las fichas nuevas sin actividad", async () => {
    const text = `Nombre;Celular;Última visita\nZoe Prueba;11 5555-0177;${ago(15)}`;
    const result = await actions.importPatientsAction(undefined, form({ clinic_id: CLINIC, text, consent: "on", source: "zoe.csv" }));
    expect(result.summary).toMatchObject({ created: 1, visits: 1 });
    const [zoeImport] = await sql<Array<{ id: string }>>`select id from patient_imports where source = 'zoe.csv'`;
    await actions.undoImportAction(form({ clinic_id: CLINIC, id: zoeImport.id }));
    expect(await sql`select id from patients where phone = '5491155550177'`).toHaveLength(0);

    // La primera importación: Carla tiene un turno y Pedro recibió la campaña, así que se quedan; sus visitas se borran.
    await actions.undoImportAction(form({ clinic_id: CLINIC, id: importId }));
    expect(await sql`select id from patients where phone in ('5491155550101', '5493515550102')`).toHaveLength(2);
    expect(await sql`select id from patient_visits where import_id = ${importId}`).toHaveLength(0);
    expect((await sql`select undone_at from patient_imports where id = ${importId}`)[0].undone_at).not.toBeNull();
  });

  it("la pantalla nueva: desglose de la audiencia, resultados en 4 etapas, cola con motivos y ajustes de la secuencia", async () => {
    const board = await import("@/lib/campaign-board");
    const clinic = await clinicLib.getClinic();
    const [campaign] = await sql<Array<{ id: string; max_messages: number; type: string }>>`select * from campaigns where type = 'recall' order by created_at limit 1`;

    // Desglose: quienes cumplen la regla menos los que quedan afuera, y cada uno con su motivo.
    const breakdown = await campaigns.audienceBreakdown(clinic, "recall");
    const reachable = (await campaigns.computeAudience(clinic, "recall")).filter((m) => m.reachable).length;
    expect(breakdown.reachable).toBe(reachable);
    expect(breakdown.matching).toBe(breakdown.reachable + breakdown.optedOut + breakdown.hasAppointment + breakdown.recentCampaign + breakdown.noPhone);
    expect(breakdown.hasAppointment + breakdown.recentCampaign).toBeGreaterThan(0);

    // Resultados: contactados (enviados de verdad) → respondieron → sacaron turno → vinieron.
    const results = await board.campaignResults(clinic, campaign.id, "todo");
    expect(results.contacted).toBeGreaterThan(0);
    expect(results.booked).toBeGreaterThanOrEqual(1);
    expect(results.replied).toBeGreaterThanOrEqual(results.booked);
    expect(results.attended).toBeLessThanOrEqual(results.booked);
    expect(board.stepRate(1, 4)).toBe(25);
    expect(board.stepRate(1, 0)).toBeNull();

    // Cola: María quedó afuera porque la sacó el equipo, con la acción para volver a sumarla.
    const queue = await board.campaignQueue(clinic, campaign as never, "fuera");
    const maria = queue.rows.find((r) => r.name === "María González");
    expect(maria).toMatchObject({ kind: "fuera", step: "Fuera de la cola", action: { label: "Volver a sumar", include: true } });
    const all = await board.campaignQueue(clinic, campaign as never, "todos");
    expect(all.rows.length).toBe(all.counts.cola + all.counts.sofi + all.counts.fuera + all.counts.hecho);
    expect(board.nextSendLabel({ timezone: "America/Argentina/Buenos_Aires" }, new Date("2026-11-28T15:00:00Z"))).toBe("lun 9:00");
    expect(board.nextSendLabel({ timezone: "America/Argentina/Buenos_Aires" }, new Date("2026-11-24T23:30:00Z"))).toBe("Mañana 9:00");

    // Secuencia: a los 7 días, sin cortar al responder; la baja corta siempre.
    expect(await actions.saveSequenceAction(undefined, form({ clinic_id: CLINIC, id: campaign.id, delay_days: "7", max_messages: "2", stop_on_booking: "on" }))).toMatchObject({ ok: true });
    expect((await sql`select stop_on_reply, stop_on_booking, max_messages from campaigns where id = ${campaign.id}`)[0]).toEqual({ stop_on_reply: false, stop_on_booking: true, max_messages: 2 });
    expect((await sql`select delay_days from campaign_steps where campaign_id = ${campaign.id} and position = 2`)[0].delay_days).toBe(7);
    const { stopReason } = await import("@/lib/campaign-sequences");
    const row = { contact_opt_out: false, replied: true, booked: false, messages_sent: 1, max_messages: 2, phone: "549", stop_on_reply: false, stop_on_booking: true };
    expect(stopReason(row)).toBeNull();
    expect(stopReason({ ...row, contact_opt_out: true })).toBe("Pidió la baja");
    expect(await actions.saveSequenceAction(undefined, form({ clinic_id: CLINIC, id: campaign.id, delay_days: "40", max_messages: "2" }))).toMatchObject({ ok: false });
    await actions.saveSequenceAction(undefined, form({ clinic_id: CLINIC, id: campaign.id, delay_days: "5", max_messages: "2", stop_on_reply: "on", stop_on_booking: "on" }));

    // Mensajes: primer mensaje y seguimiento propios.
    expect(
      await actions.saveCampaignTextsAction(undefined, form({ clinic_id: CLINIC, id: campaign.id, message: "Hola {nombre}, te toca {detalle}.", followup: "{nombre}, ¿lo vemos?", goal: "Reservar el control." })),
    ).toMatchObject({ ok: true });
    expect((await sql`select message from campaign_steps where campaign_id = ${campaign.id} and position = 2`)[0].message).toBe("{nombre}, ¿lo vemos?");
    expect((await sql`select goal from campaigns where id = ${campaign.id}`)[0].goal).toBe("Reservar el control.");

    // Recordatorios que manda otro sistema: la automática no manda uno repetido.
    expect(campaigns.automationBlock({ is_demo: false, auto_campaigns: ["recordatorio"], external_reminders: "Smile Connect" }, "recordatorio")).toContain("Smile Connect");
    const render = async (page: Promise<unknown>) => renderToStaticMarkup((await page) as React.ReactElement);
    await sql`update clinics set external_reminders = 'Smile Connect' where id = ${CLINIC}`;
    const html = await render(
      (await import("@/app/panel/(app)/campanas/page")).default({ searchParams: Promise.resolve({ campana: campaign.id, cola: "fuera", periodo: "todo" }) } as never),
    );
    expect(html).toContain("lo manda Smile Connect");
    expect(html).toContain("Volver a sumar");
    expect(html).toContain("Seguimiento");
    await sql`update clinics set external_reminders = null where id = ${CLINIC}`;
  });

  it("las automáticas salen apagadas, corren solo donde se prendieron, retoman lo que dejó el tope y cuentan 14 días", async () => {
    sendWindow.open = true;
    onTestFinished(() => {
      sendWindow.open = false;
    });
    const { POST } = await import("@/app/api/automations/[job]/route");
    const run = (job: string, body?: unknown) =>
      POST(new Request(`https://turnia.test/api/automations/${job}`, { method: "POST", headers: { "x-turnia-secret": "test-tools" }, body: body ? JSON.stringify(body) : undefined }), {
        params: Promise.resolve({ job }),
      }).then((r) => r.json());
    mocks.sendWhatsAppTemplate.mockClear();

    // Apagadas por defecto: n8n no le escribe a nadie, ni siquiera a la clínica por defecto.
    expect((await clinicLib.getClinic()).auto_campaigns).toEqual([]);
    expect(await run("reactivacion")).toMatchObject({ ok: true, clinicas: [] });
    expect(await run("reactivacion", { clinic_id: CLINIC })).toMatchObject({ ok: true, clinicas: [{ clinic_id: CLINIC, skipped: "Apagada en esta clínica." }] });
    expect(mocks.sendWhatsAppTemplate).not.toHaveBeenCalled();
    expect(campaigns.automationBlock({ is_demo: false, auto_campaigns: [] }, "lista_espera")).toContain("avisa sola");
    expect(campaigns.automationBlock({ is_demo: true, auto_campaigns: ["recall"] }, "recall")).toContain("demo");

    // 55 inactivos más (sin celular repetido), con la última visita en días distintos.
    const extra = Array.from({ length: 55 }, (_, i) => ({ name: `Inactivo ${String(i).padStart(2, "0")}`, phone: `5491166${String(600000 + i)}`, months: 20, days: i }));
    const insertInactive = async (rows: typeof extra) => {
      for (const r of rows) {
        const [p] = await sql<Array<{ id: string }>>`insert into patients (clinic_id, full_name, phone) values (${CLINIC}, ${r.name}, ${r.phone}) returning id`;
        await sql`insert into patient_visits (clinic_id, patient_id, service, visited_at) values (${CLINIC}, ${p.id}, 'Consulta', ${isoAgo(r.months * 30 + r.days)})`;
      }
    };
    await insertInactive(extra);

    // Un borrador del equipo de la misma campaña: la automática nunca lo toma.
    const draft = await redirectedId(actions.prepareCampaignAction(form({ clinic_id: CLINIC, type: "reactivacion" })));

    // El administrador la prende (una vez, aunque toque dos veces).
    await actions.setAutoCampaignAction(form({ clinic_id: CLINIC, type: "reactivacion", enabled: "1" }));
    await actions.setAutoCampaignAction(form({ clinic_id: CLINIC, type: "reactivacion", enabled: "1" }));
    await actions.setAutoCampaignAction(form({ clinic_id: CLINIC, type: "lista_espera", enabled: "1" }));
    expect((await clinicLib.getClinic()).auto_campaigns).toEqual(["reactivacion"]);

    const audience = (await campaigns.computeAudience(await clinicLib.getClinic(), "reactivacion")).filter((m) => m.reachable);
    expect(audience.length).toBeGreaterThan(50);
    const first = await run("reactivacion");
    expect(first.ok).toBe(true);
    expect(first.clinicas).toHaveLength(1);
    expect(first.clinicas[0]).toMatchObject({ clinic_id: CLINIC, sent: 50, remaining: audience.length - 50, resumed: false });
    const auto = first.clinicas[0].campaign_id as string;
    expect((await sql`select automatic, status from campaigns where id = ${auto}`)[0]).toEqual({ automatic: true, status: "enviando" });

    // Entre corridas aparecen tres inactivos más recientes (quedan primeros en la audiencia): igual, la
    // segunda corrida sigue la misma campaña y les escribe a los que quedaron y a los nuevos.
    await insertInactive(extra.slice(0, 3).map((r, i) => ({ name: `Nuevo ${i}`, phone: `5491177${String(700000 + i)}`, months: 13, days: i })));
    const second = await run("reactivacion");
    expect(second.clinicas[0]).toMatchObject({ campaign_id: auto, resumed: true, sent: audience.length - 50 + 3, remaining: 0 });
    const phones = mocks.sendWhatsAppTemplate.mock.calls.map(([msg]) => (msg as { userId: string }).userId);
    expect(new Set(phones).size).toBe(phones.length);
    for (const m of audience) expect(phones).toContain(m.phone);
    expect((await sql`select status from campaigns where id = ${auto}`)[0].status).toBe("finalizada");
    // El borrador del equipo sigue intacto y prepararla de nuevo abre ese, no la automática.
    expect(await sql`select status from campaign_recipients where campaign_id = ${draft} and status <> 'pendiente' and status <> 'excluido'`).toHaveLength(0);
    expect(await redirectedId(actions.prepareCampaignAction(form({ clinic_id: CLINIC, type: "reactivacion" })))).toBe(draft);

    // Atribución: un turno cuenta si se sacó dentro de los 14 días del mensaje.
    const [target] = await sql<Array<{ id: string; patient_id: string }>>`
      select r.id, r.patient_id from campaign_recipients r join patients p on p.id = r.patient_id where r.campaign_id = ${auto} and p.full_name = 'Nuevo 0'`;
    const start = new Date(Date.now() + 5 * 86400_000);
    await sql`
      insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, status, source)
      values (${CLINIC}, ${target.patient_id}, '00000000-0000-4000-8000-0000000000a3', ${LIMPIEZA}, ${start}, ${new Date(start.getTime() + 40 * 60_000)}, 'confirmado', 'panel')`;
    await sql`update campaign_recipients set sent_at = now() - interval '20 days' where id = ${target.id}`;
    expect((await campaigns.campaignStats(CLINIC, [auto])).get(auto)).toMatchObject({ booked: 0, value: 0 });
    await sql`update campaign_recipients set sent_at = now() - interval '13 days' where id = ${target.id}`;
    expect((await campaigns.campaignStats(CLINIC, [auto])).get(auto)).toMatchObject({ booked: 1, value: 40000 });

    // Apagarla la saca de la lista y la próxima corrida no manda nada.
    await actions.setAutoCampaignAction(form({ clinic_id: CLINIC, type: "reactivacion", enabled: "0" }));
    expect((await clinicLib.getClinic()).auto_campaigns).toEqual([]);
    mocks.sendWhatsAppTemplate.mockClear();
    expect(await run("reactivacion")).toMatchObject({ ok: true, clinicas: [] });
    expect(mocks.sendWhatsAppTemplate).not.toHaveBeenCalled();
  }, 60000);

  it("nueva audiencia: reglas como frase, vista previa en vivo, audiencias guardadas y campaña con su lista", async () => {
    const preview = (rules: Record<string, unknown>) => actions.previewAudienceAction({ clinic_id: CLINIC, name: "", rules });
    const base = { monthsSince: null, appointmentTypeId: null, professionalId: null, coverage: null, ageMin: null, ageMax: null, birthdayThisMonth: false, noShow: false, controlIndicated: false };

    // Sin reglas no hay audiencia (para eso está «Aviso a todos»); la edad se valida.
    expect(await preview(base)).toMatchObject({ ok: false, message: expect.stringContaining("al menos una regla") });
    expect(await preview({ ...base, ageMin: 50, ageMax: 20 })).toMatchObject({ ok: false });

    // Cobertura y cumpleaños: una paciente nueva que cumple este mes y tiene OSDE.
    const month = String(new Date().getUTCMonth() + 1).padStart(2, "0");
    const [vera] = await sql<Array<{ id: string }>>`
      insert into patients (clinic_id, full_name, phone, coverage, birth_date) values (${CLINIC}, 'Vera Coto', '5491199990001', 'OSDE', ${`1990-${month}-15`}) returning id`;
    await sql`insert into patient_visits (clinic_id, patient_id, appointment_type_id, service, visited_at, professional) values (${CLINIC}, ${vera.id}, ${LIMPIEZA}, 'Limpieza dental', ${isoAgo(400)}, 'Dra. Prueba')`;
    const osde = await preview({ ...base, coverage: "OSDE", birthdayThisMonth: true });
    expect(osde).toMatchObject({ ok: true, preview: { reachable: 1, matching: 1 } });
    if (osde.ok) {
      expect(osde.preview.sentence).toBe("Pacientes que tienen OSDE, cumplen años este mes.");
      expect(osde.preview.sample[0].name).toBe("Vera C.");
    }

    // Meses sin venir + prestación: cuenta visitas importadas; el desglose suma.
    const limpieza = await preview({ ...base, monthsSince: 12, appointmentTypeId: LIMPIEZA });
    expect(limpieza.ok).toBe(true);
    if (limpieza.ok) {
      const p = limpieza.preview;
      expect(p.reachable).toBeGreaterThanOrEqual(1);
      expect(p.matching).toBe(p.reachable + p.optedOut + p.hasAppointment + p.recentCampaign + p.noPhone);
      expect(p.sentence).toBe("Pacientes que no vienen hace más de 12 meses, se atendieron de limpieza dental, con cualquier profesional.");
      expect(p.value).toBeGreaterThan(0);
    }
    // Edad: Vera tiene 36; entre 40 y 60 no entra.
    const older = await preview({ ...base, coverage: "OSDE", ageMin: 40, ageMax: 60 });
    expect(older.ok && older.preview.matching).toBe(0);

    // Guardar pide nombre; guardada aparece en la pantalla y se puede editar.
    expect(await actions.saveAudienceAction({ clinic_id: CLINIC, name: " ", rules: { ...base, coverage: "OSDE" } })).toMatchObject({ ok: false });
    const saved = await actions.saveAudienceAction({ clinic_id: CLINIC, name: "OSDE que cumplen años", rules: { ...base, coverage: "OSDE", birthdayThisMonth: true } });
    expect(saved).toMatchObject({ ok: true, id: expect.any(String) });
    const again = await actions.saveAudienceAction({ clinic_id: CLINIC, id: saved.id, name: "OSDE cumpleaños", rules: { ...base, coverage: "OSDE", birthdayThisMonth: true } });
    expect(again.id).toBe(saved.id);
    expect(await sql`select name from saved_audiences where clinic_id = ${CLINIC}`).toEqual([{ name: "OSDE cumpleaños" }]);

    // Crear la campaña: guarda las reglas, arma la lista y trae el mensaje sugerido y el seguimiento.
    const id = await redirectedId(actions.createAudienceCampaignAction({ clinic_id: CLINIC, id: saved.id, name: "OSDE cumpleaños", rules: { ...base, coverage: "OSDE", birthdayThisMonth: true } }));
    const [campaign] = await sql`select * from campaigns where id = ${id}`;
    expect(campaign).toMatchObject({ type: "audiencia", audience_id: saved.id, name: "OSDE cumpleaños" });
    expect(campaign.audience_rules).toMatchObject({ coverage: "OSDE", birthdayThisMonth: true });
    expect(campaign.message).toContain("{nombre}");
    expect(await sql`select patient_id, status from campaign_recipients where campaign_id = ${id}`).toEqual([{ patient_id: vera.id, status: "pendiente" }]);
    expect(await sql`select position from campaign_steps where campaign_id = ${id}`).toEqual([{ position: 2 }]);
    // Enviarla respeta las mismas reglas (si Vera saca turno antes, queda afuera).
    mocks.sendWhatsAppTemplate.mockClear();
    expect(await campaigns.sendCampaign(id)).toMatchObject({ sent: 1 });
    // Ya recibió una campaña para volver: la vista previa la cuenta como «otra campaña hace poco».
    const after = await preview({ ...base, coverage: "OSDE", birthdayThisMonth: true });
    expect(after.ok && after.preview.recentCampaign).toBe(1);

    // Las pantallas: la audiencia guardada en Campañas y el constructor con sus reglas.
    const render = async (page: Promise<unknown>) => renderToStaticMarkup((await page) as React.ReactElement);
    const index = await render((await import("@/app/panel/(app)/campanas/page")).default({ searchParams: Promise.resolve({ campana: id }) } as never));
    expect(index).toContain("OSDE cumpleaños");
    expect(index).toContain("Nueva audiencia");
    const builder = await render((await import("@/app/panel/(app)/campanas/audiencia/page")).default({ searchParams: Promise.resolve({ id: saved.id }) } as never));
    expect(builder).toContain("Pacientes que…");
    expect(builder).toContain("Siempre quedan afuera");
  }, 60000);

  it("revisar lote: con Sofi solo los elegidos, desde mi WhatsApp con seguimiento a mano, marcas de respuesta y piloto", async () => {
    const lotLib = await import("@/lib/campaign-lot");
    const clinic = await clinicLib.getClinic();
    await sql`update clinics set contact_cooldown_days = 0 where id = ${CLINIC}`;
    // Seis pacientes nuevos que no vienen hace dos años.
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const [p] = await sql<Array<{ id: string }>>`insert into patients (clinic_id, full_name, phone) values (${CLINIC}, ${`Lote Paciente${i}`}, ${`54911444000${i}`}) returning id`;
      await sql`insert into patient_visits (clinic_id, patient_id, service, visited_at) values (${CLINIC}, ${p.id}, 'Consulta', ${isoAgo(700 + i)})`;
      ids.push(p.id);
    }
    const campaign = await campaigns.prepareCampaign(clinic, { type: "audiencia", name: "Lote", audience: { id: null, rules: { monthsSince: 18, appointmentTypeId: null, professionalId: null, coverage: null, ageMin: null, ageMax: null, birthdayThisMonth: false, noShow: false, controlIndicated: false } } });
    await sql`update campaign_recipients set status = 'excluido' where campaign_id = ${campaign.id} and not (patient_id = any(${ids}::uuid[]))`;
    const recipient = async (i: number) => (await sql`select * from campaign_recipients where campaign_id = ${campaign.id} and patient_id = ${ids[i]}`)[0];

    // El lote trae los primeros 5 con su mensaje y el link al chat.
    let lot = await lotLib.campaignLot(clinic, (await sql`select * from campaigns where id = ${campaign.id}`)[0] as never);
    expect(lot.items).toHaveLength(5);
    expect(lot.items[0]).toMatchObject({ step: 1, links: { web: expect.stringContaining("web.whatsapp.com") } });
    expect(lot.items[0].message).toContain("BAJA");
    expect(lot.pending).toBe(6);

    // Piloto de 2: «Con Sofi» manda solo los elegidos y frena en el piloto.
    await actions.setPilotAction(form({ clinic_id: CLINIC, id: campaign.id, pilot: "1" }));
    expect((await sql`select pilot_size from campaigns where id = ${campaign.id}`)[0].pilot_size).toBe(20);
    await sql`update campaigns set pilot_size = 2 where id = ${campaign.id}`;
    mocks.sendWhatsAppTemplate.mockClear();
    const chosen = new FormData();
    chosen.set("clinic_id", CLINIC);
    chosen.set("id", campaign.id);
    for (const r of [await recipient(0), await recipient(1), await recipient(2)]) chosen.append("recipient", r.id);
    const sofi = await actions.sendLotWithSofiAction(undefined, chosen);
    expect(sofi).toMatchObject({ ok: true, message: expect.stringContaining("Terminó el piloto") });
    expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledTimes(2);
    expect((await recipient(3)).status).toBe("pendiente");
    lot = await lotLib.campaignLot(clinic, (await sql`select * from campaigns where id = ${campaign.id}`)[0] as never);
    expect(lot.pilot).toMatchObject({ size: 2, contacted: 2, done: true });
    expect(lot.items.filter((i) => i.step === 1)).toHaveLength(0);

    // Seguir con el resto: desde mi WhatsApp, con seguimiento a mano a los 5 días.
    await actions.setPilotAction(form({ clinic_id: CLINIC, id: campaign.id, pilot: "0" }));
    const r3 = await recipient(3);
    await actions.markManualSentAction(form({ clinic_id: CLINIC, id: r3.id }));
    const sent3 = await recipient(3);
    expect(sent3).toMatchObject({ status: "enviado", manual: true, messages_sent: 1 });
    expect(Math.round((new Date(sent3.next_step_at).getTime() - Date.now()) / 86400_000)).toBe(5);
    await sql`update campaign_recipients set next_step_at = now() - interval '1 hour' where id = ${r3.id}`;
    lot = await lotLib.campaignLot(clinic, (await sql`select * from campaigns where id = ${campaign.id}`)[0] as never);
    const follow = lot.items.find((i) => i.id === r3.id)!;
    expect(follow).toMatchObject({ step: 2 });
    expect(follow.message).toContain("te escribo de nuevo");
    expect(lot.sent.map((s) => s.id)).toContain(r3.id);
    await actions.markManualFollowupAction(form({ clinic_id: CLINIC, id: r3.id }));
    expect(await recipient(3)).toMatchObject({ messages_sent: 2, next_step_at: null, sequence_stopped: "Terminó la secuencia" });
    expect((await sql`select step, manual from campaign_messages where recipient_id = ${r3.id} order by step`).map((m) => m.step)).toEqual([1, 2]);

    // Marcas de lo que contestó en el WhatsApp de la clínica.
    const r4 = await recipient(4);
    await actions.markManualSentAction(form({ clinic_id: CLINIC, id: r4.id }));
    await actions.setOutcomeAction(form({ clinic_id: CLINIC, campaign_id: campaign.id, id: r4.id, outcome: "baja" }));
    expect(await recipient(4)).toMatchObject({ outcome: "baja", status: "respondio", next_step_at: null, sequence_stopped: "Pidió la baja" });
    expect((await sql`select contact_opt_out from patients where id = ${ids[4]}`)[0].contact_opt_out).toBe(true);
    await actions.setOutcomeAction(form({ clinic_id: CLINIC, campaign_id: campaign.id, id: r3.id, outcome: "no_interesa" }));
    expect(await recipient(3)).toMatchObject({ outcome: "no_interesa", status: "respondio" });
    await actions.setOutcomeAction(form({ clinic_id: CLINIC, campaign_id: campaign.id, id: (await recipient(5)).id, outcome: "respondio" }));
    expect((await recipient(5)).outcome).toBeNull(); // todavía no se le escribió: no se marca

    // Cuentan en los resultados como respuestas.
    const board = await import("@/lib/campaign-board");
    expect((await board.campaignResults(clinic, campaign.id, "todo")).replied).toBeGreaterThanOrEqual(2);

    // La pantalla del lote se arma.
    const html = renderToStaticMarkup(
      (await (await import("@/app/panel/(app)/campanas/[id]/lote/page")).default({ params: Promise.resolve({ id: campaign.id }) } as never)) as React.ReactElement,
    );
    expect(html).toContain("Revisar lote");
    expect(html).toContain("Desde mi WhatsApp, de a uno");
    expect(html).toContain("Pidió la baja");
    await sql`update clinics set contact_cooldown_days = 30 where id = ${CLINIC}`;
  }, 60000);
});
