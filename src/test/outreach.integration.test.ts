import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Prospección a odontólogos: la lista se importa, la cola del día respeta la meta y los números
// compartidos, cada contacto programa su seguimiento, la baja vale para siempre y el link de la
// demo registra quién la abrió y quién la probó (con su nombre como profesional).

const mocks = vi.hoisted(() => ({
  session: undefined as string | undefined,
  after: [] as Array<() => unknown>,
}));
vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn(async () => {}) }));
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
  usePathname: () => "/panel/prospeccion",
  useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => mocks.after.push(fn),
}));

const base = testDatabaseUrl();
const form = (data: Record<string, string>) => {
  const out = new FormData();
  for (const [key, value] of Object.entries(data)) out.set(key, value);
  return out;
};

const LIST = [
  "codigo,nombre,saludo,tratamiento,consultorio,zona,direccion,especialidad,telefono,tipo_telefono,prioridad,senales,fuente",
  "moreta-ab3,Myriam Daniela Moreta,Myriam,Dra.,Consultorio Odontológico Moreta,Mar del Plata,Av Juan José Paso 2121,Ortodoncia,+5492236602433,movil,1,celular propio,Círculo",
  "secreti-c4d,Fernando A. Secreti,Fernando,Dr.,Consultorio Odontológico Secreti,Mar del Plata,Mitre 2947,Implantes,+5492233046072,movil,2,celular del consultorio,Círculo",
  "jan-e5f,Fausto Rodrigo Jan,Fausto,,Consultorio Odontológico Jan,Mar del Plata,Mitre 2947,Odontología,+5492233046072,movil,3,mismo teléfono,Círculo",
  "pirera-g6h,Oscar Antonio Pirera,Oscar,,Consultorio Odontológico Pirera,Miramar,Calle 26 950,Odontología,+542291420128,fijo,2,,Círculo",
  "lopez-j7k,María Elvira López Sánchez,María,Dra.,Consultorio Odontológico López,Mar del Plata,Saavedra 3527,Ortodoncia,+5492236147600,movil,2,,Círculo",
  "sinc-m8n,Paula Sin Contacto,Paula,,,Mar del Plata,,Odontología,,,3,,Doctoralia",
].join("\n");

