import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SYSTEM_PROMPT } from "@/lib/agent/prompt";
import { referenceCases } from "@/lib/lab/cases";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Laboratorio de Sofi de punta a punta, con ElevenLabs y Claude simulados: una batería, el puntaje, las
// propuestas, el experimento (actual contra variante), aprobar, quitar y rechazar, y la revisión de una
// charla real.

const url = testDatabaseUrl();

const el = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  runs: [] as Array<Record<string, unknown>>,
  invocations: new Map<string, { tests: string[]; repeat: number; prompt: string }>(),
}));

// La respuesta de Sofi en la simulación depende del prompt: la variante corrige el «hasta enero».
function sofiSays(caseId: string, prompt: string) {
  if (caseId === "profesional-mujer-tarde") {
    return prompt.includes("VARIANTE-LAB")
      ? [
          { role: "user", message: "Busco con una mujer, después de las 17" },
          { role: "agent", message: "", tool_calls: [{ request_id: "r1", tool_name: "consultar_disponibilidad", params_as_json: "{}" }] },
          { role: "agent", message: "", tool_results: [{ request_id: "r1", tool_name: "consultar_disponibilidad", result_value: '{"ok":true,"turnos":[]}', is_error: false }] },
          { role: "agent", message: "Busqué hasta el 11/12 y no encontré. ¿Busco más adelante o la anoto en la lista de espera?" },
        ]
      : [
          { role: "user", message: "Busco con una mujer, después de las 17" },
          { role: "agent", message: "No tengo turnos después de las 17 hasta mediados de enero. Quiere que la anote?" },
        ];
  }
  return [
    { role: "user", message: "¿Atienden por OSDE? ¿Y cuánto sale si no?" },
    { role: "agent", message: "Sí, atendemos por OSDE. La consulta particular sale $30.000." },
  ];
}

vi.mock("@/lib/elevenlabs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/elevenlabs")>()),
  elevenlabs: vi.fn(async (path: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (path === "/v1/convai/llm/list") return { llms: [{ llm: "claude-opus-5-5" }, { llm: "claude-haiku-5-5" }] };
    if (path === "/v1/convai/agents/agent_lab") return { conversation_config: { agent: { prompt: { tool_ids: ["t1", "t2", "t3"] } } } };
    if (path.startsWith("/v1/convai/tools")) {
      return { tools: [{ id: "t1", tool_config: { name: "consultar_disponibilidad" } }, { id: "t2", tool_config: { name: "reservar_turno" } }, { id: "t3", tool_config: { name: "registrar_paciente" } }] };
    }
    if (path === "/v1/convai/agent-testing/create") {
      el.created.push(body);
      return { id: `test_${el.created.length}` };
    }
    if (path === "/v1/convai/agents/agent_lab/run-tests") {
      el.runs.push(body);
      const id = `inv_${el.runs.length}`;
      el.invocations.set(id, { tests: body.tests.map((t: { test_id: string }) => t.test_id), repeat: body.repeat_count, prompt: body.agent_config_override.conversation_config.agent.prompt.prompt });
      return { id };
    }
    if (path.startsWith("/v1/convai/test-invocations/")) {
      const inv = el.invocations.get(path.split("/").pop() as string);
      if (!inv) throw new Error("invocación desconocida");
      const runs = [];
      for (const testId of inv.tests) {
        const created = el.created[Number(testId.replace("test_", "")) - 1];
        const caseId = String(created.name).split(" · ").pop() as string;
        for (let i = 0; i < inv.repeat; i++) runs.push({ test_id: testId, status: "passed", agent_responses: sofiSays(caseId, inv.prompt) });
      }
      return { test_runs: runs };
    }
    if (path.startsWith("/v1/convai/agent-testing/") && init.method === "DELETE") return {};
    if (path.startsWith("/v1/convai/conversations/")) {
      return {
        transcript: [
          { role: "user", message: "Hola, quiero un turno" },
          { role: "agent", message: "", tool_calls: [{ request_id: "a", tool_name: "consultar_disponibilidad", params_as_json: "{}" }] },
          { role: "agent", message: "", tool_results: [{ request_id: "a", tool_name: "consultar_disponibilidad", result_value: '{"ok":true}', is_error: false }] },
          { role: "agent", message: "¿Le sirve el martes 15/12 a las 10?" },
        ],
      };
    }
    throw new Error(`ElevenLabs simulado: ${path}`);
  }),
}));

