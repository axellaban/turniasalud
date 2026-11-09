import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Follow-up: cada persona de la prospección queda en la etapa del embudo de EMBUDO.md, «Ejecutar»
// arma el mensaje de la versión que le toca, confirmar lo registra como contacto de Prospección (o
// como nota en las etapas siguientes) y cada versión mide ejecuciones y conversiones.

const mocks = vi.hoisted(() => ({ session: undefined as string | undefined, capture: [] as Array<{ event: string; properties: Record<string, unknown> }> }));
vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn(async () => {}) }));
vi.mock("@/lib/analytics-server", () => ({ captureLater: (event: string, _id: string, properties: Record<string, unknown> = {}) => mocks.capture.push({ event, properties }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "turnia_session" && mocks.session ? { value: mocks.session } : undefined), set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); }, notFound: () => { throw new Error("notFound"); } }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/sheets/turnia-sheet", () => ({ queueTurniaSheetSync: () => {} }));

const base = testDatabaseUrl();

describe.runIf(base)("follow-up", () => {
  let sql: typeof import("@/lib/db").sql;
  let followup: typeof import("@/lib/sales/followup");
  let actions: typeof import("@/app/panel/(app)/follow-up/actions");
  const people: Record<string, string> = {};
  const stageOf = async (id: string) => (await followup.followupOverview()).find((s) => s.queue.some((q) => q.id === id))?.key ?? null;
  const stage = async (key: string) => (await followup.followupOverview()).find((s) => s.key === key)!;

  beforeAll(async () => {
    const url = await scratchDatabase(base!, "turnia_test_followup");
    await resetTestDatabase(url);
    for (const [key, value] of Object.entries({ DATABASE_URL: url, SESSION_SECRET: "test-session", AGENT_TOOLS_SECRET: "test-tools", ELEVENLABS_API_KEY: "fake", APP_URL: "https://turnia.example" })) vi.stubEnv(key, value);
    ({ sql } = await import("@/lib/db"));
    followup = await import("@/lib/sales/followup");
    actions = await import("@/app/panel/(app)/follow-up/actions");
    mocks.session = (await import("@/lib/session")).createSessionToken();
    for (const [code, name, greeting, phone, kind] of [
      ["moreta-ab3", "Myriam Moreta", "Myriam", "+5492236602433", "movil"],
      ["secreti-c4d", "Fernando Secreti", "Fernando", "+5492233046072", "movil"],
      ["pirera-g6h", "Oscar Pirera", "Oscar", "+542291420128", "fijo"],
      ["lopez-j7k", "María López", "María", "+5492236147600", "movil"],
    ] as const) {
      const [row] = await sql<Array<{ id: string }>>`
        insert into sales_outreach (code, name, greeting, title, phone, phone_kind, zone) values (${code}, ${name}, ${greeting}, 'Dra.', ${phone}, ${kind}, 'Mar del Plata') returning id`;
      people[code] = row.id;
    }
  }, 60000);

  afterAll(async () => {
    await (await import("@/lib/db")).closeDb();
    vi.unstubAllEnvs();
  });

  it("arranca con los textos de la secuencia activos y ubica a cada uno; el fijo sin respuesta no entra", async () => {
    const all = await followup.followupOverview();
    // Las cinco primeras etapas tienen la V2 de la secuencia del 09/11 (a la recepción); las de la cuenta, su V1.
    expect(all.map((s) => s.versions.map((v) => `${v.version}:${v.status}`))).toEqual([
      ...Array(5).fill(["1:archived", "2:active"]),
      ...Array(2).fill(["1:active"]),
    ]);
    const sinSaludo = all.find((s) => s.key === "sin-saludo")!;
    expect(sinSaludo.queue.map((q) => q.code).sort()).toEqual(["lopez-j7k", "moreta-ab3", "secreti-c4d"]);
    expect(await stageOf(people["pirera-g6h"])).toBeNull();
  });

  it("arma el saludo y, al confirmarlo, cuenta como el saludo de Prospección y la ejecución convierte", async () => {
    const id = people["moreta-ab3"];
    const p = await followup.prepareFollowup(id, "sin-saludo");
    expect(p).toMatchObject({ message: "Buenas! Hablo con la recepción de la Dra. Moreta?", ready: true, version: 2 });
    expect(p.whatsapp!.app).toBe(`https://wa.me/5492236602433?text=${encodeURIComponent("Buenas! Hablo con la recepción de la Dra. Moreta?")}`);
    await followup.markFollowup({ id, stage: "sin-saludo", versionId: p.versionId, status: "opened" });
    expect((await stage("sin-saludo")).queue.find((q) => q.id === id)!.execution!.status).toBe("opened");
    await followup.markFollowup({ id, stage: "sin-saludo", versionId: p.versionId, status: "sent" });
    const [row] = await sql`select greeted_at is not null as greeted, touches, status from sales_outreach where id = ${id}`;
    expect(row).toEqual({ greeted: true, touches: 0, status: "contactado" });
    expect(mocks.capture.map((c) => c.event)).toContain("prospect_greeting_sent");
    expect(await stageOf(id)).toBe("saludo-sin-demo");
    expect((await stage("sin-saludo")).versions.find((v) => v.status === "active")!.stats).toMatchObject({ executions: 1, conversions: 1, rate: 1 });
    // Ya no está en esa etapa: se avisa en vez de registrar dos veces.
    await expect(followup.markFollowup({ id, stage: "sin-saludo", versionId: p.versionId, status: "sent" })).rejects.toThrow(/Ya no está en «Sin saludar»: pasó a «Saludado, sin demo»/);
  });

  it("el Paso 2 pide permiso sin link y no suma un toque; la demo, con su link /p/<código>, suma el primero", async () => {
    const id = people["moreta-ab3"];
    const p = await followup.prepareFollowup(id, "saludo-sin-demo");
    expect(p.message).toMatch(/^Qué tal! Soy Axel\./);
    expect(p.message).not.toContain("https://");
    expect(p.links.demo).toBe("https://turnia.example/p/moreta-ab3");
    await followup.markFollowup({ id, stage: "saludo-sin-demo", versionId: p.versionId, status: "sent" });
    expect((await sql`select touches, permission_at is not null as asked from sales_outreach where id = ${id}`)[0]).toEqual({ touches: 0, asked: true });
    expect(await stageOf(id)).toBe("saludo-sin-demo");
    // El link (Paso 3 o Seguimiento 1) sale desde «Audios y mensajes»: ahí ya es uno de los tres.
    await (await import("@/lib/sales/outreach")).recordTouch(id, "whatsapp");
    expect((await sql`select touches from sales_outreach where id = ${id}`)[0].touches).toBe(1);
    expect(await stageOf(id)).toBe("demo-sin-abrir");
  });

  it("el Seguimiento 3 son dos mensajes: el chat se abre con el primero y el segundo se copia", async () => {
    const id = people["moreta-ab3"];
    await sql`update sales_outreach set opened_at = now(), lead_id = null where id = ${id}`;
    const [v] = await sql<Array<{ id: string }>>`select id from sales_followup_versions where stage = 'converso-sin-cuenta' and status = 'active'`;
    const body = (await sql`select body from sales_followup_versions where id = ${v.id}`)[0].body as string;
    const [first, second] = body.split("\n---\n");
    const { renderFollowup } = followup;
    const person = (await sql`select * from sales_outreach where id = ${id}`)[0] as unknown as Parameters<typeof renderFollowup>[1];
    expect(renderFollowup(second, person)).toMatch(/^Hola Doc! Nos armaron esta prueba gratis cargada con los datos del consultorio: https:\/\/turnia\.example\/p\/moreta-ab3 \./);
    expect(first).toMatch(/^Buenas! Para no robarte más tiempo/);
    await sql`update sales_outreach set opened_at = null where id = ${id}`;
  });

  it("con cuenta creada (acceso sin revocar) pasa a «Cuenta creada, sin actividad» y el envío queda como nota", async () => {
    const id = people["secreti-c4d"];
    const [clinic] = await sql<Array<{ id: string }>>`insert into clinics (name) values ('Consultorio Secreti') returning id`;
    await sql`update sales_outreach set status = 'respondio', touches = 1, greeted_at = now(), opened_at = now(), clinic_id = ${clinic.id} where id = ${id}`;
    await sql`insert into clinic_access (clinic_id, code_hash, code_hint) values (${clinic.id}, 'hash-secreti', 'ab')`;
    expect(await stageOf(id)).toBe("cuenta-sin-actividad");
    const p = await followup.prepareFollowup(id, "cuenta-sin-actividad");
    expect(p.message).toContain("https://turnia.example/panel");
    const done = await followup.markFollowup({ id, stage: "cuenta-sin-actividad", versionId: p.versionId, status: "sent" });
    expect(done.warning).toBeNull();
    const [note] = await sql`select kind, detail from sales_outreach_events where outreach_id = ${id} order by created_at desc limit 1`;
    expect(note).toEqual({ kind: "nota", detail: "Follow-up «Cuenta creada, sin actividad» V1: mensaje enviado por WhatsApp." });
    // Revocado el acceso, deja de contar como cuenta.
    await sql`update clinic_access set revoked_at = now() where clinic_id = ${clinic.id}`;
    expect(await stageOf(id)).toBe("abrio-sin-conversar");
  });

  it("«No se envió» pide motivo y no cuenta; los cerrados y las bajas salen de la lista", async () => {
    const id = people["lopez-j7k"];
    const p = await followup.prepareFollowup(id, "sin-saludo");
    await expect(followup.markFollowup({ id, stage: "sin-saludo", versionId: p.versionId, status: "failed" })).rejects.toThrow(/por qué no salió/);
    await followup.markFollowup({ id, stage: "sin-saludo", versionId: p.versionId, status: "failed", reason: "Número equivocado" });
    expect((await stage("sin-saludo")).versions.find((v) => v.status === "active")!.stats.executions).toBe(1);
    await sql`insert into sales_suppressions (phone, reason) values ('+5492236147600', 'baja')`;
    expect(await stageOf(id)).toBeNull();
  });

  it("versiones: una nueva activa archiva la anterior, la prueba reparte 50/50 y una guardada no se edita", async () => {
    expect(await actions.createFollowupVersionAction({ stage: "demo-sin-abrir", channel: "whatsapp", trigger: "", body: "Hola {apodo}", ctas: [], status: "active" })).toMatchObject({ ok: false });
    const v2 = await actions.createFollowupVersionAction({ stage: "demo-sin-abrir", channel: "whatsapp", trigger: "2 días", body: "Hola {saludo}, ¿viste la demo? {link}", ctas: ["whatsapp", "demo", "fax"], status: "active" });
    expect(v2).toMatchObject({ ok: true, data: { version: 3, status: "active", ctas: ["whatsapp", "demo"] } });
    const v3 = await actions.createFollowupVersionAction({ stage: "demo-sin-abrir", channel: "whatsapp", trigger: "", body: "Prueba {saludo}", ctas: ["whatsapp"], status: "test" });
    expect(v3).toMatchObject({ ok: true, data: { version: 4, status: "test" } });
    const statuses = async () => (await stage("demo-sin-abrir")).versions.map((v) => `${v.version}:${v.status}`);
    expect(await statuses()).toEqual(["1:archived", "2:archived", "3:active", "4:test"]);
    // A Moreta le toca una de las vigentes.
    expect(["3", "4"]).toContain(String((await followup.prepareFollowup(people["moreta-ab3"], "demo-sin-abrir")).version));
    const v2id = v2.ok ? v2.data.id : "";
    expect(await actions.setFollowupVersionStatusAction(v2id, "archived")).toEqual({ ok: false, message: "La versión activa no se archiva sola: activá otra primero." });
    await actions.setFollowupVersionStatusAction(v3.ok ? v3.data.id : "", "active");
    expect(await statuses()).toEqual(["1:archived", "2:archived", "3:archived", "4:active"]);
    await expect(sql`update sales_followup_versions set body = 'otro' where id = ${v2id}`).rejects.toThrow(/FOLLOWUP_VERSION_FROZEN/);
    await expect(sql`delete from sales_followup_versions where id = ${v2id}`).rejects.toThrow(/FOLLOWUP_VERSION_FROZEN/);
  });

  it("sin sesión del equipo no deja hacer nada", async () => {
    const saved = mocks.session;
    mocks.session = undefined;
    await expect(actions.prepareFollowupAction(people["moreta-ab3"], "demo-sin-abrir")).rejects.toThrow(/redirect/);
    mocks.session = saved;
  });
});
