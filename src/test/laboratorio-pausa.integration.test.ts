import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { referenceCases } from "@/lib/lab/cases";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// PAUSA TOTAL (Axel, 28/11/2026; src/lib/lab/policy.ts): el laboratorio no gasta ni ElevenLabs ni la API.
// Si este test falla porque alguien levantó la pausa sin la decisión escrita de Axel, se vuelve a pausar.

const url = testDatabaseUrl();
const elevenlabs = vi.hoisted(() => vi.fn(async () => { throw new Error("ElevenLabs no se llama en pausa"); }));
vi.mock("@/lib/elevenlabs", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/elevenlabs")>()), elevenlabs }));

describe.runIf(url)("Laboratorio en pausa", () => {
  let sql: typeof import("@/lib/db").sql;

  beforeAll(async () => {
    const db = await scratchDatabase(url!, "turnia_laboratorio_pausa_test");
    await resetTestDatabase(db);
    for (const [k, v] of Object.entries({ DATABASE_URL: db, ELEVENLABS_API_KEY: "x", ANTHROPIC_API_KEY: "sk-ant-no-se-usa" })) vi.stubEnv(k, v);
    ({ sql } = await import("@/lib/db"));
    await sql`update clinics set lab_enabled = true`;
  }, 60000);

  afterAll(async () => {
    await sql?.end();
  });

  it("la pausa está puesta", async () => {
    expect((await import("@/lib/lab/policy")).labPaused()).toBe(true);
  });

  it("el cron no hace nada y no se puede lanzar ninguna corrida", async () => {
    const { runLab } = await import("@/lib/lab/tick");
    expect(await runLab()).toEqual({ pausado: expect.stringMatching(/pausa/) });
    const runs = await import("@/lib/lab/runs");
    const [clinic] = await sql`select * from clinics limit 1`;
    await expect(runs.startRun({ clinic: clinic as never, kind: "bateria", label: "x", cases: referenceCases().slice(0, 1), repeat: 1, engine: "elevenlabs" })).rejects.toThrow(/pausa/);
    expect((await sql`select count(*)::int as n from lab_runs`)[0].n).toBe(0);
    expect(elevenlabs).not.toHaveBeenCalled();
  });
});
