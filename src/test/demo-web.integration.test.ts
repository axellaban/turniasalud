import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Demo «Probá con tu web» en el navegador: la web (o, si no tiene, el nombre del
// consultorio) en /probar-demo, lectura
// de la web en segundo plano y chat o voz con el agente desde la misma página,
// sin Telegram ni WhatsApp. ElevenLabs, Claude, el DNS y la web se simulan.

const mocks = vi.hoisted(() => ({
  notifyN8n: vi.fn(async () => {}),
  after: [] as Array<() => unknown>,
  session: undefined as string | undefined,
}));

// Borrar pedidos es del administrador: se simula su sesión.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "turnia_session" && mocks.session ? { value: mocks.session } : undefined), set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));

vi.mock("@/lib/n8n", () => ({ notifyN8n: mocks.notifyN8n }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => mocks.after.push(fn),
}));
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "200.45.1.10", family: 4 }] }));

const baseUrl = testDatabaseUrl();
const MAIN = "00000000-0000-4000-8000-000000000001";

const PROFILE = {
  nombre: "Consultorio Odontológico Norte",
  especialidad: "Odontología",
  descripcion: "Odontología integral.",
  direccion: "Aráoz 2879, Buenos Aires",
  telefono: null,
  horario_texto: null,
  horarios: [],
  coberturas: [],
  profesionales: [{ nombre: "Dra. Lara Fernández", especialidad: "Odontología", dias: [], bio: null }],
  prestaciones: [{ nombre: "Primera consulta", especialidad: "Odontología", duracion_min: 30, precio: null, indicaciones: null, primera_vez: true }],
  preguntas_frecuentes: "- Consultas por WhatsApp.",
  politicas: null,
};

const calls: string[] = [];
async function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  calls.push(url);
  const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
  if (url === "https://odontonorte.com.ar/") {
    return new Response("<html><head><title>Odonto Norte</title></head><body><p>Dra. Lara Fernández</p></body></html>", { headers: { "content-type": "text/html" } });
  }
  if (url.startsWith("https://api.anthropic.com/v1/messages")) {
    return json({
      id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5",
      content: [{ type: "text", text: JSON.stringify(PROFILE) }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
    });
  }
  if (url.startsWith("https://api.elevenlabs.io/v1/convai/conversation/get-signed-url")) return json({ signed_url: "wss://chat.test/firmado" });
  if (url.startsWith("https://api.elevenlabs.io/v1/convai/conversation/token")) return json({ token: "tok_voz" });
  // El agente ya deja arrancar el chat sin su saludo (se tocó «Crear / actualizar agente»).
  if (url.startsWith("https://api.elevenlabs.io/v1/convai/agents/")) {
    return json({ platform_settings: { overrides: { conversation_config_override: { agent: { first_message: true } } } } });
  }
  throw new Error(`fetch inesperado en el test: ${url}`);
}

