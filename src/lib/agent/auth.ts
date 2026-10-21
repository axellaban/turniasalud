import "server-only";
import { timingSafeEqual } from "node:crypto";

/** Los llamados de ElevenLabs y n8n traen el header x-turnia-secret. */
export function hasValidSecret(request: Request): boolean {
  const expected = process.env.AGENT_TOOLS_SECRET;
  const received = request.headers.get("x-turnia-secret");
  if (!expected || !received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
