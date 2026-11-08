import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// La cola de Follow-up operada desde Chapa Labs (/api/prospeccion), como la de habita.: lo que se
// puede ejecutar ahora, la toma de 10 minutos (dos personas no le escriben a la misma), la
// confirmación idempotente que registra el contacto en Prospección, la situación, reprogramar,
// prioridad, responsable, resultados por quien ejecutó y las filas leídas de la base.

vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn(async () => {}) }));
vi.mock("@/lib/analytics-server", () => ({ captureLater: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: () => {} }));

const base = testDatabaseUrl();
const SECRET = "q".repeat(40);
// Un martes a las 11 de Argentina: dentro del horario.
const TUESDAY = new Date("2026-11-10T14:00:00.000Z");

describe.runIf(base)("Follow-up de Turnia desde Chapa Labs", () => {
  let sql: typeof import("@/lib/db").sql;
  let route: typeof import("@/app/api/prospeccion/route");
  const ids: Record<string, string> = {};
  const post = async (body: unknown, auth = `Bearer ${SECRET}`) => {
    const res = await route.POST(new Request("https://turnia.example/api/prospeccion", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  const get = async (vista: string, auth = `Bearer ${SECRET}`) => {
    const res = await route.GET(new Request(`https://turnia.example/api/prospeccion?vista=${vista}`, { headers: { authorization: auth } }));
    return { status: res.status, body: await res.json() };
  };
  const op = (by: string, followup: Record<string, unknown>) => post({ by, followup });
  type Item = { id: string; code: string; stage: string; group: string; priority: string; blocked: string | null; owner: string | null; versionId: string; claim: { by: string } | null };
  const find = (list: Item[], code: string) => list.find((q) => q.code === code);

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TUESDAY);
    const url = await scratchDatabase(base!, "turnia_test_followup_queue");
    await resetTestDatabase(url);
    for (const [key, value] of Object.entries({ DATABASE_URL: url, METRICS_SECRET: SECRET, APP_URL: "https://turnia.example" })) vi.stubEnv(key, value);
    ({ sql } = await import("@/lib/db"));
    route = await import("@/app/api/prospeccion/route");
    for (const [code, name, phone, kind, signals] of [
      ["ana-111", "Ana Prueba", "+5492235000001", "movil", ""],
      ["beto-222", "Beto Prueba", "+5492235000002", "movil", "Hace Google Ads"],
      ["carla-333", "Carla Fija", "+542234000003", "fijo", ""],
    ] as const) {
      const [row] = await sql<Array<{ id: string }>>`
        insert into sales_outreach (code, name, greeting, phone, phone_kind, zone, signals) values (${code}, ${name}, ${name.split(" ")[0]}, ${phone}, ${kind}, 'Necochea', ${signals}) returning id`;
      ids[code] = row.id;
    }
  }, 60000);

  afterAll(async () => {
    vi.useRealTimers();
    await (await import("@/lib/db")).closeDb();
    vi.unstubAllEnvs();
  });

  it("sin la clave no responde", async () => {
    expect((await get("followup", "Bearer otra")).status).toBe(401);
    expect((await post({ by: "Facu", followup: { op: "queue" } }, "")).status).toBe(401);
  });

  it("la cola tiene a los que se pueden saludar, primero los que pagan anuncios; el fijo no entra", async () => {
    const { status, body } = await get("followup");
    expect(status).toBe(200);
    expect(body.queue.map((q: Item) => q.code)).toEqual(["beto-222", "ana-111"]);
    expect(find(body.queue, "ana-111")).toMatchObject({ stage: "sin-saludo", group: "nuevos", priority: "baja", blocked: null });
    expect(find(body.queue, "carla-333")).toBeUndefined();
    expect(body.funnel).toHaveLength(7);
    expect(body.rules[0]).toMatchObject({ stage: "sin-saludo", action: "Saludo" });
  });

  it("Facu toma a Ana: Axel no puede, y al pedir la próxima recibe a Beto", async () => {
    const facu = await op("Facu", { op: "claim", inmobiliaria: "ana-111" });
    expect(facu.status).toBe(200);
    expect(facu.body.message).toContain("Ana");
    expect(facu.body.whatsapp.web).toContain("5492235000001");
    const axel = await op("Axel", { op: "claim", inmobiliaria: ids["ana-111"] });
    expect(axel.status).toBe(409);
    expect(axel.body.error).toContain("Facu");
    const next = await op("Axel", { op: "claim" });
    expect(next.status).toBe(200);
    expect(next.body.item.code).toBe("beto-222");
    const { body } = await get("followup");
    expect(find(body.queue, "ana-111")!.claim).toMatchObject({ by: "Facu" });
    expect(body.summary.claimed).toBe(2);
  });

  it("Axel no puede confirmar el de Facu; Facu confirma una vez y queda registrado el saludo", async () => {
    const { body } = await get("followup");
    const ana = find(body.queue, "ana-111")!;
    const task = { op: "confirm", inmobiliaria: ana.id, etapa: "sin-saludo", version: ana.versionId };
    expect((await op("Axel", task)).status).toBe(409);
    const first = await op("Facu", task);
    expect(first.status).toBe(200);
    expect(first.body.execution.status).toBe("sent");
    const again = await op("Facu", task);
    expect(again.body.replayed).toBe(true);
    const [row] = await sql<Array<{ greeted_at: string | null; touches: number }>>`select greeted_at, touches from sales_outreach where id = ${ana.id}`;
    expect(row.greeted_at).not.toBeNull();
    expect(row.touches).toBe(0);
    const [ex] = await sql<Array<{ actor: string }>>`select actor from sales_followup_executions where outreach_id = ${ana.id}`;
    expect(ex.actor).toBe("Facu");
    expect(await sql`select 1 from sales_followup_claims where outreach_id = ${ana.id}`).toHaveLength(0);
    // Ya saludada: ahora espera la demo, con prioridad alta.
    const after = await get("followup");
    expect(find(after.body.queue, "ana-111")).toMatchObject({ stage: "saludo-sin-demo", group: "demos", priority: "alta" });
    expect(after.body.results.byActor).toEqual([expect.objectContaining({ actor: "Facu", executions: 1 })]);
  });

  it("una respuesta con rechazo cierra a Beto en Prospección y lo saca de la cola", async () => {
    await op("Axel", { op: "release", inmobiliaria: "beto-222" });
    const r = await op("Axel", { op: "reply", inmobiliaria: "beto-222", texto: "No gracias, ya tengo secretaria", clasificacion: "rechazo" });
    expect(r.status).toBe(200);
    const [row] = await sql<Array<{ status: string }>>`select status from sales_outreach where id = ${ids["beto-222"]}`;
    expect(row.status).toBe("no_interesa");
    const { body } = await get("followup");
    expect(find(body.queue, "beto-222")).toBeUndefined();
    expect(body.changes.map((c: { subject: string }) => c.subject)).toEqual(expect.arrayContaining(["reply", "situation"]));
  });

  it("reprogramar la saca hasta la fecha; volver la devuelve; prioridad y responsable quedan", async () => {
    const r = await op("Facu", { op: "snooze", inmobiliaria: "ana-111", hasta: "2026-11-12T12:00:00.000Z", motivo: "Vuelve el jueves" });
    expect(r.status).toBe(200);
    let { body } = await get("followup");
    expect(find(body.queue, "ana-111")).toBeUndefined();
    expect(find(body.blocked, "ana-111")!.blocked).toContain("Reprogramada");
    await op("Facu", { op: "snooze", inmobiliaria: "ana-111", volver: true });
    await op("Facu", { op: "priority", inmobiliaria: "ana-111", prioridad: "media" });
    await op("Facu", { op: "owner", inmobiliaria: "ana-111", responsable: "Axel" });
    ({ body } = await get("followup"));
    expect(find(body.queue, "ana-111")).toMatchObject({ priority: "media", owner: "Axel", blocked: null });
    expect((await op("Facu", { op: "priority", inmobiliaria: "ana-111", prioridad: "urgente" })).status).toBe(422);
  });

  it("las filas salen de la base, con las columnas de la planilla y la historia", async () => {
    const { status, body } = await get("filas");
    expect(status).toBe(200);
    expect(body.header[0]).toBe("Código");
    expect(body.rows).toHaveLength(3);
    const codes = body.rows.map((r: unknown[]) => r[0]);
    expect(codes).toEqual(expect.arrayContaining(["ana-111", "beto-222", "carla-333"]));
    expect(body.events).toEqual(expect.arrayContaining([expect.objectContaining({ id: "ana-111", type: "mensaje", template: "saludo" }), expect.objectContaining({ id: "beto-222", type: "perdido" })]));
  });

  it("una operación desconocida o sin persona es un error claro", async () => {
    expect((await op("Facu", { op: "borrar" })).status).toBe(422);
    expect((await op("Facu", { op: "situation", situacion: "interesado" })).status).toBe(422);
    expect((await op("Facu", { op: "claim", inmobiliaria: "nadie-999" })).status).toBe(422);
  });
});
