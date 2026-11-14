import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Recuperar de ElevenLabs las conversaciones que no llegaron por el webhook post-call: se guardan una sola
// vez, en silencio (sin n8n ni pacientes), y no se tocan las que siguen en curso ni las llamadas de ventas.

const notify = vi.fn();
vi.mock("@/lib/n8n", () => ({ notifyN8n: (...args: unknown[]) => notify(...args) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: () => {} }));

const base = testDatabaseUrl();
const SECRET = "b".repeat(40);
const MAIN = "00000000-0000-4000-8000-000000000001";
const T = 1_762_400_000;
const detail = (id: string, extra: Record<string, unknown> = {}) => ({
  agent_id: "agent_main", conversation_id: id, status: "done",
  metadata: { start_time_unix_secs: T, call_duration_secs: 40 },
  transcript: [{ role: "agent", message: "¡Hola! Soy Sofi." }, { role: "user", message: "¿Atienden OSDE?" }],
  analysis: { transcript_summary: "Preguntó por OSDE." },
  conversation_initiation_client_data: { dynamic_variables: { clinic_id: MAIN } },
  ...extra,
});
const requests: string[] = [];
async function fakeElevenlabs(input: RequestInfo | URL) {
  const url = new URL(String(input));
  requests.push(url.pathname + url.search);
  if (url.pathname === "/v1/convai/conversations") {
    return Response.json({ conversations: [
      { conversation_id: "conv_old", status: "done" },
      { conversation_id: "conv_new", status: "done" },
      { conversation_id: "conv_live", status: "in-progress" },
      { conversation_id: "conv_sales", status: "done" },
    ], has_more: false });
  }
  if (url.pathname === "/v1/convai/conversations/conv_new") return Response.json(detail("conv_new"));
  if (url.pathname === "/v1/convai/conversations/conv_sales") return Response.json(detail("conv_sales", { conversation_initiation_client_data: { dynamic_variables: { sales_call_id: "x" } } }));
  return new Response("no", { status: 404 });
}

describe.runIf(base)("recuperar conversaciones de ElevenLabs", () => {
  let sql: typeof import("@/lib/db").sql;
  let route: typeof import("@/app/api/prospeccion/route");
  const run = async (desde: string) => {
    const res = await route.POST(new Request("https://turnia.example/api/prospeccion", {
      method: "POST", headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ by: "Chapa", followup: { op: "conversations-backfill", desde } }),
    }));
    return { status: res.status, body: (await res.json()) as { backfill: import("@/lib/conversations-backfill").BackfillReport } };
  };

  beforeAll(async () => {
    const url = await scratchDatabase(base!, "turnia_test_conv_backfill");
    await resetTestDatabase(url);
    for (const [k, v] of Object.entries({ DATABASE_URL: url, METRICS_SECRET: SECRET, APP_URL: "https://turnia.example", ELEVENLABS_API_KEY: "clave-falsa" })) vi.stubEnv(k, v);
    vi.stubGlobal("fetch", fakeElevenlabs);
    ({ sql } = await import("@/lib/db"));
    route = await import("@/app/api/prospeccion/route");
    await sql`update clinics set elevenlabs_agent_id = 'agent_main' where id = ${MAIN}`;
    await sql`insert into conversations (clinic_id, elevenlabs_conversation_id, channel, transcript) values (${MAIN}, 'conv_old', 'web', ${sql.json([{ role: "agent", message: "Hola" }])})`;
  }, 60000);

  afterAll(async () => {
    await (await import("@/lib/db")).closeDb();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("guarda solo las que faltan, en silencio, y una segunda corrida no repite nada", async () => {
    const { status, body } = await run("2025-11-05");
    expect(status).toBe(200);
    expect(body.backfill).toMatchObject({ agentes: 1, enElevenlabs: 4, yaEstaban: 1, recuperadas: 1, enCurso: 1, ventas: 1, errores: 0, incompleta: false });
    expect(requests[0]).toContain("agent_id=agent_main");
    expect(requests[0]).toContain(`call_start_after_unix=${Math.floor(Date.parse("2025-11-05") / 1000)}`);
    const [row] = await sql<Array<{ summary: string; transcript: Array<{ role: string; message: string }> }>>`
      select summary, transcript from conversations where elevenlabs_conversation_id = 'conv_new'`;
    expect(row.summary).toBe("Preguntó por OSDE.");
    expect(row.transcript.some((t) => t.role === "user" && t.message === "¿Atienden OSDE?")).toBe(true);
    expect(await sql`select 1 from conversations where elevenlabs_conversation_id in ('conv_live', 'conv_sales')`).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
    const again = await run("2025-11-05");
    expect(again.body.backfill).toMatchObject({ yaEstaban: 2, recuperadas: 0 });
    expect((await run("ayer")).status).toBe(400);
  });
});
