import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

const mocks = vi.hoisted(() => ({ cookies: new Map<string, string>(), after: [] as Array<() => unknown>, sent: vi.fn(), agent: vi.fn(async () => ({ conversation_id: "profile-conv" })) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => mocks.cookies.has(name) ? { value: mocks.cookies.get(name) } : undefined, set: (name: string, value: string) => mocks.cookies.set(name, value), delete: (name: string) => mocks.cookies.delete(name) }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); }, notFound: () => { throw new Error("notFound"); }, usePathname: () => "/panel/clinicas", useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (fn: () => unknown) => mocks.after.push(fn) }));
vi.mock("@/lib/messaging", () => ({ sendChatText: mocks.sent, sendChatVoice: vi.fn() }));
vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn() }));
vi.mock("@/lib/elevenlabs", async (original) => ({ ...(await original<typeof import("@/lib/elevenlabs")>()), sendChannelMessage: mocks.agent, getConversationToken: vi.fn(async () => "test-token"), getSignedUrl: vi.fn(async () => "wss://test.invalid") }));
vi.mock("@/lib/demo/scraper", async (original) => ({ ...(await original<typeof import("@/lib/demo/scraper")>()), scrapeSite: vi.fn(async () => ({ url: "https://clinica.example/", text: "Texto original leído", pages: [{ url: "https://clinica.example/", title: "Fuente original", text: "Texto original leído <script>inofensivo</script>" }] })) }));
vi.mock("@/lib/demo/profile", async (original) => ({ ...(await original<typeof import("@/lib/demo/profile")>()), buildProfile: vi.fn(async () => PROFILE) }));

const PROFILE = {
  nombre: "Clínica Alfa", especialidad: "Odontología", descripcion: "Consultorio de prueba", direccion: "Calle de la web 100", telefono: "541144440000", horario_texto: "Lunes a viernes de 9 a 18", horarios: [1, 2, 3, 4, 5].map((dia) => ({ dia, desde: "09:00", hasta: "18:00" })), coberturas: ["Particular"], profesionales: [{ nombre: "Dra. Alfa", especialidad: "Odontología", dias: [], bio: "Odontóloga" }], prestaciones: [{ nombre: "Consulta", especialidad: "Odontología", duracion_min: 30, precio: 30000, indicaciones: "Traer estudios", primera_vez: true }], preguntas_frecuentes: "FAQ de la web", politicas: "Política de la web",
};
const base = testDatabaseUrl();
const MAIN = "00000000-0000-4000-8000-000000000001";
const form = (data: Record<string, string>) => { const out = new FormData(); for (const [key, value] of Object.entries(data)) out.set(key, value); return out; };

