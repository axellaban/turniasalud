import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

const mocks = vi.hoisted(() => ({ calls: [] as Array<{ path: string; method: string; body: Record<string, unknown> }>, nextAgent: 0, nextTool: 0, voiceAgents: [] as string[] }));
vi.mock("@/lib/elevenlabs", () => ({
  agentVoiceId: async (agentId: string) => { mocks.voiceAgents.push(agentId); return "voice-sofi"; },
  elevenlabs: async (path: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : {};
    mocks.calls.push({ path, method, body });
    if (path === "/v1/convai/tools" && method === "GET") return { tools: [], has_more: false };
    if (path === "/v1/convai/tools") return { id: `tool-${++mocks.nextTool}` };
    if (path === "/v1/convai/agents/create") return { agent_id: `agent-own-${++mocks.nextAgent}` };
    if (path.startsWith("/v1/convai/agents/") && method === "PATCH") return {};
    throw new Error(`API no prevista: ${method} ${path}`);
  },
}));

const base = testDatabaseUrl();
const MAIN = "00000000-0000-4000-8000-000000000001";
describe.runIf(base)("agentes y llamadas exclusivos de cada clínica", () => {
  let sql: typeof import("@/lib/db").sql;
  let lib: typeof import("@/lib/clinic");
  let setup: typeof import("@/lib/agent/setup").setupAgent;
  let a: string;
  let b: string;
  beforeAll(async () => {
    const url = await scratchDatabase(base!, "turnia_test_inbound_voice");
    await resetTestDatabase(url);
    for (const [key, value] of Object.entries({ DATABASE_URL: url, APP_URL: "https://turnia.test", AGENT_TOOLS_SECRET: "test-tools", ELEVENLABS_API_KEY: "fake", ELEVENLABS_VOICE_ID: "voice-static-moderated" })) vi.stubEnv(key, value);
    ({ sql } = await import("@/lib/db"));
    lib = await import("@/lib/clinic");
    ({ setupAgent: setup } = await import("@/lib/agent/setup"));
  }, 60000);
  beforeEach(async () => {
    mocks.calls = []; mocks.nextAgent = 0; mocks.nextTool = 0; mocks.voiceAgents = [];
    vi.stubEnv("WAHA_CONNECTIONS", "[]");
    await sql`delete from clinics where is_demo`;
    await sql`update clinics set elevenlabs_agent_id = 'agent-main' where id = ${MAIN}`;
    [a, b] = (await sql`insert into clinics (name, is_demo, retained_at, elevenlabs_agent_id) values
      ('Guerra–Mininni', true, now(), 'agent-mininni'), ('Clínica Beta', true, now(), 'agent-beta') returning id`).map((r) => r.id);
  });
  afterAll(async () => { await (await import("@/lib/db")).closeDb(); vi.unstubAllEnvs(); });

  it("resuelve cada agente y rechaza desconocidos o IDs compartidos sin usar la clínica principal", async () => {
    expect((await lib.resolveInboundClinic({ agentId: "agent-mininni" })).id).toBe(a);
    expect((await lib.resolveInboundClinic({ agentId: "agent-beta" })).id).toBe(b);
    await expect(lib.resolveInboundClinic({ agentId: "no-existe" })).rejects.toBeInstanceOf(lib.InboundClinicError);
    await sql`update clinics set elevenlabs_agent_id = 'agent-mininni' where id = ${b}`;
    await expect(lib.resolveInboundClinic({ agentId: "agent-mininni" })).rejects.toBeInstanceOf(lib.InboundClinicError);
  });
  it("rechaza un número público asignado a otra clínica y admite el número técnico del desvío con su agente exclusivo", async () => {
    vi.stubEnv("WAHA_CONNECTIONS", JSON.stringify([{ id: "mininni", clinicId: a, phone: "5491172433765", url: "https://waha.test", apiKey: "key-test-12345678", webhookHmac: "hmac-test-12345678", revision: 1 }]));
    expect((await lib.resolveInboundClinic({ agentId: "agent-mininni", calledNumber: "+54 9 11 7243-3765" })).id).toBe(a);
    await expect(lib.resolveInboundClinic({ agentId: "agent-beta", calledNumber: "+5491172433765" })).rejects.toBeInstanceOf(lib.InboundClinicError);
    expect((await lib.resolveInboundClinic({ agentId: "agent-mininni", calledNumber: "+541155550001" })).id).toBe(a);
    await sql`update clinics set whatsapp_phone_number_id = 'meta-beta' where id = ${b}`;
    await expect(lib.resolveInboundClinic({ agentId: "agent-mininni", calledNumber: "meta-beta" })).rejects.toBeInstanceOf(lib.InboundClinicError);
  });
  it("mantiene separados los datos del mismo teléfono en dos clínicas", async () => {
    await sql`insert into patients (clinic_id, phone, full_name) values (${a}, '5491155550001', 'Paciente Mininni'), (${b}, '5491155550001', 'Paciente Beta')`;
    const va = await lib.buildDynamicVariables(await lib.resolveInboundClinic({ agentId: "agent-mininni" }), "5491155550001");
    const vb = await lib.buildDynamicVariables(await lib.resolveInboundClinic({ agentId: "agent-beta" }), "5491155550001");
    expect(va).toMatchObject({ clinic_id: a, clinic_name: "Guerra–Mininni", patient_name: "Paciente Mininni" });
    expect(vb).toMatchObject({ clinic_id: b, clinic_name: "Clínica Beta", patient_name: "Paciente Beta" });
    expect(va.patient_context).not.toContain("Paciente Beta");
  });
  it("separa un ID heredado sin modificar el agente ajeno y reutiliza el agente propio al actualizar", async () => {
    await sql`update clinics set elevenlabs_agent_id = 'agent-main' where id = ${a}`;
    const first = await setup((await sql`select * from clinics where id = ${a}`)[0] as never);
    expect(first).toMatchObject({ agentId: "agent-own-1", created: true, voiceId: "voice-sofi" });
    expect((await sql`select elevenlabs_agent_id from clinics where id = ${MAIN}`)[0].elevenlabs_agent_id).toBe("agent-main");
    expect(mocks.calls.some((r) => r.path === "/v1/convai/agents/agent-main")).toBe(false);
    const created = mocks.calls.find((r) => r.path === "/v1/convai/agents/create")!;
    expect(created.body.name).toBe("Turnia · Guerra–Mininni");
    expect(created.body.conversation_config).toMatchObject({ tts: { voice_id: "voice-sofi" } });
    expect(mocks.voiceAgents).toEqual(["agent-main"]);
    const second = await setup((await sql`select * from clinics where id = ${a}`)[0] as never);
    expect(second).toMatchObject({ agentId: first.agentId, created: false });
    expect(mocks.calls.filter((r) => r.path === "/v1/convai/agents/create")).toHaveLength(1);
    expect((await sql`select elevenlabs_agent_id from clinics where id = ${b}`)[0].elevenlabs_agent_id).toBe("agent-beta");
  });
  it("conserva la voz propia de una clínica y no consulta ni cambia la del agente general", async () => {
    await sql`update clinics set elevenlabs_voice_id = 'voice-clinic' where id = ${a}`;
    const result = await setup((await sql`select * from clinics where id = ${a}`)[0] as never);
    expect(result.voiceId).toBe("voice-clinic");
    expect(mocks.voiceAgents).toEqual([]);
    expect(mocks.calls.find((r) => r.path === "/v1/convai/agents/agent-mininni")?.body.conversation_config).toMatchObject({ tts: { voice_id: "voice-clinic" } });
  });
});
