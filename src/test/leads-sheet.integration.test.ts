import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Pedidos de demo → Google Sheets: la aplicación web de Apps Script de la planilla se simula. Cada
// pedido nuevo, cambio de estado y borrado se copia; si la planilla falla, el pedido igual queda.

const mocks = vi.hoisted(() => ({
  session: undefined as string | undefined,
  after: [] as Array<() => unknown>,
  posts: [] as Array<Record<string, unknown>>,
  reply: (body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body.accion === "probar" ? { ok: true, planilla: "Turnia · Pedidos de demo" } : { ok: true, cantidad: (body.pedidos as unknown[] | undefined)?.length ?? 0 }), {
      headers: { "content-type": "application/json" },
    }),
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
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => mocks.after.push(fn),
}));

const base = testDatabaseUrl();
const SHEET = "https://script.google.com/macros/s/AKfycbx_planilla_de_prueba_123456/exec";
const form = (data: Record<string, string>) => {
  const out = new FormData();
  for (const [key, value] of Object.entries(data)) out.set(key, value);
  return out;
};

describe.runIf(base)("pedidos de demo en Google Sheets", () => {
  let sql: typeof import("@/lib/db").sql;
  let sheet: typeof import("@/lib/leads-sheet");
  let sheetActions: typeof import("@/app/panel/(app)/demos/sheet-actions");
  let leadActions: typeof import("@/app/panel/(app)/demos/actions");
  let pedirDemo: typeof import("@/app/(marketing)/pedi-una-demo/actions").pedirDemo;
  const runAfter = async () => {
    for (const fn of mocks.after.splice(0)) await fn();
  };

  beforeAll(async () => {
    const url = await scratchDatabase(base!, "turnia_test_leads_sheet");
    await resetTestDatabase(url);
    for (const [key, value] of Object.entries({ DATABASE_URL: url, SESSION_SECRET: "test-session", AGENT_TOOLS_SECRET: "test-tools" })) vi.stubEnv(key, value);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const target = String(input instanceof Request ? input.url : input);
        if (target !== SHEET) throw new Error(`fetch inesperado: ${target}`);
        const body = JSON.parse(String(init?.body));
        mocks.posts.push(body);
        return mocks.reply(body);
      }),
    );
    ({ sql } = await import("@/lib/db"));
    sheet = await import("@/lib/leads-sheet");
    sheetActions = await import("@/app/panel/(app)/demos/sheet-actions");
    leadActions = await import("@/app/panel/(app)/demos/actions");
    ({ pedirDemo } = await import("@/app/(marketing)/pedi-una-demo/actions"));
    mocks.session = (await import("@/lib/session")).createSessionToken();
  }, 60000);

  afterAll(async () => {
    await (await import("@/lib/db")).closeDb();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    mocks.posts.length = 0;
    mocks.after.length = 0;
  });

  const pedir = () =>
    pedirDemo(undefined, form({ nombre: "Laura Gómez", email: "laura@clinica.com.ar", telefono: "11 5555-0000", organizacion: "Centro Médico Plaza", especialidad: "Odontología", tamano: "2 a 5", mensaje: "No damos abasto con el WhatsApp", origen: "pedi-una-demo" }));

  it("sin planilla conectada el formulario anda igual y no manda nada", async () => {
    expect(await pedir()).toEqual({ ok: true });
    await runAfter();
    expect(mocks.posts).toHaveLength(0);
  });

  it("conecta la planilla: valida la URL, prueba la clave y guarda el nombre", async () => {
    expect(await sheetActions.connectSheetAction(undefined, form({ url: "https://docs.google.com/spreadsheets/d/1btj/edit" }))).toMatchObject({ ok: false, message: expect.stringContaining("/exec") });
    expect(await sheetActions.connectSheetAction(undefined, form({ url: SHEET }))).toMatchObject({ ok: true, message: expect.stringContaining("Turnia · Pedidos de demo") });
    expect(mocks.posts).toEqual([{ clave: sheet.sheetKey(), accion: "probar" }]);
    expect(await sheet.sheetSettings()).toMatchObject({ url: SHEET, name: "Turnia · Pedidos de demo", error: null });
    // La clave sale del secreto de la sesión: estable y distinta del secreto.
    expect(sheet.sheetKey()).toHaveLength(32);
    expect(sheet.sheetKey()).not.toContain("test-session");
    expect(sheet.appsScriptCode(sheet.sheetKey())).toContain(`const CLAVE = "${sheet.sheetKey()}";`);
  });

  it("cada pedido nuevo se copia con sus datos, y los anteriores con «Copiar los pedidos que ya hay»", async () => {
    expect(await pedir()).toEqual({ ok: true });
    await runAfter();
    expect(mocks.posts).toHaveLength(1);
    expect(mocks.posts[0]).toMatchObject({ clave: sheet.sheetKey(), accion: "guardar" });
    const [fila] = mocks.posts[0].pedidos as Array<Record<string, string>>;
    expect(fila).toMatchObject({
      nombre: "Laura Gómez",
      email: "laura@clinica.com.ar",
      whatsapp: "11 5555-0000",
      consultorio: "Centro Médico Plaza",
      especialidad: "Odontología",
      profesionales: "2 a 5",
      mensaje: "No damos abasto con el WhatsApp",
      origen: "Formulario (pedi-una-demo)",
      estado: "Nuevo",
    });
    expect(Date.parse(fila.fecha)).not.toBeNaN();

    mocks.posts.length = 0;
    expect(await sheetActions.syncAllLeadsAction()).toMatchObject({ ok: true, message: "Listo: 2 pedidos copiados en la planilla." });
    expect((mocks.posts[0].pedidos as unknown[]).length).toBe(2);
  });

  it("los cambios de estado y los borrados del panel también llegan", async () => {
    const [lead] = await sql<Array<{ id: string }>>`select id from leads order by created_at desc limit 1`;
    expect(await leadActions.updateLead(undefined, form({ id: lead.id, status: "contactado", notes: "Llamar el lunes" }))).toMatchObject({ ok: true });
    await runAfter();
    expect((mocks.posts[0].pedidos as Array<Record<string, string>>)[0]).toMatchObject({ id: lead.id, estado: "Contactado", notas: "Llamar el lunes" });

    mocks.posts.length = 0;
    await leadActions.deleteLead(form({ id: lead.id }));
    await runAfter();
    expect(mocks.posts).toEqual([{ clave: sheet.sheetKey(), accion: "borrar", ids: [lead.id] }]);
  });

  it("si la planilla falla, el pedido queda y el error se ve en el panel", async () => {
    mocks.reply = () => new Response("<html>Iniciá sesión</html>", { headers: { "content-type": "text/html" } });
    expect(await pedir()).toEqual({ ok: true });
    await runAfter();
    const settings = await sheet.sheetSettings();
    expect(settings.error).toContain("Cualquier persona");
    expect((await sql`select count(*)::int as n from leads where email = 'laura@clinica.com.ar'`)[0].n).toBeGreaterThan(0);

    mocks.reply = () => new Response(JSON.stringify({ ok: false, error: "clave" }), { headers: { "content-type": "application/json" } });
    expect(await sheetActions.syncAllLeadsAction()).toMatchObject({ ok: false, message: expect.stringContaining("La clave no coincide") });

    const page = (await import("@/app/panel/(app)/demos/planilla/page")).default;
    const html = renderToStaticMarkup(await page());
    expect(html).toContain("Conectada con «Turnia · Pedidos de demo»");
    expect(html).toContain("La clave no coincide");
    expect(html).toContain("Extensiones → Apps Script");

    expect(await sheetActions.disconnectSheetAction()).toMatchObject({ ok: true });
    expect((await sheet.sheetSettings()).url).toBeNull();
  });
});