describe.runIf(baseUrl)("Demo «Probá con tu web» en el navegador", () => {
  let sql: typeof import("@/lib/db").sql;
  let iniciar: typeof import("@/app/api/demo/iniciar/route").POST;
  let estado: typeof import("@/app/api/demo/web/[token]/route").GET;
  let conversar: typeof import("@/app/api/demo/web/[token]/route").POST;
  let token = "";

  const pedir = (body: unknown, ip = "190.1.1.1") =>
    iniciar(new Request("https://turnia.example/api/demo/iniciar", { method: "POST", body: JSON.stringify(body), headers: { "x-real-ip": ip } }));
  const ctx = (t: string) => ({ params: Promise.resolve({ token: t }) });
  const leer = async (t = token) => {
    const res = await estado(new Request(`https://turnia.example/api/demo/web/${t}`), ctx(t));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const hablar = (mode: string, t = token) =>
    conversar(new Request(`https://turnia.example/api/demo/web/${t}`, { method: "POST", body: JSON.stringify({ mode }) }), ctx(t));
  const runAfter = async () => {
    for (const fn of mocks.after.splice(0)) await fn();
  };

  beforeAll(async () => {
    const url = await scratchDatabase(baseUrl!, "turnia_test_demo_web");
    await resetTestDatabase(url);
    vi.stubEnv("DATABASE_URL", url);
    vi.stubEnv("AGENT_TOOLS_SECRET", "secreto-de-prueba");
    vi.stubEnv("ELEVENLABS_API_KEY", "clave-falsa");
    vi.stubEnv("ANTHROPIC_API_KEY", "clave-claude-falsa");
    vi.stubEnv("APP_URL", "https://turnia.example");
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
    ({ sql } = await import("@/lib/db"));
    // El chat está pausado (WAHA sin conectar): el navegador igual tiene que andar.
    await sql`update messaging_settings set active_channel = 'pausado' where id`;
    await sql`update clinics set elevenlabs_agent_id = 'agent_test' where id = ${MAIN}`;
    iniciar = (await import("@/app/api/demo/iniciar/route")).POST;
    ({ GET: estado, POST: conversar } = await import("@/app/api/demo/web/[token]/route"));
  }, 60000);

  afterAll(async () => {
    const { closeDb } = await import("@/lib/db");
    await closeDb();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    calls.length = 0;
    mocks.notifyN8n.mockClear();
  });

  it("pide la web o el nombre del consultorio antes de arrancar (el email no hace falta)", async () => {
    const vacio = await pedir({ via: "navegador" });
    expect(vacio.status).toBe(400);
    expect(((await vacio.json()) as { error: string }).error).toContain("su nombre");
    expect((await pedir({ website: "no es una web", via: "navegador" })).status).toBe(400);
    // Con el chat pausado, pedir Telegram o WhatsApp avisa que se pruebe en el navegador.
    const chat = await pedir({ website: "odontonorte.com.ar", via: "chat" });
    expect(chat.status).toBe(409);
    expect(((await chat.json()) as { error: string }).error).toContain("navegador");
  });

  it("crea la demo con su interesado y lee la web después de responder", async () => {
    const res = await pedir({ website: "odontonorte.com.ar", via: "navegador" });
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(url).toMatch(/^\/probar-demo\/sesion\/w_[A-Za-z0-9_-]{24}$/);
    token = url.split("/").pop()!;

    const [lead] = await sql`select name, email, phone, organization, source from leads where source = 'demo-web'`;
    expect(lead).toEqual({ name: "odontonorte.com.ar", email: null, phone: null, organization: "odontonorte.com.ar", source: "demo-web" });
    expect(mocks.notifyN8n).toHaveBeenCalledWith("lead.nuevo", expect.objectContaining({ lead: expect.objectContaining({ email: null, origen: "demo-web", web: "https://odontonorte.com.ar/" }) }));
    expect(await leer()).toEqual({ status: 200, body: { status: "analizando", website: "https://odontonorte.com.ar/" } });

    await runAfter();
    const { body } = await leer();
    expect(body).toMatchObject({
      status: "lista",
      clinic: { name: "Consultorio Odontológico Norte", agentName: "Sofi", specialty: "Odontología", address: "Aráoz 2879, Buenos Aires", professionals: ["Dra. Lara Fernández"], types: ["Primera consulta"] },
      remaining: 6,
    });
    // No se mandó nada por Telegram ni WhatsApp.
    expect(calls.every((c) => c.startsWith("https://odontonorte.com.ar") || c.startsWith("https://api.anthropic.com"))).toBe(true);
    const [lead2] = await sql`select organization, specialty from leads where source = 'demo-web'`;
    expect(lead2).toEqual({ organization: "Consultorio Odontológico Norte", specialty: "Odontología" });
  });

  it("da la credencial de chat o de voz con la clínica de la demo", async () => {
    const chat = await hablar("chat");
    expect(chat.status).toBe(200);
    const c = (await chat.json()) as { signedUrl: string; sinSaludo: boolean; userId: string; dynamicVariables: Record<string, string> };
    expect(c.signedUrl).toBe("wss://chat.test/firmado");
    expect(c.sinSaludo).toBe(true);
    expect(c.userId).toMatch(/^web:/);
    const [s] = await sql`select clinic_id, status, call_attempts from demo_sessions where call_token = ${token}`;
    expect(c.dynamicVariables.clinic_id).toBe(s.clinic_id);
    expect(c.dynamicVariables.clinic_id).not.toBe(MAIN);
    expect(s).toMatchObject({ status: "chat", call_attempts: 1 });

    const voz = await hablar("voz");
    expect(((await voz.json()) as { token: string }).token).toBe("tok_voz");
    expect((await hablar("otra")).status).toBe(400);
    expect((await hablar("chat", "w_" + "x".repeat(24))).status).toBe(404);
  });

  it("limita las conversaciones por demo, incluso en paralelo", async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => hablar("chat")));
    expect(responses.filter((r) => r.status === 200)).toHaveLength(4);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(4);
    expect((await leer()).body.remaining).toBe(0);
  });

  it("cambiar el canal de chat en el panel no corta las demos del navegador", async () => {
    const { selectMessagingChannel } = await import("@/lib/messaging-settings");
    await selectMessagingChannel("telegram");
    expect((await leer()).body.status).toBe("lista");
    await selectMessagingChannel("pausado");
  });

  it("si la web no se puede leer, la página lo dice", async () => {
    const res = await pedir({ website: "noexiste.com.ar", via: "navegador" });
    const t = ((await res.json()) as { url: string }).url.split("/").pop()!;
    await runAfter();
    expect((await leer(t)).body).toEqual({ status: "error", website: "https://noexiste.com.ar/" });
    expect((await hablar("chat", t)).status).toBe(404);
  });

  it("el administrador borra un pedido de prueba con sus demos, sin tocar fichas conservadas", async () => {
    const { deleteLead } = await import("@/app/panel/(app)/demos/actions");
    const [lead] = await sql`select id from leads where name = 'odontonorte.com.ar'`;
    const [s] = await sql`select clinic_id from demo_sessions where lead_id = ${lead.id} and clinic_id is not null`;
    // Una segunda demo del mismo interesado sobre una ficha conservada.
    const [kept] = await sql`insert into clinics (name, is_demo, retained_at) values ('Ficha conservada', true, now()) returning id`;
    await sql`insert into demo_sessions (phone, chat_id, website, lead_id, clinic_id) values ('web:k', 'web:k', 'https://x.test/', ${lead.id}, ${kept.id})`;
    const form = new FormData();
    form.set("id", lead.id);
    await expect(deleteLead(form)).rejects.toThrow("redirect:/panel/login");
    mocks.session = (await import("@/lib/session")).createSessionToken();
    await deleteLead(form);
    expect(await sql`select 1 from leads where id = ${lead.id}`).toHaveLength(0);
    expect(await sql`select 1 from demo_sessions where lead_id = ${lead.id}`).toHaveLength(0);
    expect(await sql`select 1 from clinics where id = ${s.clinic_id}`).toHaveLength(0);
    expect(await sql`select 1 from clinics where id = ${kept.id}`).toHaveLength(1);
    expect((await leer()).status).toBe(404);
  });

  it("sin web arma la demo con el nombre del consultorio, sin leer ninguna web", async () => {
    const manual = { nombre: "Consultorio Arroyo", direccion: "Córdoba 3380, Mar del Plata", especialidad: "Odontología" };
    const res = await pedir({ ...manual, via: "navegador" }, "190.3.3.3");
    expect(res.status).toBe(200);
    const t = ((await res.json()) as { url: string }).url.split("/").pop()!;
    expect((await leer(t)).body).toEqual({ status: "analizando", website: "", nombre: "Consultorio Arroyo" });
    await runAfter();
    expect(calls).toEqual([]);
    const { body } = await leer(t);
    expect(body).toMatchObject({
      status: "lista",
      nombre: "Consultorio Arroyo",
      clinic: { name: "Consultorio Arroyo", specialty: "Odontología", address: "Córdoba 3380, Mar del Plata", professionals: ["Equipo de Odontología"] },
    });
    expect((body.clinic as { types: string[] }).types).toContain("Limpieza dental");
    expect((await hablar("chat", t)).status).toBe(200);
    // Probarla de nuevo (aunque pida el chat) no duplica el pedido de demo.
    expect((await pedir({ ...manual, via: "chat" }, "190.3.3.3")).status).toBe(200);
    const leads = await sql`select name, email, organization from leads where source = 'demo-web' and name = 'Consultorio Arroyo'`;
    expect(leads).toEqual([{ name: "Consultorio Arroyo", email: null, organization: "Consultorio Arroyo" }]);
  });

  it("el email llega al pedido de demo aunque siga por Telegram", async () => {
    const { attachLeadEmail, claimDemoHandoff, createDemoHandoff } = await import("@/lib/demo/handoff");
    const handoff = (await createDemoHandoff("https://odontonorte.com.ar/", "190.2.2.2", "tg@consultorio.com"))!;
    expect(await claimDemoHandoff(handoff, "telegram:55")).toEqual({ website: "https://odontonorte.com.ar/", email: "tg@consultorio.com" });
    const [lead] = await sql`insert into leads (name, phone, source) values ('Telegram 55', 'telegram:55', 'demo-telegram') returning id`;
    await sql`insert into demo_sessions (phone, chat_id, website, lead_id) values ('telegram:55', 'telegram:55', 'https://odontonorte.com.ar/', ${lead.id})`;
    await attachLeadEmail("telegram:55", "tg@consultorio.com");
    const [row] = await sql`select email from leads where id = ${lead.id}`;
    expect(row.email).toBe("tg@consultorio.com");
  });
});
