import { describe, expect, it } from "vitest";
import { voiceLlmOverride } from "./elevenlabs";

const agent = (llm: string, overridable: boolean) => ({
  conversation_config: { agent: { prompt: { llm } } },
  platform_settings: { overrides: { conversation_config_override: { agent: { first_message: true, ...(overridable && { prompt: { llm: true } }) } } } },
});

describe("LLM de voz en las charlas por voz del agente general", () => {
  it("pide el LLM de voz cuando el agente piensa con otro y lo permite", () => {
    expect(voiceLlmOverride(agent("claude-opus-5-5", true), "claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
  });
  it("no pide nada si el agente ya usa el de voz", () => {
    expect(voiceLlmOverride(agent("claude-sonnet-5-5", true), "claude-sonnet-5-5")).toBeUndefined();
  });
  it("no pide nada si el agente todavía no permite cambiarlo (ElevenLabs rechazaría la charla)", () => {
    expect(voiceLlmOverride(agent("claude-opus-5-5", false), "claude-sonnet-5-5")).toBeUndefined();
    expect(voiceLlmOverride(null, "claude-sonnet-5-5")).toBeUndefined();
  });
});
