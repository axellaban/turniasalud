import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken } from "@/lib/session";

const mocks = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  getClinic: vi.fn(),
  buildDynamicVariables: vi.fn(),
  getVoiceCredential: vi.fn(),
  getChatCredential: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: mocks.cookie }) }) }));
vi.mock("@/lib/panel-clinic", () => ({ getPanelClinic: mocks.getClinic }));
vi.mock("@/lib/clinic", () => ({ getClinic: mocks.getClinic, buildDynamicVariables: mocks.buildDynamicVariables }));
vi.mock("@/lib/elevenlabs", () => ({ getVoiceCredential: mocks.getVoiceCredential, getChatCredential: mocks.getChatCredential }));

import { POST } from "./route";

describe("credenciales de la demo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "test-demo-secret";
    mocks.cookie = undefined;
    mocks.getClinic.mockResolvedValue({ elevenlabs_agent_id: "agent-test", name: "Clínica de prueba" });
    mocks.buildDynamicVariables.mockResolvedValue({ clinic_id: "clinic-test" });
    mocks.getVoiceCredential.mockResolvedValue({ token: "voice-token", llm: "claude-sonnet-5-5" });
    mocks.getChatCredential.mockResolvedValue({ signedUrl: "https://example.com/signed", sinSaludo: true });
  });

  const request = (mode = "voz") => new Request("https://turnia.example/api/elevenlabs/token", {
    method: "POST", body: JSON.stringify({ mode }),
  });

  it.each(["sin sesión", "vencida", "adulterada"])("no consulta servicios externos con sesión %s", async (kind) => {
    if (kind === "vencida") mocks.cookie = createSessionToken(Date.now() - 30 * 86400_000);
    if (kind === "adulterada") mocks.cookie = `${createSessionToken()}x`;
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.getClinic).not.toHaveBeenCalled();
    expect(mocks.getVoiceCredential).not.toHaveBeenCalled();
    expect(mocks.getChatCredential).not.toHaveBeenCalled();
  });

  it.each(["voz", "chat"])("permite %s con sesión válida y evita cachear credenciales", async (mode) => {
    mocks.cookie = createSessionToken();
    const response = await POST(request(mode));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    if (mode === "chat") {
      expect(body).toMatchObject({ signedUrl: "https://example.com/signed", sinSaludo: true });
      expect(mocks.getVoiceCredential).not.toHaveBeenCalled();
    } else {
      expect(body).toMatchObject({ token: "voice-token", llm: "claude-sonnet-5-5" });
      expect(mocks.getChatCredential).not.toHaveBeenCalled();
    }
  });
});
