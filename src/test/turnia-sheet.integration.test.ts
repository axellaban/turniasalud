import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// La planilla de Turnia en Google Sheets, con Google simulado: la conexión con un botón (OAuth con
// el permiso drive.file), la planilla que se crea en el Drive, la copia después de cada cambio, una
// copia por vez, y qué pasa si borran una pestaña o la planilla, o si Google pide reconectar.

const mocks = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  after: [] as Array<() => unknown>,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.cookies.has(name) ? { name, value: mocks.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void mocks.cookies.set(name, value),
    delete: (name: string) => void mocks.cookies.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => mocks.after.push(fn),
}));
vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn(async () => {}) }));

const base = testDatabaseUrl();
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const MAIN = "00000000-0000-4000-8000-000000000001";

type FakeSheet = { title: string; tabs: Map<string, unknown[][]> };
const google = {
  sheets: new Map<string, FakeSheet>(),
  calls: [] as Array<{ method: string; url: string; body: unknown }>,
  created: 0,
  revoked: false,
  refreshes: 0,
  hold: null as Promise<void> | null,
  /** Google Sheets API sin habilitar en el proyecto. */
  disabled: false,
};

/** 'Pedidos de demo'!A15:ZZ → ["Pedidos de demo", 15]. */
function parseRange(range: string): [string, number] {
  const m = /^'((?:[^']|'')+)'!A(\d+)(?::ZZ)?$/.exec(range);
  if (!m) throw new Error(`rango inesperado: ${range}`);
  return [m[1].replace(/''/g, "'"), Number(m[2])];
}

async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = init.method ?? "GET";
  const raw = typeof init.body === "string" ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : undefined;
  let body: unknown = raw;
  try {
    if (raw?.startsWith("{")) body = JSON.parse(raw);
  } catch {
    // texto
  }
  google.calls.push({ method, url, body });
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  if (url === "https://oauth2.googleapis.com/token") {
    const form = new URLSearchParams(raw);
    if (form.get("grant_type") === "authorization_code") {
      const scope = form.get("code") === "sin-drive" ? "openid email" : "openid email https://www.googleapis.com/auth/drive.file";
      return json({ access_token: "acceso-1", refresh_token: "permanente-1", expires_in: 3600, scope });
    }
    if (google.revoked) return json({ error: "invalid_grant" }, 400);
    google.refreshes++;
    return json({ access_token: `acceso-renovado-${google.refreshes}`, expires_in: 3600 });
  }
  if (url.startsWith("https://oauth2.googleapis.com/revoke")) return new Response(null, { status: 200 });
  if (url === "https://openidconnect.googleapis.com/v1/userinfo") return json({ email: "axel@turnia.test" });
  if (!url.startsWith(SHEETS)) throw new Error(`fetch inesperado: ${method} ${url}`);
  expect(new Headers(init.headers).get("authorization")).toMatch(/^Bearer acceso-/);
  if (google.disabled) {
    return json({ error: { code: 403, status: "PERMISSION_DENIED", message: "Google Sheets API has not been used in project 123 before or it is disabled." } }, 403);
  }

  if (url === SHEETS && method === "POST") {
    const req = body as { properties: { title: string }; sheets: Array<{ properties: { title: string }; data: Array<{ rowData: Array<{ values: Array<{ userEnteredValue: { stringValue: string } }> }> }> }> };
    const id = `planilla-${++google.created}`;
    google.sheets.set(id, {
      title: req.properties.title,
      tabs: new Map(req.sheets.map((s) => [s.properties.title, [s.data[0].rowData[0].values.map((v) => v.userEnteredValue.stringValue)]])),
    });
    return json({ spreadsheetId: id, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`, sheets: req.sheets.map((s) => ({ properties: s.properties })) });
  }
  const m = /^\/([^/:?]+)(.*)$/.exec(url.slice(SHEETS.length));
  const sheet = m && google.sheets.get(decodeURIComponent(m[1]));
  if (!m || !sheet) return json({ error: { code: 404, message: "Requested entity was not found." } }, 404);
  const rest = m[2];
  if (method === "GET") {
    return json({ spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${m[1]}/edit`, properties: { title: sheet.title }, sheets: [...sheet.tabs.keys()].map((title) => ({ properties: { title } })) });
  }
  if (rest === "/values:batchUpdate") {
    if (google.hold) await google.hold;
    const req = body as { valueInputOption: string; data: Array<{ range: string; values: unknown[][] }> };
    expect(req.valueInputOption).toBe("RAW");
    for (const d of req.data) {
      const [tab] = parseRange(d.range);
      if (!sheet.tabs.has(tab)) return json({ error: { code: 400, message: `Unable to parse range: ${d.range}` } }, 400);
    }
    for (const d of req.data) {
      const rows = sheet.tabs.get(parseRange(d.range)[0])!;
      d.values.forEach((row, i) => (rows[i] = row));
    }
    return json({ totalUpdatedRows: req.data.reduce((n, d) => n + d.values.length, 0) });
  }
  if (rest === "/values:batchClear") {
    for (const range of (body as { ranges: string[] }).ranges) {
      const [tab, from] = parseRange(range);
      sheet.tabs.get(tab)!.length = Math.min(sheet.tabs.get(tab)!.length, from - 1);
    }
    return json({});
  }
  if (rest === ":batchUpdate") {
    for (const r of (body as { requests: Array<{ addSheet: { properties: { title: string } } }> }).requests) sheet.tabs.set(r.addSheet.properties.title, []);
    return json({});
  }
  throw new Error(`ruta de Sheets inesperada: ${method} ${url}`);
}

