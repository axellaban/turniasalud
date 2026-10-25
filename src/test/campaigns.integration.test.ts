import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Campañas para activar la base: importación de pacientes, audiencias con visitas importadas y
// controles indicados, lista que se revisa antes de enviar, envío a mano o con Sofi y tope de contacto.

const mocks = vi.hoisted(() => ({
  session: undefined as string | undefined,
  sendWhatsAppTemplate: vi.fn<(msg: unknown) => Promise<{ conversation_id: string }>>(async () => ({ conversation_id: "conv_campana" })),
}));
vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn(async () => {}) }));
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
  const match = /redirect:\/panel\/campanas\/([0-9a-f-]{36})/.exec(error?.message ?? "");
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
      `María González;011 15 5555-0001;99999999;maria@example.com;${ago(7)};Limpieza dental;`,
      `Pedro Luna;351 555-0102;;;${ago(2)};Ortodoncia;${ago(0, 3)}`,
      `Sin Celular;;;;${ago(3)};Consulta;`,
    ].join("\n");
    expect(await actions.importPatientsAction(undefined, form({ clinic_id: CLINIC, text }))).toMatchObject({ ok: false, message: expect.stringContaining("Confirmá") });

    const result = await actions.importPatientsAction(undefined, form({ clinic_id: CLINIC, text, consent: "on", source: "pacientes.csv" }));
    expect(result).toMatchObject({ ok: true, summary: { created: 2, existing: 1, visits: 4, skipped: 1, unmatched: ["Ortodoncia"] } });

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
    expect(again.summary).toMatchObject({ created: 0, existing: 3, visits: 0 });
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
    for (const text of ["Tu base para volver a agendar", "Controles vencidos", "Pacientes inactivos", "Controles periódicos", "Reglas de contacto"]) expect(index).toContain(text);
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
});