vi.mock("@/lib/lab/judge", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/lab/judge")>();
  return {
    ...real,
    labJudgeConfigured: () => true,
    judgeSimulation: vi.fn(async (input: { conditions: Array<{ dim: string; text: string; critical?: boolean }>; transcript: string }) => {
      const bad = input.transcript.includes("mediados de enero");
      return {
        verdicts: input.conditions.map((c, i) => ({ dim: c.dim, text: c.text, critical: c.critical, pass: !(bad && i === 0), reason: bad && i === 0 ? "Dijo «hasta mediados de enero» sin buscar." : "Bien." })),
        judge: { seguridad: null, exactitud: bad ? 40 : 90, resolucion: 85, eficiencia: 85, trato: bad ? 70 : 95 },
        judgeCritical: false,
        criticalReason: null,
        findings: bad ? [{ problema: "Afirma que no hay turnos hasta enero sin haber buscado", cita: "hasta mediados de enero", dimension: "exactitud", gravedad: "alta", mejora: "Decir hasta qué fecha buscó." }] : [],
        summary: bad ? "Inventó el alcance de la búsqueda." : "Bien.",
      };
    }),
    judgeRealConversation: vi.fn(async () => ({
      intent: "agendar",
      situation: "mensajes_seguidos",
      judge: { seguridad: null, exactitud: 90, resolucion: 80, eficiencia: 90, trato: 100 },
      judgeCritical: false,
      criticalReason: null,
      findings: [{ problema: "No pidió los datos juntos", cita: "", dimension: "eficiencia", gravedad: "baja", mejora: "" }],
      summary: "Ofreció un turno.",
    })),
    draftCase: vi.fn(async () => ({
      titulo: "Caso armado para cobertura",
      motivo: "otro",
      situacion: "sin_agenda",
      paciente_nuevo: true,
      escenario: "Sos un paciente nuevo. Escribís: «Hola». Cuando te contesten, terminás la charla.",
      respuestas: [{ herramienta: "consultar_disponibilidad", respuesta_json: '{"ok":true,"turnos":[]}' }],
      condiciones: [{ texto: "El agente responde con el trato del consultorio.", dimension: "trato", critica: false }],
    })),
    proposeImprovements: vi.fn(async () => [
      {
        titulo: "Decir hasta qué fecha buscó",
        nivel: "B",
        capa: "prompt",
        dimension: "exactitud",
        por_que: "Afirma que no hay turnos más allá de lo que buscó.",
        evidencia: [{ cita: "hasta mediados de enero", fuente: "laboratorio: profesional-mujer-tarde" }],
        reemplazar: SYSTEM_PROMPT.slice(0, 40),
        por: `${SYSTEM_PROMPT.slice(0, 40)} VARIANTE-LAB`,
        texto: null,
      },
      {
        titulo: "Ofrecer primero al dueño del consultorio",
        nivel: "B",
        capa: "consultorio",
        dimension: "resolucion",
        por_que: "Regla del consultorio.",
        evidencia: [],
        reemplazar: null,
        por: null,
        texto: "Si el paciente no pide un profesional, ofrecé primero al Dr. Prueba.",
      },
    ]),
  };
});

vi.mock("@/lib/agent/setup", () => ({
  // «Actualizar a Sofi» sin ElevenLabs: registra la versión como lo hace el setup real.
  setupAgent: vi.fn(async () => {
    const lab = await import("@/lib/lab/prompt");
    await lab.recordPromptVersion(await lab.effectivePrompt());
    return { agentId: "agent_lab", created: false, voiceId: null, toolIds: [] };
  }),
}));

