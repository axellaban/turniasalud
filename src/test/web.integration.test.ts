import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Formulario "Pedí una demo" de la web pública contra un Postgres descartable.

const mocks = vi.hoisted(() => ({ notifyN8n: vi.fn(async () => {}) }));
vi.mock("@/lib/n8n", () => ({ notifyN8n: mocks.notifyN8n }));

const baseUrl = testDatabaseUrl();

function form(data: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
}

describe.runIf(baseUrl)("Pedí una demo", () => {
  let sql: typeof import("@/lib/db").sql;
  let pedirDemo: typeof import("@/app/(marketing)/pedi-una-demo/actions").pedirDemo;

  beforeAll(async () => {
    const url = await scratchDatabase(baseUrl!, "turnia_test_web");
    await resetTestDatabase(url);
    vi.stubEnv("DATABASE_URL", url);
    ({ sql } = await import("@/lib/db"));
    ({ pedirDemo } = await import("@/app/(marketing)/pedi-una-demo/actions"));
  }, 60000);

  afterAll(async () => {
    await sql.end();
    vi.unstubAllEnvs();
  });

  it("guarda el pedido y avisa a n8n", async () => {
    const res = await pedirDemo(undefined, form({ nombre: "Laura Gómez", email: "laura@clinica.com.ar", organizacion: "Centro Plaza", origen: "/pedi-una-demo" }));
    expect(res).toEqual({ ok: true });
    const rows = await sql`select name, email, organization, source from leads`;
    expect(rows).toEqual([{ name: "Laura Gómez", email: "laura@clinica.com.ar", organization: "Centro Plaza", source: "/pedi-una-demo" }]);
    expect(mocks.notifyN8n).toHaveBeenCalledWith("lead.nuevo", expect.objectContaining({ lead: expect.objectContaining({ email: "laura@clinica.com.ar" }) }));
  });

  it("valida el email y descarta bots sin guardar", async () => {
    expect((await pedirDemo(undefined, form({ nombre: "Ana", email: "no-es-email" }))).error).toBe("Revisá el email.");
    expect(await pedirDemo(undefined, form({ nombre: "Bot", email: "bot@spam.com", empresa_web: "x" }))).toEqual({ ok: true });
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from leads`;
    expect(n).toBe(1);
  });
});
