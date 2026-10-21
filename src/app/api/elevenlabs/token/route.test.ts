import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken } from "@/lib/session";

const mocks = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  getClinic: vi.fn(),
  buildDynamicVariables: vi.fn(),
  getConversationToken: vi.fn(),
  getSignedUrl: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: mocks.cookie }) }) }));
vi.mock("@/lib/clinic", () => ({ getClinic: mocks.getClinic, buildDynamicVariables: mocks.buildDynamicVariables }));
vi.mock("@/lib/elevenlabs", () => ({ getConversationToken: mocks.getConversationToken, getSignedUrl: mocks.getSignedUrl }));

import { POST } from "./route";

describe("credenciales de la demo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "test-demo-secret";
    mocks.cookie = undefined;
    mocks.getClinic.mockResolvedValue({ elevenlabs_agent_id: "agent-test", name: "Clínica de prueba" });
    mocks.buildDynamicVariables.mockResolvedValue({ clinic_id: "clinic-test" });
    mocks.getConversationToken.mockResolvedValue("voice-token");
    mocks.getSignedUrl.mockResolvedValue("https://example.com/signed");
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
    expect(mocks.getConversationToken).not.toHaveBeenCalled();
    expect(mocks.getSignedUrl).not.toHaveBeenCalled();
  });

  it.each(["voz", "chat"])("permite %s con sesión válida y evita cachear credenciales", async (mode) => {
    mocks.cookie = createSessionToken();
    const response = await POST(request(mode));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    if (mode === "chat") {
      expect(body.signedUrl).toBe("https://example.com/signed");
      expect(mocks.getConversationToken).not.toHaveBeenCalled();
    } else {
      expect(body.token).toBe("voice-token");
      expect(mocks.getSignedUrl).not.toHaveBeenCalled();
    }
  });
});