describe.runIf(url)("Laboratorio de Sofi", () => {
  let sql: typeof import("@/lib/db").sql;
  let runs: typeof import("@/lib/lab/runs");
  let proposals: typeof import("@/lib/lab/proposals");
  let clinic: import("@/lib/types").Clinic;
  let batteryId: string;

  beforeAll(async () => {
    const db = await scratchDatabase(url!, "turnia_laboratorio_test");
    await resetTestDatabase(db);
    for (const [k, v] of Object.entries({ DATABASE_URL: db, AGENT_TOOLS_SECRET: "s", SESSION_SECRET: "s", APP_URL: "https://turnia.test", ELEVENLABS_API_KEY: "x" })) vi.stubEnv(k, v);
    ({ sql } = await import("@/lib/db"));
    runs = await import("@/lib/lab/runs");
    proposals = await import("@/lib/lab/proposals");
    await sql`update clinics set is_demo = true`;
    [clinic] = await sql`
      insert into clinics (name, specialty, elevenlabs_agent_id, lab_enabled, agent_context, created_at)
      values ('Consultorio Lab', 'Odontología', 'agent_lab', true, '- Regla vieja.', now() - interval '10 years') returning *`;
    vi.stubEnv("DEFAULT_CLINIC_ID", clinic.id);
    const [{ id: pro }] = await sql`insert into professionals (clinic_id, full_name, specialty) values (${clinic.id}, 'Dr. Prueba', 'Odontología') returning id`;
    await sql`insert into schedules (professional_id, weekday, start_time, end_time) select ${pro}::uuid, d, '09:00', '18:00' from generate_series(1, 4) d`;
  }, 60000);

  afterAll(async () => {
    await sql?.end();
  });

  it("lanza la batería en ElevenLabs con las herramientas simuladas y el prompt efectivo", async () => {
    const cases = referenceCases().filter((c) => ["profesional-mujer-tarde", "precio-particular"].includes(c.id));
    batteryId = await runs.startRun({ clinic, kind: "bateria", label: "Batería de prueba", cases, repeat: 2, createdBy: "test" });
    const run = await runs.getRun(batteryId);
    expect(run?.status).toBe("corriendo");
    expect(el.created).toHaveLength(2);
    const woman = el.created.find((b) => String(b.name).endsWith("profesional-mujer-tarde")) as { tool_mock_overrides: Record<string, unknown>; tool_mock_config: { fallback_strategy: string }; dynamic_variables: Record<string, string> };
    expect(Object.keys(woman.tool_mock_overrides).sort()).toEqual(["t1", "t3"]);
    expect(woman.tool_mock_config.fallback_strategy).toBe("raise_error");
    expect(woman.dynamic_variables.clinic_name).toBe("Consultorio Lab");
    expect(el.runs[0].repeat_count).toBe(2);
    expect((el.runs[0] as { agent_config_override: { conversation_config: { agent: { prompt: { prompt: string } } } } }).agent_config_override.conversation_config.agent.prompt.prompt).toBe(SYSTEM_PROMPT);
    // El laboratorio responde con Haiku, sin tocar el modelo del agente real.
    expect((el.runs[0] as { agent_config_override: { conversation_config: { agent: { prompt: { llm: string } } } } }).agent_config_override.conversation_config.agent.prompt.llm).toBe("claude-haiku-5-5");
    expect((await runs.getRun(batteryId))?.agent_llm).toBe("claude-haiku-5-5");
  });

  it("trae las simulaciones, las puntúa y calcula el puntaje", async () => {
    const run = await runs.advanceRun(batteryId, 30_000);
    expect(run?.status).toBe("terminada");
    const results = await runs.runResults(batteryId);
    expect(results).toHaveLength(4);
    const woman = results.filter((r) => r.case_id === "profesional-mujer-tarde");
    const price = results.filter((r) => r.case_id === "precio-particular");
    expect(Number(woman[0].score)).toBeLessThan(Number(price[0].score));
    // Control automático: «no hay» sin buscar. La falta de «¿» no cuenta (estilo elegido para WhatsApp).
    expect(woman[0].checks?.filter((c) => !c.pass).map((c) => c.dim)).toEqual(["exactitud"]);
    expect(Number(run?.score)).toBeGreaterThan(0);
    expect(run?.dims?.exactitud).not.toBeNull();
    expect(el.invocations.size).toBe(1);
  });

  it("propone mejoras y prueba sola la de prompt contra la versión actual", async () => {
    const n = await proposals.generateProposals(clinic, { actor: "test" });
    expect(n).toBe(2);
    const [prompt] = await sql<Array<{ id: string; status: string; experiment_run_id: string; level: string }>>`select * from lab_proposals where layer = 'prompt'`;
    const [rule] = await sql<Array<{ level: string; status: string }>>`select * from lab_proposals where layer = 'consultorio'`;
    expect(rule.level).toBe("C");
    expect(prompt.status).toBe("probando");
    const variant = await runs.getRun(prompt.experiment_run_id);
    expect(variant?.baseline_run_id).toBe(batteryId);
    expect(variant?.prompt_override).toContain("VARIANTE-LAB");
    await runs.advanceRun(prompt.experiment_run_id, 30_000);
    const [after] = await sql<Array<{ status: string }>>`select status from lab_proposals where id = ${prompt.id}`;
    expect(after.status).toBe("pendiente");
    const summary = await proposals.experimentSummary(prompt.experiment_run_id);
    expect(summary.ready).toBe(true);
    expect(summary.delta).toBeGreaterThan(0);
    expect(summary.regressions).toBe(0);
  });

  it("aprobar una mejora de prompt la publica en Sofi y queda registrada la versión", async () => {
    const [p] = await sql<Array<{ id: string }>>`select id from lab_proposals where layer = 'prompt'`;
    await proposals.approveProposal(p.id, "test");
    const [after] = await sql<Array<{ status: string }>>`select status from lab_proposals where id = ${p.id}`;
    expect(after.status).toBe("aplicada");
    const { effectivePrompt, versionAt } = await import("@/lib/lab/prompt");
    expect((await effectivePrompt()).prompt).toContain("VARIANTE-LAB");
    expect(await versionAt(new Date())).toBe((await effectivePrompt()).hash);
    await proposals.revertProposal(p.id, "test");
    expect((await effectivePrompt()).prompt).toBe(SYSTEM_PROMPT);
  });

  it("una regla del consultorio necesita la confirmación y se suma a sus instrucciones", async () => {
    const [p] = await sql<Array<{ id: string }>>`select id from lab_proposals where layer = 'consultorio'`;
    await expect(proposals.approveProposal(p.id, "test")).rejects.toThrow(/confirmá/);
    await proposals.approveProposal(p.id, "test", { clinicConfirmed: true });
    const [c] = await sql<Array<{ agent_context: string; context_revision: number }>>`select agent_context, context_revision from clinics where id = ${clinic.id}`;
    expect(c.agent_context).toBe("- Regla vieja.\n- Si el paciente no pide un profesional, ofrecé primero al Dr. Prueba.");
    expect(c.context_revision).toBeGreaterThan(clinic.context_revision ?? 0);
    await proposals.revertProposal(p.id, "test");
    const [back] = await sql<Array<{ agent_context: string }>>`select agent_context from clinics where id = ${clinic.id}`;
    expect(back.agent_context).toBe("- Regla vieja.");
  });

  it("rechazar pide el motivo y lo guarda como criterio", async () => {
    const [p] = await sql<Array<{ id: string; title: string }>>`
      insert into lab_proposals (clinic_id, level, layer, title, why) values (${clinic.id}, 'A', 'prompt', 'Algo que no queremos', 'x') returning id, title`;
    await expect(proposals.rejectProposal(p.id, "test", " ")).rejects.toThrow(/por qué/);
    await proposals.rejectProposal(p.id, "test", "En este consultorio se hace distinto.");
    const [criterion] = await sql<Array<{ text: string }>>`select text from lab_criteria where proposal_id = ${p.id}`;
    expect(criterion.text).toContain("Algo que no queremos");
  });

  it("revisa las charlas reales cerradas y las cuenta en el resumen", async () => {
    await sql`
      insert into conversations (clinic_id, elevenlabs_conversation_id, channel, started_at, status, transcript, intent)
      values (${clinic.id}, 'conv_real_1', 'whatsapp', now() - interval '2 hours', 'done',
        ${sql.json([{ role: "user", message: "Hola" }, { role: "agent", message: "Hola, ¿en qué le ayudo?" }, { role: "user", message: "Un turno" }])}, 'agendar')`;
    const { reviewRecentConversations } = await import("@/lib/lab/reviews");
    expect(await reviewRecentConversations(30_000)).toBe(1);
    const [review] = await sql<Array<{ score: string; intent: string; situation: string; error: string | null }>>`select * from lab_reviews`;
    expect(review.error).toBeNull();
    expect(review.intent).toBe("agendar");
    expect(Number(review.score)).toBeGreaterThan(80);
    const { labOverview, labCoverage } = await import("@/lib/lab/panel");
    const overview = await labOverview(clinic.id);
    expect(overview.real.count).toBe(1);
    expect(overview.latest?.id).toBe(batteryId);
    const coverage = await labCoverage(clinic.id);
    expect(coverage.reviewed).toBe(1);
    expect(coverage.coverage).toBe(0);
    expect(coverage.uncoveredWithReal[0]).toMatchObject({ intent: "agendar", situation: "mensajes_seguidos", real: 1 });
    const { digestText } = await import("@/lib/lab/tick");
    const text = await digestText(clinic);
    expect(text).toContain("Laboratorio de Sofi · Consultorio Lab");
    expect(text).toContain("Charlas reales, últimos 7 días");
  });

  it("el informe para revisar afuera pide su propia clave y devuelve la corrida", async () => {
    const { GET } = await import("@/app/api/lab/informe/route");
    const { createHash } = await import("node:crypto");
    await sql`insert into lab_access_tokens (token_hash, label) values (${createHash("sha256").update("clave-de-informe-de-prueba-123456").digest("hex")}, 'test')`;
    expect((await GET(new Request("https://turnia.test/api/lab/informe"))).status).toBe(401);
    expect((await GET(new Request("https://turnia.test/api/lab/informe", { headers: { "x-lab-token": "otra" } }))).status).toBe(401);
    const list = await (await GET(new Request("https://turnia.test/api/lab/informe", { headers: { "x-lab-token": "clave-de-informe-de-prueba-123456" } }))).json();
    expect(list.corridas.length).toBeGreaterThan(0);
    const one = await (await GET(new Request(`https://turnia.test/api/lab/informe?corrida=${batteryId}`, { headers: { "x-lab-token": "clave-de-informe-de-prueba-123456" } }))).json();
    expect(one.resultados).toHaveLength(4);
  });

  it("al terminar una batería quedan pedidas las propuestas", async () => {
    const [c] = await sql<Array<{ lab_settings: { proposals_due?: boolean } }>>`select lab_settings from clinics where id = ${clinic.id}`;
    expect(c.lab_settings.proposals_due).toBe(true);
  });

  it("completa la cobertura con casos para los tipos que faltan", async () => {
    const { missingCells, fillCoverage } = await import("@/lib/lab/coverage");
    const before = await missingCells(clinic.id);
    expect(before.length).toBeGreaterThan(5);
    // Primero los que ya aparecen en charlas reales.
    expect(before[0]).toMatchObject({ intent: "agendar", situation: "mensajes_seguidos", real: 1 });
    const titles = await fillCoverage(clinic, 2, 30_000);
    expect(titles).toHaveLength(2);
    const after = await missingCells(clinic.id);
    expect(after.length).toBe(before.length - 2);
    const [saved] = await sql<Array<{ source: string; intent: string }>>`select source, intent from lab_cases order by created_at desc limit 1`;
    expect(saved.source).toBe("exploratorio");
  });

  it("encuentra la charla de donde sale la cita de una propuesta", async () => {
    const { findEvidence } = await import("@/lib/lab/panel");
    const link = await findEvidence(clinic.id, "«No tengo turnos después de las 17 hasta mediados de enero»");
    expect(link).toMatchObject({ kind: "laboratorio", case_id: "profesional-mujer-tarde" });
    expect(await findEvidence(clinic.id, "una frase que no está en ninguna charla")).toBeNull();
  });
});
