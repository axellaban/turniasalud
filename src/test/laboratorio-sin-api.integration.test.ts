import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { referenceCases } from "@/lib/lab/cases";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// REGLA (Axel, 28/11/2026; src/lib/lab/policy.ts): el Laboratorio de Sofi NUNCA usa la API de Anthropic ni
// de OpenAI con clave. Las simulaciones van por ElevenLabs y lo demás lo hace la suscripción de Claude Code
// o ChatGPT por /api/lab/evaluaciones. Si este test falla porque alguien volvió a prender la API, la
// respuesta correcta es volver a apagarla, no cambiar el test.

const url = testDatabaseUrl();

const el = vi.hoisted(() => ({ created: [] as Array<Record<string, unknown>>, runs: [] as Array<Record<string, unknown>> }));

// La pausa total (policy.ts) se levanta solo acá, para probar la lógica sin red.
vi.mock("@/lib/lab/policy", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/lab/policy")>()), labPaused: () => false }));

vi.mock("@/lib/elevenlabs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/elevenlabs")>()),
  elevenlabs: vi.fn(async (path: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (path === "/v1/convai/llm/list") return { llms: [{ llm: "claude-haiku-5-5" }] };
    if (path === "/v1/convai/agents/agent_lab") return { conversation_config: { agent: { prompt: { tool_ids: ["t1"] } } } };
    if (path.startsWith("/v1/convai/tools")) return { tools: [{ id: "t1", tool_config: { name: "consultar_disponibilidad" } }] };
    if (path === "/v1/convai/agent-testing/create") {
      el.created.push(body);
      return { id: `test_${el.created.length}` };
    }
    if (path === "/v1/convai/agents/agent_lab/run-tests") {
      el.runs.push(body);
      return { id: "inv_1" };
    }
    if (path === "/v1/convai/test-invocations/inv_1") {
      return {
        test_runs: el.created.map((_, i) => ({
          test_id: `test_${i + 1}`,
          status: "passed",
          agent_responses: [
            { role: "user", message: "Hola, ¿atienden por OSDE?" },
            { role: "agent", message: "Sí, atendemos por OSDE." },
          ],
        })),
      };
    }
    throw new Error(`ElevenLabs simulado: ${path}`);
  }),
}));

const TOKEN = `lab_${"e".repeat(48)}`;
const READ_ONLY = `lab_${"l".repeat(48)}`;
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