describe.runIf(base)("prospección a odontólogos", () => {
  let sql: typeof import("@/lib/db").sql;
  let outreach: typeof import("@/lib/sales/outreach");
  let actions: typeof import("@/app/panel/(app)/prospeccion/actions");
  const id = async (code: string) => (await sql<Array<{ id: string }>>`select id from sales_outreach where code = ${code}`)[0].id;
  const runAfter = async () => {
    for (const fn of mocks.after.splice(0)) await fn();
  };

  beforeAll(async () => {
    const url = await scratchDatabase(base!, "turnia_test_outreach");
    await resetTestDatabase(url);
    for (const [key, value] of Object.entries({ DATABASE_URL: url, SESSION_SECRET: "test-session", AGENT_TOOLS_SECRET: "test-tools", ELEVENLABS_API_KEY: "fake", APP_URL: "https://turnia.example" })) vi.stubEnv(key, value);
    ({ sql } = await import("@/lib/db"));
    outreach = await import("@/lib/sales/outreach");
    actions = await import("@/app/panel/(app)/prospeccion/actions");
    mocks.session = (await import("@/lib/session")).createSessionToken();
  }, 60000);

  afterAll(async () => {
    await (await import("@/lib/db")).closeDb();
    vi.unstubAllEnvs();
  });

  it("importa la lista y, al volver a importarla, solo completa lo que falta", async () => {
    expect(await actions.importOutreachAction(undefined, form({ text: "" }))).toMatchObject({ ok: false });
    expect(await actions.importOutreachAction(undefined, form({ text: LIST }))).toMatchObject({ ok: true, created: 6, updated: 0 });
    // Lo corregido en el panel no se pisa.
    await sql`update sales_outreach set greeting = 'Myri' where code = 'moreta-ab3'`;
    const again = await actions.importOutreachAction(undefined, form({ text: LIST.replace("Calle 26 950", "Calle 26 N 950") }));
    expect(again).toMatchObject({ ok: true, created: 0, updated: 6 });
    const [moreta] = await sql`select greeting, title, phone, phone_kind, priority from sales_outreach where code = 'moreta-ab3'`;
    expect(moreta).toEqual({ greeting: "Myri", title: "Dra.", phone: "+5492236602433", phone_kind: "movil", priority: 1 });
    // Sin código, se reconoce por nombre y teléfono y no se duplica.
    const sinCodigo = "nombre,telefono,tipo_telefono,zona\nMaría Elvira López Sánchez,+5492236147600,movil,Mar del Plata\nNueva Persona,223 6000000,movil,Batán";
    expect(await actions.importOutreachAction(undefined, form({ text: sinCodigo }))).toMatchObject({ created: 1, updated: 1 });
    const [nueva] = await sql<Array<{ code: string }>>`select code from sales_outreach where name = 'Nueva Persona'`;
    expect(nueva.code).toMatch(/^persona-[a-z2-9]{5}$/);
    await sql`delete from sales_outreach where name = 'Nueva Persona'`;
  });

  it("la cola de hoy va por prioridad, respeta la meta y no repite un número compartido", async () => {
    const { fresh } = await outreach.outreachQueue({}, 50);
    // Sin contacto no entra; los demás, por prioridad (y, a igual prioridad, primero los celulares).
    // Secreti y Jan comparten número: entra solo Secreti, que tiene mejor prioridad.
    expect(fresh.map((p) => p.code)).toEqual(["moreta-ab3", "secreti-c4d", "lopez-j7k", "pirera-g6h"]);
    const todos = await outreach.listOutreach({ view: "todos", q: "Jan" });
    expect(todos.rows.find((p) => p.code === "jan-e5f")?.shared).toEqual([{ name: "Fernando A. Secreti", touched: false }]);
    expect((await outreach.outreachQueue({}, 2)).fresh).toHaveLength(2);
    expect((await outreach.outreachQueue({ zone: "Miramar" }, 50)).fresh.map((p) => p.code)).toEqual(["pirera-g6h"]);

    // Le escribimos a Secreti: Jan (mismo número) sale de la cola.
    expect(await actions.touchAction(form({ id: await id("secreti-c4d"), channel: "whatsapp" }))).toMatchObject({ ok: true });
    expect((await outreach.outreachQueue({}, 50)).fresh.map((p) => p.code)).toEqual(["moreta-ab3", "lopez-j7k", "pirera-g6h"]);
  });

  it("cada mensaje programa el seguimiento; a los tres toques se frena", async () => {
    const moreta = await id("moreta-ab3");
    const today = outreach.todayKey();
    await actions.touchAction(form({ id: moreta, channel: "whatsapp" }));
    let [row] = await sql`select status, touches, next_action_on, last_channel from sales_outreach where id = ${moreta}`;
    expect(row).toMatchObject({ status: "contactado", touches: 1, last_channel: "whatsapp" });
    const { nextFollowUp } = await import("@/lib/sales/outreach-messages");
    expect(row.next_action_on).toBe(nextFollowUp(today, 1));
    expect(await outreach.outreachStats()).toMatchObject({ today_new: 2, week_new: 2, contacted: 2, due_followups: 0 });

    // Llega el día del seguimiento: aparece en la cola y se le manda el segundo.
    await sql`update sales_outreach set next_action_on = ${today} where id = ${moreta}`;
    expect((await outreach.outreachQueue({}, 0)).followups.map((p) => p.code)).toEqual(["moreta-ab3"]);
    await actions.touchAction(form({ id: moreta, channel: "whatsapp" }));
    [row] = await sql`select touches, next_action_on from sales_outreach where id = ${moreta}`;
    expect(row).toEqual({ touches: 2, next_action_on: nextFollowUp(today, 2) });
    await actions.touchAction(form({ id: moreta, channel: "whatsapp" }));
    [row] = await sql`select touches, next_action_on from sales_outreach where id = ${moreta}`;
    expect(row).toEqual({ touches: 3, next_action_on: null });
    expect(await actions.touchAction(form({ id: moreta, channel: "whatsapp" }))).toMatchObject({ ok: false, message: expect.stringContaining("tres veces") });
    const stats = await outreach.outreachStats();
    expect(stats).toMatchObject({ today_new: 2, today_followups: 2 });

    // Una llamada queda en la historia sin gastar mensajes; «ya le había escrito» no suma a la meta de hoy.
    const pirera = await id("pirera-g6h");
    await actions.touchAction(form({ id: pirera, channel: "telefono" }));
    [row] = await sql`select status, touches from sales_outreach where id = ${pirera}`;
    expect(row).toEqual({ status: "contactado", touches: 0 });
    const lopez = await id("lopez-j7k");
    await actions.touchAction(form({ id: lopez, channel: "whatsapp", before: "1" }));
    [row] = await sql`select touches, next_action_on, (first_contact_at < now() - interval '6 days') as before from sales_outreach where id = ${lopez}`;
    expect(row).toEqual({ touches: 1, next_action_on: today, before: true });
    expect((await outreach.outreachStats()).today_new).toBe(3);
    const events = await outreach.outreachEvents(moreta);
    expect(events.map((e) => e.detail)).toEqual(["último", "seguimiento", "primero"]);
  });

  it("respondió, no le interesa y la baja (que vale también para las llamadas de Sofi)", async () => {
    const lopez = await id("lopez-j7k");
    expect(await actions.statusAction(form({ id: lopez, status: "respondio" }))).toMatchObject({ ok: true });
    expect((await outreach.listOutreach({ view: "interesados" })).rows.map((p) => p.code)).toContain("lopez-j7k");
    expect(await actions.statusAction(form({ id: lopez, status: "inventado" }))).toMatchObject({ ok: false });

    const pirera = await id("pirera-g6h");
    await actions.statusAction(form({ id: pirera, status: "baja" }));
    const [blocked] = await sql`select reason from sales_suppressions where phone = '+542291420128'`;
    expect(blocked.reason).toContain("prospección");
    expect(await actions.touchAction(form({ id: pirera, channel: "whatsapp" }))).toMatchObject({ ok: false, message: expect.stringContaining("no recibir") });
    const [row] = await sql`select next_action_on from sales_outreach where id = ${pirera}`;
    expect(row.next_action_on).toBeNull();
  });

  it("edita los datos con validación", async () => {
    const paula = await id("sinc-m8n");
    const base = { id: paula, name: "Paula Sin Contacto", greeting: "Paula", title: "Dra.", business_name: "Consultorio Paula", zone: "Mar del Plata", address: "Colón 2000", specialty: "Odontología", phone_kind: "movil", email: "", website: "", notes: "", next_action_on: "", priority: "3" };
    expect(await actions.updateOutreachAction(undefined, form({ ...base, phone: "12", instagram: "" }))).toMatchObject({ ok: false });
    expect(await actions.updateOutreachAction(undefined, form({ ...base, phone: "", instagram: "instagram.com/p/xyz" }))).toMatchObject({ ok: false });
    expect(await actions.updateOutreachAction(undefined, form({ ...base, phone: "0223 15 600-1234", instagram: "instagram.com/dra.paula.odonto" }))).toMatchObject({ ok: true });
    const [row] = await sql`select phone, phone_kind, instagram, title, priority from sales_outreach where id = ${paula}`;
    expect(row).toEqual({ phone: "+5492236001234", phone_kind: "movil", instagram: "dra.paula.odonto", title: "Dra.", priority: 3 });
    expect(await actions.noteAction(undefined, form({ id: paula, note: "Atiende martes y jueves" }))).toMatchObject({ ok: true });
    expect((await outreach.outreachEvents(paula))[0]).toMatchObject({ kind: "nota", detail: "Atiende martes y jueves" });
    // Con contacto cargado, vuelve a la cola.
    expect((await outreach.outreachQueue({}, 50)).fresh.map((p) => p.code)).toContain("sinc-m8n");
  });

  it("su link de demo registra que la abrió y que la probó, con su nombre como profesional", async () => {
    const pub = await outreach.publicOutreach("lopez-j7k");
    expect(pub).toEqual({ code: "lopez-j7k", name: "María Elvira López Sánchez", greeting: "María", title: "Dra.", business_name: "Consultorio Odontológico López", zone: "Mar del Plata", address: "Saavedra 3527", website: null });
    expect(await outreach.publicOutreach("NO VALE")).toBeNull();

    const abrir = (await import("@/app/api/p/[code]/route")).POST;
    const ctx = { params: Promise.resolve({ code: "lopez-j7k" }) };
    expect((await abrir(new Request("https://turnia.example/api/p/lopez-j7k", { method: "POST" }), ctx)).status).toBe(204);
    await abrir(new Request("https://turnia.example/api/p/lopez-j7k", { method: "POST" }), ctx);
    const lopez = await id("lopez-j7k");
    let [row] = await sql`select opens, opened_at is not null as opened from sales_outreach where id = ${lopez}`;
    expect(row).toEqual({ opens: 2, opened: true });
    expect((await outreach.outreachEvents(lopez)).filter((e) => e.kind === "abrio")).toHaveLength(1);

    // La página arma la demo sin web con su consultorio y su nombre.
    const page = (await import("@/app/(marketing)/p/[code]/page")).default;
    const html = renderToStaticMarkup(await page({ params: Promise.resolve({ code: "lopez-j7k" }), searchParams: Promise.resolve({}) }));
    expect(html).toContain("Hola María");
    expect(html).toContain("Demo para Consultorio Odontológico López");
    expect(html).toContain("con la Dra. María Elvira López Sánchez");
    expect(html).toContain("Soy Sofi, del Consultorio Odontológico López");

    // Empieza la demo desde su link (con el profesional): queda en su ficha y el seguimiento pasa a hoy.
    await sql`update messaging_settings set active_channel = 'pausado' where id`;
    await sql`update sales_outreach set status = 'contactado', next_action_on = '2030-01-01' where id = ${lopez}`;
    const iniciar = (await import("@/app/api/demo/iniciar/route")).POST;
    const res = await iniciar(
      new Request("https://turnia.example/api/demo/iniciar", {
        method: "POST",
        headers: { "x-real-ip": "190.1.1.9" },
        body: JSON.stringify({ nombre: "Consultorio Odontológico López", direccion: "Saavedra 3527, Mar del Plata", especialidad: "Odontología", profesional: "Dra. María Elvira López Sánchez", via: "navegador", ref: "lopez-j7k" }),
      }),
    );
    expect(res.status).toBe(200);
    const [session] = await sql`select manual_name, manual_professional, lead_id from demo_sessions order by created_at desc limit 1`;
    expect(session).toMatchObject({ manual_name: "Consultorio Odontológico López", manual_professional: "Dra. María Elvira López Sánchez" });
    const { manualProfile } = await import("@/lib/demo/profile");
    expect(manualProfile({ nombre: "X", direccion: null, especialidad: "Odontología", profesional: "Dra. López" }).profesionales).toEqual([
      { nombre: "Dra. López", especialidad: "Odontología", dias: [], bio: null },
    ]);
    // after(): la lectura de la demo (sin web, sin Claude) y el registro en la prospección.
    mocks.after.splice(0, 1);
    await runAfter();
    [row] = await sql`select demo_at is not null as demo, lead_id, next_action_on from sales_outreach where id = ${lopez}`;
    expect(row).toEqual({ demo: true, lead_id: session.lead_id, next_action_on: outreach.todayKey() });
    expect((await outreach.outreachEvents(lopez))[0].kind).toBe("demo");
  });

  it("muestra el panel: cola del día, ficha, importar y mensajes", async () => {
    const page = (await import("@/app/panel/(app)/prospeccion/page")).default;
    const html = renderToStaticMarkup(await page({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }));
    expect(html).toContain("Prospección");
    expect(html).toContain("Nuevos para hoy");
    const todos = renderToStaticMarkup(await page({ params: Promise.resolve({}), searchParams: Promise.resolve({ vista: "todos", q: "Moreta" }) }));
    expect(todos).toContain("Myriam Daniela Moreta");
    expect(todos).not.toContain("Fausto Rodrigo Jan");

    const detail = (await import("@/app/panel/(app)/prospeccion/[id]/page")).default;
    const ficha = renderToStaticMarkup(await detail({ params: Promise.resolve({ id: await id("jan-e5f") }), searchParams: Promise.resolve({}) }));
    expect(ficha).toContain("https://turnia.example/p/jan-e5f");
    expect(ficha).toContain("Mismo teléfono que Fernando A. Secreti (ya contactado)");
    // Comparte el número con un solo colega: el mensaje va a la persona, con su demo.
    expect(ficha).toContain("Hola Fausto, ¿cómo estás?");

    const mensajes = (await import("@/app/panel/(app)/prospeccion/mensajes/page")).default;
    expect(renderToStaticMarkup(await mensajes())).toContain("Mensajes y metas");
    expect(await actions.saveTemplatesAction(undefined, form({ daily_goal: "0", weekly_goal: "250" }))).toMatchObject({ ok: false });
    expect(await actions.saveTemplatesAction(undefined, form({ daily_goal: "40", weekly_goal: "200", whatsapp_1: "Hola {saludo}! {link}" }))).toMatchObject({ ok: true });
    const settings = await outreach.outreachSettings();
    expect(settings).toMatchObject({ daily_goal: 40, weekly_goal: 200 });
    expect(settings.templates.whatsapp_1).toBe("Hola {saludo}! {link}");
    const [stored] = await sql`select outreach_templates from sales_settings where id = 1`;
    expect(Object.keys(stored.outreach_templates)).toEqual(["whatsapp_1"]);

    const importar = (await import("@/app/panel/(app)/prospeccion/importar/page")).default;
    expect(renderToStaticMarkup(await importar())).toContain("Importar la lista");
  });
});
