import { describe, expect, it } from "vitest";
import { DEFAULT_VOICE_RULES, voiceRulesSchema } from "./voice-rules";

describe("reglas de audio de prospección", () => {
  it("permite cambiar el cupo inicial de veinte", () => {
    expect(voiceRulesSchema.parse({ ...DEFAULT_VOICE_RULES, dailyLimit: 75, batchSize: 12 })).toMatchObject({
      dailyLimit: 75, batchSize: 12,
    });
  });

  it("admite pausas expresadas en segundos", () => {
    expect(voiceRulesSchema.parse({
      ...DEFAULT_VOICE_RULES, pauseMinMinutes: 10 / 60, pauseMaxMinutes: 20 / 60,
    })).toMatchObject({ pauseMinMinutes: 10 / 60, pauseMaxMinutes: 20 / 60 });
    expect(voiceRulesSchema.safeParse({ ...DEFAULT_VOICE_RULES, pauseMinMinutes: 0 }).success).toBe(false);
  });

  it("rechaza tandas mayores al cupo y pausas invertidas", () => {
    expect(voiceRulesSchema.safeParse({ ...DEFAULT_VOICE_RULES, dailyLimit: 3, batchSize: 5 }).success).toBe(false);
    expect(voiceRulesSchema.safeParse({ ...DEFAULT_VOICE_RULES, pauseMinMinutes: 8, pauseMaxMinutes: 3 }).success).toBe(false);
  });
});