describe.runIf(url)("Laboratorio sin API: solo ElevenLabs y la suscripción", () => {
  let sql: typeof import("@/lib/db").sql;
  let runs: typeof import("@/lib/lab/runs");
  let route: typeof import("@/app/api/lab/evaluaciones/route");
  let clinic: import("@/lib/types").Clinic;
  let runId: string;
  let conversationId: string;
  const apiCalls: string[] = [];

  const call = (method: "GET" | "POST", token: string, body?: unknown) =>
    route[method](new Request("https://turnia.test/api/lab/evaluaciones", {
      method,
      headers: { "x-lab-token": token, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }));

  beforeAll(async () => {
    const db = await scratchDatabase(url!, "turnia_laboratorio_sin_api_test");
    await resetTestDatabase(db);
    // Con las claves cargadas, igual no se usan.
    for (const [k, v] of Object.entries({ DATABASE_URL: db, AGENT_TOOLS_SECRET: "s", SESSION_SECRET: "s", APP_URL: "https://turnia.test", ELEVENLABS_API_KEY: "x", ANTHROPIC_API_KEY: "sk-ant-no-se-usa", OPENAI_API_KEY: "sk-no-se-usa" })) vi.stubEnv(k, v);
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input instanceof Request ? input.url : input);
      if (/anthropic\.com|openai\.com/.test(u)) {
        apiCalls.push(u);
        throw new Error("Llamada a la API prohibida");
      }
      return realFetch(input, init);
    }));
    ({ sql } = await import("@/lib/db"));
    runs = await import("@/lib/lab/runs");
    route = await import("@/app/api/lab/evaluaciones/route");
    await sql`update clinics set is_demo = true`;
    [clinic] = await sql`
      insert into clinics (name, specialty, elevenlabs_agent_id, lab_enabled, created_at)
      values ('Consultorio Sin API', 'Odontología', 'agent_lab', true, now() - interval '10 years') returning *`;
    vi.stubEnv("DEFAULT_CLINIC_ID", clinic.id);
    await sql`insert into lab_access_tokens (token_hash, label, scope) values (${sha(TOKEN)}, 'evaluar', 'evaluar'), (${sha(READ_ONLY)}, 'lectura', 'lectura')`;
    const [conv] = await sql<Array<{ id: string }>>`
      insert into conversations (clinic_id, started_at, status, transcript) values (${clinic.id}, now() - interval '2 hours', 'done', ${sql.json([
        { role: "user", message: "Hola, soy de OSDE, mi celular es 223 555-1234" },
        { role: "agent", message: "Hola, gracias. ¿Qué día le queda bien?" },
        { role: "user", message: "El martes" },
      ])}) returning id`;
    conversationId = conv.id;
  }, 60000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    await sql?.end();
  });

  it("el candado está puesto: el juez y el simulador no crean un cliente de la API aunque haya clave", async () => {
    const { labApiAllowed, LabApiForbidden } = await import("@/lib/lab/policy");
    const judge = await import("@/lib/lab/judge");
    const simulator = await import("@/lib/lab/simulator");
    expect(labApiAllowed()).toBe(false);
    expect(judge.labJudgeConfigured()).toBe(false);
    await expect(judge.judgeSimulation({ scenario: "x", conditions: [], transcript: "x", clinicContext: "", criteria: [] })).rejects.toBeInstanceOf(LabApiForbidden);
    await expect(judge.judgeRealConversation({ transcript: "x", clinicContext: "", criteria: [] })).rejects.toBeInstanceOf(LabApiForbidden);
    await expect(simulator.simulateConversation({ prompt: "x", vars: {}, scenario: "x", mocks: {}, history: [] })).rejects.toBeInstanceOf(LabApiForbidden);
  });

  it("la batería va por ElevenLabs aunque pidan el simulador propio, y queda esperando a la suscripción", async () => {
    const cases = referenceCases().filter((c) => c.id === "precio-particular");
    runId = await runs.startRun({ clinic, kind: "bateria", label: "Batería", cases, repeat: 1, createdBy: "test", engine: "simulador" });
    expect((await runs.getRun(runId))?.engine).toBe("elevenlabs");
    expect(el.runs).toHaveLength(1);
    await runs.advanceRun(runId, 10_000);
    const run = await runs.advanceRun(runId, 10_000);
    expect(run?.status).toBe("puntuando");
    const results = await runs.runResults(runId);
    expect(results).toHaveLength(1);
    expect(results[0].judged).toBe(false);
    expect(results[0].error).toBeNull();
  });

  it("la cola pide una clave para evaluar; la de solo lectura no alcanza", async () => {
    expect((await call("GET", READ_ONLY)).status).toBe(401);
    expect((await call("GET", "corta")).status).toBe(401);
    const res = await call("GET", TOKEN);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.regla).toMatch(/prohibido usar la API/);
    expect(body.rubrica).toContain("seguridad");
    expect(body.simulaciones).toHaveLength(1);
    expect(body.simulaciones[0].condiciones[0]).toMatchObject({ numero: 1 });
    // La charla real va sin teléfonos.
    const real = body.charlas_reales.find((c: { conversacion: string }) => c.conversacion === conversationId);
    expect(real.charla).toContain("[número]");
    expect(real.charla).not.toContain("555");
  });

  it("carga lo que evaluó la suscripción, calcula el puntaje en el servidor y cierra la corrida", async () => {
    const pending = await (await call("GET", TOKEN)).json();
    const sim = pending.simulaciones[0];
    const dims = { seguridad: null, exactitud: 90, resolucion: 90, eficiencia: 90, trato: 90 };
    const res = await call("POST", TOKEN, {
      evaluador: "Claude Code",
      simulaciones: [{
        resultado: sim.resultado,
        condiciones: sim.condiciones.map((c: { numero: number }) => ({ numero: c.numero, cumple: true, motivo: "Bien." })),
        dimensiones: dims, falla_critica: false, motivo_critico: null, hallazgos: [], resumen: "Contestó bien.",
      }],
      charlas_reales: [{
        conversacion: conversationId, motivo: "agendar", situacion: "sin_agenda", dimensiones: dims, falla_critica: false, motivo_critico: null,
        hallazgos: [{ problema: "No ofreció un horario", cita: "¿Qué día le queda bien?", dimension: "resolucion", gravedad: "baja", mejora: "Ofrecer un horario." }],
        resumen: "Bien encaminada.",
      }],
      propuestas: [{ clinica: clinic.id, propuestas: [{ titulo: "Ofrecer un horario de una", nivel: "B", capa: "consultorio", dimension: "resolucion", por_que: "Pregunta el día en vez de ofrecer.", evidencia: [], reemplazar: null, por: null, texto: "Ofrecé un horario concreto." }] }],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, simulaciones: 1, charlas_reales: 1, propuestas: 1, corridas_cerradas: 1 });
    const run = await runs.getRun(runId);
    expect(run?.status).toBe("terminada");
    expect(Number(run?.score)).toBeGreaterThan(80);
    const [result] = await runs.runResults(runId);
    expect(result.judge_model).toBe("Claude Code (suscripción)");
    const [review] = await sql`select score, summary from lab_reviews where conversation_id = ${conversationId}`;
    expect(Number(review.score)).toBeGreaterThan(0);
    const [proposal] = await sql`select status, level from lab_proposals where clinic_id = ${clinic.id}`;
    expect(proposal).toMatchObject({ status: "pendiente", level: "C" });
    // Lo ya evaluado no se pisa.
    const again = await (await call("POST", TOKEN, { evaluador: "Claude Code", simulaciones: [{ resultado: sim.resultado, condiciones: [], dimensiones: dims, falla_critica: true, motivo_critico: "x", hallazgos: [], resumen: "x" }] })).json();
    expect(again.simulaciones).toBe(0);
    expect(again.errores[0]).toMatch(/ya estaba evaluado/);
  });

  it("desde el panel, sin clave: el pedido para pegar en el chat y la respuesta pegada", async () => {
    const external = await import("@/lib/lab/external");
    const second = await runs.startRun({ clinic, kind: "jugar", label: "Jugar", cases: referenceCases().filter((c) => c.id === "precio-particular"), repeat: 1, createdBy: "test" });
    // ElevenLabs devuelve la misma invocación simulada: la corrida nueva toma sus charlas.
    await sql`update lab_runs set invocation_id = 'inv_1', test_ids = (select test_ids from lab_runs where id = ${runId}) where id = ${second}`;
    await runs.advanceRun(second, 10_000);
    const work = await external.pendingWork({ clinicId: clinic.id, simulaciones: 8, reales: 4, propuestasSoloAlFinal: true });
    expect(work.simulaciones.map((x) => x.corrida)).toEqual([second]);
    expect(work.propuestas).toEqual([]);
    const prompt = external.subscriptionPrompt(work);
    expect(prompt).toContain(`resultado=${work.simulaciones[0].resultado}`);
    expect(prompt).toContain("RÚBRICA");
    expect(prompt).not.toContain("555");
    const answer = `Acá va:\n\`\`\`json\n${JSON.stringify({
      simulaciones: [{ resultado: work.simulaciones[0].resultado, condiciones: work.simulaciones[0].condiciones.map((c) => ({ numero: c.numero, cumple: true, motivo: "Bien." })), dimensiones: { seguridad: null, exactitud: 95, resolucion: 90, eficiencia: 90, trato: 90 }, falla_critica: false, motivo_critico: null, hallazgos: [], resumen: "Bien." }],
    })}\n\`\`\``;
    const result = await external.applyExternal({ ...(external.parseSubscriptionAnswer(answer) as object), evaluador: "ChatGPT" });
    expect(result).toMatchObject({ ok: true, simulaciones: 1, corridas_cerradas: 1 });
    expect((await runs.getRun(second))?.status).toBe("terminada");
    expect(() => external.parseSubscriptionAnswer("no tengo nada")).toThrow(/No encontré un JSON/);
  });

  it("rechaza lo que no tiene el formato", async () => {
    const res = await call("POST", TOKEN, { evaluador: "x" });
    expect(res.status).toBe(400);
  });

  it("en todo el recorrido no hubo ni una llamada a la API de Anthropic u OpenAI", () => {
    expect(apiCalls).toEqual([]);
  });
});
