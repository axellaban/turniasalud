import "server-only";
import { z } from "zod";
import { json, sql, type Sql, type TransactionSql } from "@/lib/db";
import { OutreachError } from "./outreach";

export const DEFAULT_VOICE_RULES = {
  dailyLimit: 20,
  batchSize: 5,
  pauseMinMinutes: 3,
  pauseMaxMinutes: 6,
};

export const voiceRulesSchema = z.object({
  dailyLimit: z.number().int().min(1),
  batchSize: z.number().int().min(1),
  pauseMinMinutes: z.number().min(1 / 60).max(60),
  pauseMaxMinutes: z.number().min(1 / 60).max(60),
}).refine((rules) => rules.batchSize <= rules.dailyLimit, {
  message: "La tanda debe ser igual o menor que el cupo diario.", path: ["batchSize"],
}).refine((rules) => rules.pauseMaxMinutes >= rules.pauseMinMinutes, {
  message: "La pausa máxima debe ser igual o mayor que la mínima.", path: ["pauseMaxMinutes"],
});

export type VoiceRules = z.infer<typeof voiceRulesSchema>;

export async function voiceRules(db: Sql | TransactionSql = sql): Promise<VoiceRules> {
  const [row] = await db<Array<{ outreach_voice_rules: unknown }>>`
    select outreach_voice_rules from sales_settings where id = 1`;
  const stored = row?.outreach_voice_rules;
  const parsed = voiceRulesSchema.safeParse({
    ...DEFAULT_VOICE_RULES,
    ...(stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {}),
  });
  if (!parsed.success) throw new OutreachError("Revisá las reglas de envío guardadas en el panel.");
  return parsed.data;
}

export async function saveVoiceRules(input: VoiceRules): Promise<VoiceRules> {
  const parsed = voiceRulesSchema.safeParse(input);
  if (!parsed.success) throw new OutreachError(parsed.error.issues[0]?.message ?? "Revisá las reglas de envío.");
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('turnia-prospecting-voice-quota', 0))`;
    await tx`update sales_settings set outreach_voice_rules = ${json(parsed.data)}, updated_at = now() where id = 1`;
  });
  return parsed.data;
}