const form = (data: Record<string, string>) => {
  const out = new FormData();
  for (const [key, value] of Object.entries(data)) out.set(key, value);
  return out;
};

const LIST = [
  "codigo,nombre,saludo,tratamiento,consultorio,zona,direccion,especialidad,telefono,tipo_telefono,prioridad",
  "moreta-ab3,Myriam Daniela Moreta,Myriam,Dra.,Consultorio Odontológico Moreta,Mar del Plata,Av Juan José Paso 2121,Ortodoncia,+5492236602433,movil,1",
  "arias-k2m,Rodrigo Arias,Rodrigo,Dr.,AB Consultorios Odontológicos,Mar del Plata,Av. Juan José Paso 2992,Endodoncia,223 562-7681,consultorio,1",
].join("\n");

describe.runIf(base)("planilla de Turnia en Google Sheets", () => {
  let sql: typeof import("@/lib/db").sql;
  let sheet: typeof import("@/lib/sheets/turnia-sheet");
  let connect: typeof import("@/app/api/google/conectar/route").GET;
  let callback: typeof import("@/app/api/google/callback/route").GET;
  let Page: typeof import("@/app/panel/(app)/prospeccion/planilla/page").default;
  const runAfter = async () => {
    for (const fn of mocks.after.splice(0)) await fn();
  };
  const tab = (name: string) => google.sheets.get("planilla-1")!.tabs.get(name)!;
  const page = async (google_?: string) => renderToStaticMarkup(await Page({ params: Promise.resolve({}), searchParams: Promise.resolve(google_ ? { google: google_ } : {}) }));
  const back = (r: Response) => new URL(r.headers.get("location")!);
  /** Conectar → Google → vuelta, como lo hace el navegador. */
  async function connectWith(code: string) {
    const res = await connect(new Request("https://turnia.example/api/google/conectar?para=planilla"));
    const auth = new URL(res.headers.get("location")!);
    mocks.cookies.set("turnia_google_oauth", /turnia_google_oauth=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")![1]);
    return { auth, res: await callback(new Request(`https://turnia.example/api/google/callback?code=${code}&state=${auth.searchParams.get("state")}`)) };
  }

  beforeAll(async () => {
    const url = await scratchDatabase(base!, "turnia_test_turnia_sheet");
    await resetTestDatabase(url);
    for (const [key, value] of Object.entries({ DATABASE_URL: url, SESSION_SECRET: "test-session", AGENT_TOOLS_SECRET: "test-tools", APP_URL: "https://turnia.example" })) vi.stubEnv(key, value);
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
    ({ sql } = await import("@/lib/db"));
    sheet = await import("@/lib/sheets/turnia-sheet");
    ({ GET: connect } = await import("@/app/api/google/conectar/route"));
    ({ GET: callback } = await import("@/app/api/google/callback/route"));
    Page = (await import("@/app/panel/(app)/prospeccion/planilla/page")).default;
    mocks.cookies.set("turnia_session", (await import("@/lib/session")).createSessionToken());
    const { importOutreach } = await import("@/lib/sales/outreach");
    const { parseOutreachImport } = await import("@/lib/sales/outreach-import");
    await importOutreach(parseOutreachImport(LIST).rows);
    await sql`insert into leads (name, email, phone, organization, source) values ('Laura Gómez', 'laura@clinica.com.ar', '11 5555-0000', 'Centro Médico Plaza', 'pedi-una-demo')`;
  }, 60000);

  afterAll(async () => {
    await (await import("@/lib/db")).closeDb();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    google.calls = [];
    mocks.after.length = 0;
  });

  it("sin las credenciales de Google, la página dice qué falta y no se puede conectar", async () => {
    const html = await page();
    expect(html).toContain("GOOGLE_CLIENT_ID");
    expect(html).toContain("https://turnia.example/api/google/callback");
    expect(html).not.toContain("Conectar con Google");
    expect(back(await connect(new Request("https://turnia.example/api/google/conectar?para=planilla"))).search).toBe("?google=sin-configurar");
    expect(await sheet.syncTurniaSheet()).toMatchObject({ ok: false });
    expect(google.calls).toHaveLength(0);
  });

  it("se conecta con un botón: pide solo la planilla de Turnia, la crea en su Drive y copia todo", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cliente.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secreto-google");
    expect(await page()).toContain("Conectar con Google");

    // Sin aceptar el permiso de la planilla, no se conecta.
    expect(back((await connectWith("sin-drive")).res).searchParams.get("google")).toBe("sin-permiso");
    // Sin la API habilitada en Google Cloud: la cuenta queda conectada y el panel dice qué falta.
    google.disabled = true;
    expect(back((await connectWith("codigo-ok")).res).searchParams.get("google")).toBe("sin-api");
    const sinApi = await page("sin-api");
    expect(sinApi).toContain("falta habilitar «Google Sheets API»");
    expect(sinApi).toContain("Crear la planilla");
    expect(sinApi).not.toContain("Abrir la planilla");
    google.disabled = false;

    const { auth, res } = await connectWith("codigo-ok");
    expect(auth.origin).toBe("https://accounts.google.com");
    // Solo el permiso de los archivos que crea Turnia: ni Calendar ni el resto del Drive.
    expect(auth.searchParams.get("scope")).toBe("openid email https://www.googleapis.com/auth/drive.file");
    expect(back(res).pathname).toBe("/panel/prospeccion/planilla");
    expect(back(res).searchParams.get("google")).toBe("conectado");

    const [conn] = await sql`select account_email, refresh_token, spreadsheet_id, spreadsheet_url, status, last_sync_at from sheets_connections where owner = 'turnia'`;
    expect(conn).toMatchObject({ account_email: "axel@turnia.test", spreadsheet_id: "planilla-1", status: "conectado" });
    expect(conn.refresh_token).not.toContain("permanente-1");
    expect(conn.last_sync_at).not.toBeNull();

    const created = google.calls.find((c) => c.url === SHEETS)!.body as { properties: { title: string; locale: string }; sheets: Array<{ properties: { title: string } }> };
    expect(created.properties).toMatchObject({ title: "Turnia · Prospección y pedidos de demo", locale: "es_AR" });
    expect(created.sheets.map((s) => s.properties.title)).toEqual(["Prospección", "Pedidos de demo"]);
    const prospeccion = tab("Prospección");
    expect(prospeccion).toHaveLength(3);
    expect(prospeccion[0].slice(0, 3)).toEqual(["Código", "Nombre", "Trato"]);
    const arias = prospeccion.find((r) => r[0] === "arias-k2m")!;
    expect(arias).toEqual(expect.arrayContaining(["Rodrigo Arias", "+54 9 223 562-7681", "Celular del consultorio", "Por contactar", "https://turnia.example/p/arias-k2m"]));
    expect(tab("Pedidos de demo")[1]).toEqual(expect.arrayContaining(["Laura Gómez", "laura@clinica.com.ar", "11 5555-0000", "Formulario (pedi-una-demo)", "Nuevo"]));

    const html = await page("conectado");
    expect(html).toContain("la planilla quedó conectada");
    expect(html).toContain("axel@turnia.test");
    expect(html).toContain("https://docs.google.com/spreadsheets/d/planilla-1/edit");
  });

  it("cada cambio se copia solo, después de responder", async () => {
    const actions = await import("@/app/panel/(app)/prospeccion/actions");
    const [{ id }] = await sql`select id from sales_outreach where code = 'moreta-ab3'`;
    await actions.touchAction(form({ id, channel: "whatsapp" }));
    expect(google.calls).toHaveLength(0);
    await runAfter();
    const moreta = tab("Prospección").find((r) => r[0] === "moreta-ab3")!;
    // El saludo sin link: contactada, sin toques todavía.
    expect(moreta[14]).toBe("Contactado");
    expect(moreta[15]).toBe(0);
    expect(moreta[16]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(moreta[19]).toBe("WhatsApp");

    // Abrió su demo (desde el link del mensaje) y un pedido nuevo del formulario.
    const abrir = (await import("@/app/api/p/[code]/route")).POST;
    await abrir(new Request("https://turnia.example/api/p/moreta-ab3", { method: "POST" }), { params: Promise.resolve({ code: "moreta-ab3" }) });
    const { pedirDemo } = await import("@/app/(marketing)/pedi-una-demo/actions");
    expect(await pedirDemo(undefined, form({ nombre: "Pablo Ruiz", email: "pablo@odonto.com.ar", organizacion: "Odonto Ruiz", origen: "pedi-una-demo" }))).toEqual({ ok: true });
    await runAfter();
    expect(tab("Prospección").find((r) => r[0] === "moreta-ab3")![21]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(tab("Pedidos de demo").map((r) => r[2])).toEqual(["Nombre", "Laura Gómez", "Pablo Ruiz"]);
  });

  it("una copia por vez: lo que cambia mientras se copia entra en la vuelta siguiente", async () => {
    let release!: () => void;
    google.hold = new Promise<void>((resolve) => (release = resolve));
    const first = sheet.syncTurniaSheet();
    await vi.waitFor(() => expect(google.calls.some((c) => c.url.endsWith("/values:batchUpdate"))).toBe(true));
    await sql`update sales_outreach set notes = 'Cambio mientras se copiaba', updated_at = now() where code = 'arias-k2m'`;
    // La segunda no escribe: deja el pedido y la primera vuelve a copiar.
    expect(await sheet.syncTurniaSheet()).toEqual({ ok: true });
    google.hold = null;
    release();
    expect(await first).toEqual({ ok: true });
    expect(google.calls.filter((c) => c.url.endsWith("/values:batchUpdate"))).toHaveLength(2);
    expect(tab("Prospección").find((r) => r[0] === "arias-k2m")).toContain("Cambio mientras se copiaba");
  });

  it("si borran una pestaña vuelve; si borran la planilla, se crea otra desde el panel", async () => {
    google.sheets.get("planilla-1")!.tabs.delete("Pedidos de demo");
    await sql`update sales_outreach set updated_at = now()`;
    expect(await sheet.syncTurniaSheet()).toEqual({ ok: true });
    expect(tab("Pedidos de demo")).toHaveLength(3);

    google.sheets.delete("planilla-1");
    expect(await sheet.syncTurniaSheet()).toMatchObject({ ok: false, error: expect.stringContaining("ya no existe") });
    const [conn] = await sql`select status from sheets_connections`;
    expect(conn.status).toBe("sin_planilla");
    expect(await page()).toContain("Crear una planilla nueva");
    // Mientras tanto, los cambios no golpean a Google.
    google.calls = [];
    await sheet.syncTurniaSheet();
    expect(google.calls).toHaveLength(0);

    const { recreateAction } = await import("@/app/panel/(app)/prospeccion/planilla/actions");
    expect(await recreateAction()).toMatchObject({ ok: true });
    const nueva = google.sheets.get("planilla-2")!;
    expect(nueva.tabs.get("Prospección")).toHaveLength(3);
    expect(nueva.tabs.get("Pedidos de demo")).toHaveLength(3);
  });

  it("si Google pide reconectar, el panel lo avisa; al reconectar sigue la misma planilla", async () => {
    google.revoked = true;
    await sql`update sheets_connections set access_expires_at = now() - interval '1 minute'`;
    expect(await sheet.syncTurniaSheet()).toMatchObject({ ok: false, error: "Google pidió volver a conectar la cuenta." });
    expect((await sql`select status from sheets_connections`)[0].status).toBe("reconectar");
    expect(await page()).toContain("Reconectar");

    google.revoked = false;
    const created = google.created;
    expect(back((await connectWith("codigo-ok")).res).searchParams.get("google")).toBe("conectado");
    expect(google.created).toBe(created);
    expect((await sql`select spreadsheet_id, status from sheets_connections`)[0]).toEqual({ spreadsheet_id: "planilla-2", status: "conectado" });
  });

  it("solo Axel la conecta; desconectar revoca el permiso y la planilla queda en su Drive", async () => {
    const [access] = await sql`insert into clinic_access (clinic_id, label, code_hash, code_hint) values (${MAIN}, 'Recepción', 'hash-de-prueba', '1234') returning id`;
    const admin = mocks.cookies.get("turnia_session")!;
    mocks.cookies.set("turnia_session", (await import("@/lib/session")).createClinicSessionToken(access.id));
    expect(back(await connect(new Request("https://turnia.example/api/google/conectar?para=planilla"))).pathname).toBe("/panel");
    mocks.cookies.set("turnia_session", admin);

    // Con la misma cuenta conectada a Calendar, no se revoca: Google cortaría también la agenda.
    const { disconnectAction } = await import("@/app/panel/(app)/prospeccion/planilla/actions");
    await sql`insert into calendar_connections (clinic_id, account_email, refresh_token) values (${MAIN}, 'axel@turnia.test', 'v1.a.b.c')`;
    expect(await disconnectAction()).toMatchObject({ ok: true });
    expect(google.calls.some((c) => c.url.startsWith("https://oauth2.googleapis.com/revoke"))).toBe(false);
    expect(await sql`select * from sheets_connections`).toHaveLength(0);
    await sql`delete from calendar_connections`;

    await connectWith("codigo-ok");
    google.calls = [];
    expect(await disconnectAction()).toMatchObject({ ok: true });
    expect(google.calls.some((c) => c.url.startsWith("https://oauth2.googleapis.com/revoke"))).toBe(true);
    expect(google.sheets.has("planilla-2")).toBe(true);
    expect(await page()).toContain("Conectar con Google");
  });
});
