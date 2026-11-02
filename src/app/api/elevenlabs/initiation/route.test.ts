import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), variables: vi.fn() }));
vi.mock("@/lib/clinic", () => ({
  resolveInboundClinic: mocks.resolve,
  buildDynamicVariables: mocks.variables,
  InboundClinicError: class InboundClinicError extends Error {},
}));
import { InboundClinicError } from "@/lib/clinic";
import { POST } from "./route";

const request = (body: unknown, secret = "voice-test-secret") => new Request("https://turnia.test/api/elevenlabs/initiation", {
  method: "POST", headers: { "x-turnia-secret": secret, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

describe("inicio de llamadas por clínica", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AGENT_TOOLS_SECRET", "voice-test-secret");
    mocks.resolve.mockResolvedValue({ id: "clinica-mininni" });
    mocks.variables.mockResolvedValue({ clinic_id: "clinica-mininni", clinic_name: "Guerra–Mininni" });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rechaza un inicio sin autorización antes de consultar clínicas o pacientes", async () => {
    expect((await POST(request({ agent_id: "agent-mininni" }, "incorrecto"))).status).toBe(401);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.variables).not.toHaveBeenCalled();
  });
  it.each([null, {}, { agent_id: "" }, { agent_id: 123 }, { agent_id: "a", caller_id: {} }])("rechaza datos inválidos sin elegir una clínica por defecto: %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("carga solo la clínica resuelta y normaliza el teléfono de quien llama", async () => {
    const response = await POST(request({ agent_id: "agent-mininni", called_number: "+5491172433765", caller_id: "+54 9 11 5555-0001" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.resolve).toHaveBeenCalledWith({ agentId: "agent-mininni", calledNumber: "+5491172433765" });
    expect(mocks.variables).toHaveBeenCalledWith({ id: "clinica-mininni" }, "5491155550001");
    expect(await response.json()).toMatchObject({ dynamic_variables: { clinic_id: "clinica-mininni" }, user_id: "5491155550001" });
  });
  it("rechaza destinos incompatibles sin cargar el contexto de ningún paciente", async () => {
    mocks.resolve.mockRejectedValue(new InboundClinicError("Destino incompatible"));
    expect((await POST(request({ agent_id: "otro-agente", called_number: "+5491172433765" }))).status).toBe(409);
    expect(mocks.variables).not.toHaveBeenCalled();
  });
});