describe.runIf(base)("Perfiles de clínicas editables", () => {
  let sql: typeof import("@/lib/db").sql;
  let actions: typeof import("@/app/panel/actions");
  let clinics: typeof import("@/app/panel/clinics-actions");
  let panel: typeof import("@/lib/panel-clinic");
  let imports: typeof import("@/lib/clinic-imports");
  let session: typeof import("@/lib/demo/session");
  let a: string; let b: string;
  const choose = (id: string) => mocks.cookies.set("turnia_clinic", id);
  const clinic = async (id = a) => (await sql`select * from clinics where id = ${id}`)[0];
  beforeAll(async () => {
    const url = await scratchDatabase(base!, "turnia_test_clinics");
    await resetTestDatabase(url);
    for (const [key, value] of Object.entries({ DATABASE_URL: url, SESSION_SECRET: "test-session", AGENT_TOOLS_SECRET: "test-tools", APP_URL: "https://turnia.test", ELEVENLABS_API_KEY: "fake", TELEGRAM_BOT_TOKEN: "fake", ELEVENLABS_CHANNEL_URL: "https://test.invalid/channel", ELEVENLABS_CHANNEL_SECRET: "fake", ELEVENLABS_CHANNEL_SIGNING_SECRET: "fake" })) vi.stubEnv(key, value);
    ({ sql } = await import("@/lib/db"));
    actions = await import("@/app/panel/actions"); clinics = await import("@/app/panel/clinics-actions"); panel = await import("@/lib/panel-clinic"); imports = await import("@/lib/clinic-imports"); session = await import("@/lib/demo/session");
    await sql`update clinics set elevenlabs_agent_id = 'agent_test', whatsapp_provider = 'waha', whatsapp_phone_number_id = 'keep-number', templates = '{"recordatorio":"keep-template"}' where id = ${MAIN}`;
  }, 60000);
  beforeEach(async () => {
    mocks.cookies.clear(); mocks.after.length = 0; mocks.sent.mockClear(); mocks.agent.mockClear();
    mocks.cookies.set("turnia_session", (await import("@/lib/session")).createSessionToken());
    await sql`delete from demo_sessions`; await sql`delete from demo_handoffs`; await sql`delete from clinic_access`; await sql`delete from clinics where is_demo`;
    await sql`update messaging_settings set active_channel = 'telegram', revision = 0, telegram_ready = true where id`;
    a = (await session.createDemoClinic(PROFILE, "https://clinica.example/")).id;
    b = (await session.createDemoClinic({ ...PROFILE, nombre: "Clínica Beta" }, "https://beta.example/")).id;
    choose(a);
    vi.mocked((await import("@/lib/demo/scraper")).scrapeSite).mockClear();
    vi.mocked((await import("@/lib/demo/profile")).buildProfile).mockClear();
  });
  afterAll(async () => { await (await import("@/lib/db")).closeDb(); vi.unstubAllEnvs(); });

  it("protege la selección y mantiene los webhooks independientes de la clínica del panel", async () => {
    expect((await panel.getPanelClinic()).id).toBe(a);
    expect((await (await import("@/lib/clinic")).getClinic()).id).toBe(MAIN);
    await expect(clinics.selectClinic(form({ clinic_id: b }))).rejects.toThrow("redirect:/panel/configuracion");
    expect((await panel.getPanelClinic()).id).toBe(b);
    mocks.cookies.delete("turnia_session");
    await expect(panel.getPanelClinic()).rejects.toThrow("redirect:/panel/login");
    await expect(clinics.selectClinic(form({ clinic_id: a }))).rejects.toThrow("redirect:/panel/login");
  });
  it("guarda todo el contexto de una clínica, la conserva y no modifica conexiones ni otra clínica", async () => {
    const rootBefore = await clinic(MAIN);
    await actions.saveClinic(form({ clinic_id: a, name: "Alfa editada", agent_name: "Ana", specialty: "Odontología integral", website: "alfa.example", timezone: "America/Argentina/Buenos_Aires", address: "Dirección corregida 123", phone: "541122223333", hours_text: "Martes y jueves de 10 a 19", accepted_coverages: "OSDE, Particular", faq: "FAQ manual", policies: "Cancelar 24 horas antes", urgency_instructions: "Ir a la guardia", after_hours_instructions: "Recepción responde mañana", handoff_phone: "+541133334444", payment_methods: "Efectivo y transferencia", agent_context: "Preguntá si es la primera consulta.", whatsapp_provider: "meta", whatsapp_phone_number_id: "do-not-save" }));
    const row = await clinic();
    expect(row).toMatchObject({ name: "Alfa editada", address: "Dirección corregida 123", agent_name: "Ana", accepted_coverages: ["OSDE", "Particular"], payment_methods: "Efectivo y transferencia", context_revision: 1, is_demo: true });
    expect(row.retained_at).toBeTruthy(); expect(await clinic(MAIN)).toEqual(rootBefore); expect((await clinic(b)).name).toBe("Clínica Beta");
    const vars = await (await import("@/lib/clinic")).buildDynamicVariables(row as never, "telegram:123");
    for (const text of ["Dirección corregida", "FAQ manual", "Cancelar 24", "Efectivo", "primera consulta"]) expect(vars.clinic_info).toContain(text);
    expect(vars.urgency_instructions).toContain("Ir a la guardia"); expect(vars.urgency_instructions).toContain("Recepción responde mañana");
  });
  it("rechaza guardar un formulario abierto antes de cambiar de clínica", async () => {
    choose(b);
    await expect(actions.saveClinic(form({ clinic_id: a, name: "No debe guardarse" }))).rejects.toThrow("seleccionada cambió");
    expect((await clinic(a)).name).toBe("Clínica Alfa"); expect((await clinic(b)).name).toBe("Clínica Beta");
  });
  it("edita profesionales y prestaciones con pertenencia a la clínica", async () => {
    const [pro] = await sql`select * from professionals where clinic_id = ${a}`;
    const [type] = await sql`select * from appointment_types where clinic_id = ${a}`;
    const [foreign] = await sql`select * from professionals where clinic_id = ${b}`;
    await actions.saveProfessional(form({ clinic_id: a, id: pro.id, full_name: "Dra. Corregida", specialty: "Odontología", bio: "Bio manual", accepted_coverages: "OSDE, Particular" }));
    await actions.saveProfessional(form({ clinic_id: a, id: foreign.id, full_name: "No tocar", specialty: "Otra" }));
    expect((await sql`select full_name from professionals where id = ${foreign.id}`)[0].full_name).toBe("Dra. Alfa");
    expect((await sql`select * from professionals where id = ${pro.id}`)[0]).toMatchObject({ full_name: "Dra. Corregida", bio: "Bio manual", accepted_coverages: ["OSDE", "Particular"] });
    await actions.saveAppointmentType(form({ clinic_id: a, id: type.id, name: "Control editado", specialty: "Odontología", duration_min: "45", price: "45.000", recall_months: "6", instructions: "Traer DNI", is_first_visit: "on" }));
    expect((await sql`select * from appointment_types where id = ${type.id}`)[0]).toMatchObject({ name: "Control editado", duration_min: 45, price: "45000.00", instructions: "Traer DNI", recall_months: 6, is_first_visit: true });
  });
  it("conservar una demo evita la limpieza de siete días y mantiene el modo de prueba", async () => {
    await sql`update clinics set created_at = now() - interval '8 days' where id in (${a}, ${b})`;
    await clinics.retainClinic(form({ clinic_id: a }));
    await session.createDemoClinic(PROFILE, "https://new.example/");
    expect((await clinic(a)).is_demo).toBe(true);
    expect(await clinic(b)).toBeUndefined();
    expect((await clinic(MAIN)).id).toBe(MAIN);
  });
  it("archiva el texto original y la ficha al crear una demo desde la web", async () => {
    const result = await session.handleDemoMessage({ messageId: "initial-web", chatId: "telegram:123", phone: "telegram:123", text: "Quiero probar la demo con https://clinica.example/" });
    await session.analyzeDemo(result!.analyze!);
    const [snapshot] = await sql`select * from clinic_imports`;
    expect(snapshot.status).toBe("applied"); expect(snapshot.pages[0].text).toContain("Texto original leído"); expect(snapshot.profile.nombre).toBe("Clínica Alfa");
  });
  it("relee sin cambiar la ficha y permite aplicar solo un dato elegido", async () => {
    await sql`update clinics set address = 'Manual 22', faq = 'FAQ manual prioritaria', agent_context = 'Contexto manual', payment_methods = 'Transferencia' where id = ${a}`;
    const id = await imports.requestClinicImport(a, "https://clinica.example/");
    expect(await imports.requestClinicImport(a, "https://clinica.example/")).toBe(id);
    await imports.readClinicImport(id); await imports.readClinicImport(id);
    expect(vi.mocked((await import("@/lib/demo/profile")).buildProfile)).toHaveBeenCalledTimes(1);
    expect((await clinic()).address).toBe("Manual 22");
    await imports.applyClinicImport(a, id, ["address"], 0);
    expect(await clinic()).toMatchObject({ address: "Calle de la web 100", faq: "FAQ manual prioritaria", agent_context: "Contexto manual", payment_methods: "Transferencia" });
    await expect(imports.applyClinicImport(a, id, ["faq"], 1)).rejects.toThrow("ya no está disponible");
  });
  it("rechaza revisiones obsoletas o de otra clínica y conserva el catálogo anterior", async () => {
    const id = await imports.requestClinicImport(a, "https://clinica.example/"); await imports.readClinicImport(id);
    await panel.touchClinic(a);
    await expect(imports.applyClinicImport(a, id, ["name"], 0)).rejects.toThrow("perfil cambió");
    await expect(imports.applyClinicImport(b, id, ["name"], 0)).rejects.toThrow("ya no está disponible");
    const [oldPro] = await sql`select id from professionals where clinic_id = ${a}`;
    await imports.applyClinicImport(a, id, ["catalog"], 1);
    expect((await sql`select active from professionals where id = ${oldPro.id}`)[0].active).toBe(false);
    expect((await sql`select * from professionals where clinic_id = ${a} and active`)).toHaveLength(1);
    expect((await sql`select * from professionals where clinic_id = ${a}`)).toHaveLength(2);
  });
  it("probar el perfil reutiliza la misma clínica y envía sus correcciones al agente", async () => {
    await sql`update clinics set faq = 'FAQ corregida guardada', agent_context = 'Instrucción guardada' where id = ${a}`;
    const launch = await clinics.launchProfile({}, form({ clinic_id: a }));
    const token = new URL(launch.url!).searchParams.get("start")!;
    expect(token).toMatch(/^p_/);
    const input = { messageId: "saved-start", chatId: "telegram:123", phone: "telegram:123", text: `Probar perfil de Turnia: ${token}` };
    expect(await session.handleDemoMessage(input)).toEqual({ handled: true, status: "eligiendo" });
    expect((await sql`select clinic_id, reused_profile from demo_sessions`)[0]).toMatchObject({ clinic_id: a, reused_profile: true });
    expect((await sql`select * from clinics where is_demo`)).toHaveLength(2);
    expect((await import("@/lib/demo/scraper")).scrapeSite).not.toHaveBeenCalled();
    await session.handleDemoMessage({ ...input, messageId: "choose-chat", text: "chat" });
    await session.handleDemoMessage({ ...input, messageId: "ask", text: "¿Dónde atienden?" });
    expect(JSON.stringify(mocks.agent.mock.calls)).toContain("FAQ corregida guardada");
    expect(JSON.stringify(mocks.agent.mock.calls)).toContain("Instrucción guardada");
    // Mismo chat, sin cambios en la ficha: sigue la misma conversación del agente.
    await session.handleDemoMessage({ ...input, messageId: "ask-2", text: "¿Atienden sábados?" });
    const call = (n: number) => (mocks.agent.mock.calls as unknown as Array<[{ conversationId?: string; dynamicVariables: Record<string, string> }]>).at(n)![0];
    expect(call(-1).conversationId).toBe("profile-conv");
    // El consultorio edita la ficha: el próximo mensaje arranca otra conversación con los datos nuevos.
    expect(await actions.saveClinicWithFeedback({}, form({ clinic_id: a, name: "Clínica Alfa", agent_name: "Ana", faq: "Ahora atendemos sábados" }))).toMatchObject({ ok: true });
    await session.handleDemoMessage({ ...input, messageId: "ask-3", text: "¿Entonces atienden sábados?" });
    expect(call(-1).conversationId).toBeUndefined();
    expect(JSON.stringify(call(-1).dynamicVariables)).toContain("Ahora atendemos sábados");
    expect(call(-1).dynamicVariables.conversation_context).toContain("Paciente: ¿Atienden sábados?");
    await session.handleDemoMessage({ ...input, messageId: "ask-4", text: "Gracias" });
    expect(call(-1).conversationId).toBe("profile-conv");
    // El enlace del perfil sigue sirviendo después de usarlo, también desde otro chat.
    expect(await (await import("@/lib/demo/handoff")).claimProfileHandoff(token, "telegram:999")).toBe(a);
    expect(await session.handleDemoMessage({ ...input, messageId: "saved-again", text: `Probar perfil de Turnia: ${token}` })).toEqual({ handled: true, status: "eligiendo" });
    const [{ days }] = await sql`select extract(epoch from expires_at - created_at) / 86400 as days from demo_handoffs where token = ${token}`;
    expect(Number(days)).toBeCloseTo(7, 1);
  });
  it("borra una ficha de demo o todas las temporales y nunca la principal", async () => {
    await sql`update clinics set retained_at = now() where id = ${a}`;
    const temporal = (await session.createDemoClinic({ ...PROFILE, nombre: "Clínica Gamma" }, "https://gamma.example/")).id;
    choose(b);
    await clinics.deleteClinic(form({ clinic_id: b }));
    expect(await sql`select id from clinics where id = ${b}`).toHaveLength(0);
    expect((await panel.getPanelClinic()).id).toBe(MAIN);
    await expect(clinics.deleteClinic(form({ clinic_id: MAIN }))).rejects.toThrow("Solo se pueden borrar fichas de demo.");
    await clinics.deleteTemporaryDemos();
    expect(await sql`select id from clinics where id = ${temporal}`).toHaveLength(0);
    expect((await sql`select id from clinics order by is_demo`).map((c) => c.id)).toEqual([MAIN, a]);
    mocks.cookies.delete("turnia_session");
    await expect(clinics.deleteClinic(form({ clinic_id: a }))).rejects.toThrow("redirect:/panel/login");
  });
  it("los enlaces de perfil aceptan tokens que terminan en guion y verifican vencimiento", async () => {
    const token = `p_${"a".repeat(23)}-`;
    await sql`insert into demo_handoffs (token, website, requester_hash, clinic_id) values (${token}, 'https://clinica.example', 'test', ${a})`;
    const input = { messageId: "ends-hyphen", chatId: "telegram:123", phone: "telegram:123", text: `Probar perfil: ${token}` };
    expect(await session.handleDemoMessage(input)).toMatchObject({ status: "eligiendo" });
    await sql`update demo_handoffs set expires_at = now() - interval '1 minute' where token = ${token}`;
    expect(await (await import("@/lib/demo/handoff")).claimProfileHandoff(token, "telegram:123")).toBeNull();
  });
  it("la agenda y los pacientes del panel corresponden a la clínica elegida", async () => {
    await sql`insert into patients (clinic_id, phone, full_name) values (${a}, 'test-alpha', 'Paciente Alfa visible'), (${b}, 'test-beta', 'Paciente Beta privado')`;
    const patients = (await import("@/app/panel/(app)/pacientes/page")).default;
    const html = renderToStaticMarkup(await patients({ searchParams: Promise.resolve({}) } as never));
    expect(html).toContain("Paciente Alfa visible"); expect(html).not.toContain("Paciente Beta privado");
    choose(b);
    const other = renderToStaticMarkup(await patients({ searchParams: Promise.resolve({}) } as never));
    expect(other).toContain("Paciente Beta privado"); expect(other).not.toContain("Paciente Alfa visible");
  });
  it("una lectura con fallo conserva la ficha y queda registrada como error", async () => {
    const scraper = await import("@/lib/demo/scraper");
    vi.mocked(scraper.scrapeSite).mockRejectedValueOnce(new Error("Fallo simulado de red"));
    const before = await clinic();
    const id = await imports.requestClinicImport(a, "https://clinica.example");
    await imports.readClinicImport(id);
    expect((await sql`select status from clinic_imports where id = ${id}`)[0].status).toBe("error");
    expect((await clinic()).faq).toBe(before.faq);
    expect((await clinic()).name).toBe(before.name);
  });
  it("la demo privada usa la clínica elegida y el agente compartido", async () => {
    const api = (await import("@/app/api/elevenlabs/token/route")).POST;
    const response = await api(new Request("https://turnia.test/api/elevenlabs/token", { method: "POST", body: JSON.stringify({ mode: "voz" }) }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.clinicName).toBe("Clínica Alfa"); expect(payload.agentId).toBe("agent_test"); expect(payload.dynamicVariables.clinic_id).toBe(a);
  });
  it("muestra el editor completo y aísla las conexiones generales", async () => {
    const render = async (path: string) => renderToStaticMarkup(await (await import(`@/app/panel/(app)/${path}/page`)).default());
    const pages = await Promise.all(["configuracion", "configuracion/equipo", "configuracion/prestaciones", "configuracion/bloqueos", "configuracion/web"].map(render));
    const html = pages.join("");
    for (const label of ["Clínica Alfa", "Preguntas frecuentes", "Protocolo de urgencias", "Instrucciones adicionales", "Formas de pago", "Editar profesional", "Editar prestación", "Probar este perfil", "Lecturas de la web", "Bloquear agenda", "Acceso del consultorio"]) expect(html).toContain(label);
    // Las conexiones generales viven solo en Sistema.
    expect(html).not.toContain("Conectar bot de Telegram"); expect(html).not.toContain("Regenerar"); expect(html).not.toContain("WhatsApp por WAHA");
    expect(renderToStaticMarkup(await (await import("@/app/panel/(app)/sistema/page")).default())).toContain("Conectar bot de Telegram");
    const list = (await import("@/app/panel/(app)/clinicas/page")).default;
    expect(renderToStaticMarkup(await list({ searchParams: Promise.resolve({}) } as never))).toContain("Clínica Beta");
  });
  it("el acceso del consultorio solo ve y edita su clínica, y se puede revocar", async () => {
    const created = await clinics.createAccess({}, form({ clinic_id: a, label: "Dr. Alfa" }));
    expect(created.code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    expect(JSON.stringify(await sql`select * from clinic_access`)).not.toContain(created.code!.replace(/-/g, ""));

    // Ingreso con el código (en minúsculas y sin guiones también vale).
    vi.stubEnv("PANEL_PASSWORD", "clave-admin");
    const { POST } = await import("@/app/api/panel/login/route");
    const body = new FormData(); body.set("password", created.code!.toLowerCase().replace(/-/g, " ")); body.set("next", "/panel/clinicas");
    const res = await POST(new Request("https://turnia.test/api/panel/login", { method: "POST", body }));
    expect(res.status).toBe(303);
    const token = res.cookies.get("turnia_session")!.value;
    expect((await import("@/lib/session")).readSessionToken(token)).toMatchObject({ role: "clinic" });
    const bad = new FormData(); bad.set("password", "AAAA-BBBB-CCCC-DDDD"); bad.set("next", "/panel");
    expect(new URL((await POST(new Request("https://turnia.test/api/panel/login", { method: "POST", body: bad }))).headers.get("location")!).searchParams.get("error")).toBe("password");

    mocks.cookies.set("turnia_session", token);
    choose(b); // aunque la cookie de selección apunte a otra clínica
    expect((await panel.getPanelClinic()).id).toBe(a);
    await expect(panel.getPanelClinic(form({ clinic_id: b }))).rejects.toThrow("La clínica seleccionada cambió");
    expect(await actions.saveClinicWithFeedback({}, form({ clinic_id: a, name: "Alfa por el consultorio", agent_name: "Ana" }))).toMatchObject({ ok: true });
    expect((await clinic(a)).name).toBe("Alfa por el consultorio");
    expect((await clinic(b)).name).toBe("Clínica Beta");
    // Queda registrado quién cambió qué.
    expect((await sql`select actor, area from clinic_changes where clinic_id = ${a}`)[0]).toMatchObject({ actor: "Dr. Alfa", area: "Reglas del consultorio" });

    // Lo del administrador queda cerrado.
    const denied = "redirect:/panel";
    await expect(clinics.selectClinic(form({ clinic_id: b }))).rejects.toThrow(denied);
    await expect(clinics.deleteClinic(form({ clinic_id: b }))).rejects.toThrow(denied);
    await expect(clinics.deleteTemporaryDemos()).rejects.toThrow(denied);
    await expect(clinics.createClinic({}, form({ name: "Otra" }))).rejects.toThrow(denied);
    await expect(clinics.createAccess({}, form({ clinic_id: a }))).rejects.toThrow(denied);
    await expect(actions.saveMessagingChannel({}, form({ channel: "pausado" }))).rejects.toThrow(denied);
    await expect(actions.saveDemoLimit({}, form({ demo_daily_limit: "1" }))).rejects.toThrow(denied);
    for (const path of ["clinicas", "sistema", "demos"]) await expect((async () => (await import(`@/app/panel/(app)/${path}/page`)).default({ searchParams: Promise.resolve({}) }))()).rejects.toThrow(denied);
    expect(await sql`select id from clinics where id = ${b}`).toHaveLength(1);
    expect((await sql`select active_channel from messaging_settings`)[0].active_channel).toBe("telegram");
    const home = renderToStaticMarkup(await (await import("@/app/panel/(app)/page")).default());
    expect(home).toContain("Alfa por el consultorio"); expect(home).not.toContain("Terminá la puesta en marcha");
    const config = renderToStaticMarkup(await (await import("@/app/panel/(app)/configuracion/page")).default());
    expect(config).not.toContain("Acceso del consultorio"); expect(config).not.toContain("/panel/sistema");

    // Revocado, deja de valer en el acto y el login no entra en bucle.
    const [{ id }] = await sql`select id from clinic_access where clinic_id = ${a}`;
    mocks.cookies.set("turnia_session", (await import("@/lib/session")).createSessionToken());
    // Desde otra clínica seleccionada no se revoca un acceso ajeno.
    await clinics.revokeAccess(form({ clinic_id: b, access_id: id }));
    expect((await sql`select revoked_at from clinic_access where id = ${id}`)[0].revoked_at).toBeNull();
    choose(a);
    await clinics.revokeAccess(form({ clinic_id: a, access_id: id }));
    mocks.cookies.set("turnia_session", token);
    await expect(panel.getPanelClinic()).rejects.toThrow("redirect:/panel/login?error=revoked");
    const login = (await import("@/app/panel/login/page")).default;
    expect(renderToStaticMarkup(await login({ searchParams: Promise.resolve({ error: "revoked" }) } as never))).toContain("ya no está habilitado");
    expect(new URL((await POST(new Request("https://turnia.test/api/panel/login", { method: "POST", body }))).headers.get("location")!).pathname).toBe("/panel/login");
  });
  it("limita los intentos fallidos de ingreso por origen", async () => {
    vi.stubEnv("PANEL_PASSWORD", "clave-admin");
    await sql`delete from login_failures`;
    const { POST } = await import("@/app/api/panel/login/route");
    const attempt = async (password: string, ip = "203.0.113.7") => {
      const body = new FormData(); body.set("password", password); body.set("next", "/panel");
      const res = await POST(new Request("https://turnia.test/api/panel/login", { method: "POST", body, headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } }));
      return new URL(res.headers.get("location")!);
    };
    for (let i = 0; i < 10; i++) expect((await attempt("mala")).searchParams.get("error")).toBe("password");
    expect((await attempt("clave-admin")).searchParams.get("error")).toBe("too_many");
    expect((await attempt("clave-admin", "198.51.100.2")).pathname).toBe("/panel");
    expect(JSON.stringify(await sql`select * from login_failures`)).not.toContain("203.0.113.7");
    // El consultorio sin destino pedido entra directo a su configuración.
    const { code } = await clinics.createAccess({}, form({ clinic_id: a }));
    expect((await attempt(code!, "198.51.100.3")).pathname).toBe("/panel/configuracion");
  });
  it("el administrador ajusta el límite diario de demos (0 = sin límite)", async () => {
    expect(await actions.saveDemoLimit({}, form({ demo_daily_limit: "5" }))).toMatchObject({ ok: true });
    expect((await sql`select demo_daily_limit from messaging_settings`)[0].demo_daily_limit).toBe(5);
    expect(await actions.saveDemoLimit({}, form({ demo_daily_limit: "-2" }))).toMatchObject({ ok: false });
    expect(await actions.saveDemoLimit({}, form({ demo_daily_limit: "0" }))).toMatchObject({ ok: true, message: "Sin límite de demos por persona." });
    expect((await sql`select demo_daily_limit from messaging_settings`)[0].demo_daily_limit).toBeNull();
  });
  it("borrar la clínica borra sus accesos", async () => {
    await clinics.createAccess({}, form({ clinic_id: a }));
    await clinics.deleteClinic(form({ clinic_id: a }));
    expect(await sql`select id from clinic_access`).toHaveLength(0);
  });
  it("no envía campañas ni avisos a pacientes de una clínica de demo", async () => {
    await expect((await import("@/lib/whatsapp")).sendPatientMessage(await clinic() as never, { phone: "5491100000000", templateKey: "respuesta", templateName: "respuesta", params: ["Ficticio", "prueba"], context: "test" })).rejects.toThrow("Modo demo");
  });
});
