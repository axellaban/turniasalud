import "server-only";
import { sql } from "./db";
import { elevenlabs } from "./elevenlabs";
import { completeConversationSummary, recordConversation, type PostCallPayload } from "./conversations";

// Las conversaciones que ElevenLabs no pudo entregar por el webhook post-call (por ejemplo, del 05/11
// al cambio de dominio: turniasalud.vercel.app pasó a redirigir a turniasalud.app y ElevenLabs no sigue
// la redirección). Se le piden a su API y se guardan igual que las del webhook, pero en silencio: sin
// tocar pacientes, campañas ni tareas y sin avisar a n8n (son charlas viejas). Las llamadas de ventas
// (sales_call_id) tienen su propia conciliación y no se tocan acá.

type ListItem = { conversation_id: string; agent_id?: string; start_time_unix_secs?: number; status?: string };
type ListPage = { conversations?: ListItem[]; has_more?: boolean; next_cursor?: string | null };

export type BackfillReport = {
  desde: string;
  agentes: number;
  enElevenlabs: number;
  yaEstaban: number;
  recuperadas: number;
  /** Ya estaban (las de WhatsApp se guardan en vivo) pero sin resumen: se les sumó. */
  completadas: number;
  enCurso: number;
  ventas: number;
  errores: number;
  /** Si se cortó por tiempo: se completa con otra corrida (no repite lo ya guardado). */
  incompleta: boolean;
};

const BUDGET_MS = 240_000;

export async function backfillConversations(desde: string): Promise<BackfillReport> {
  const since = Date.parse(desde);
  if (!Number.isFinite(since)) throw new Error("Fecha inválida: usá AAAA-MM-DD.");
  const deadline = Date.now() + BUDGET_MS;
  const agents = (await sql<Array<{ agent: string }>>`
    select distinct elevenlabs_agent_id as agent from clinics where elevenlabs_agent_id is not null`).map((r) => r.agent);
  const report: BackfillReport = { desde, agentes: agents.length, enElevenlabs: 0, yaEstaban: 0, recuperadas: 0, completadas: 0, enCurso: 0, ventas: 0, errores: 0, incompleta: false };
  for (const agent of agents) {
    let cursor: string | null = null;
    do {
      if (Date.now() > deadline) { report.incompleta = true; return report; }
      const q = new URLSearchParams({ agent_id: agent, page_size: "100", call_start_after_unix: String(Math.floor(since / 1000)) });
      if (cursor) q.set("cursor", cursor);
      const page: ListPage = await elevenlabs<ListPage>(`/v1/convai/conversations?${q}`, { signal: AbortSignal.timeout(20000) });
      const items = (page.conversations ?? []).filter((c) => /^conv_[a-zA-Z0-9]+$/.test(c.conversation_id));
      report.enElevenlabs += items.length;
      const ids = items.map((c) => c.conversation_id);
      // Las de WhatsApp se guardan en vivo, sin resumen: esas también se completan.
      const rows = await sql<Array<{ id: string; complete: boolean }>>`
        select elevenlabs_conversation_id as id, (summary is not null or title is not null) as complete
        from conversations where elevenlabs_conversation_id = any(${ids}::text[])`;
      const have = new Set(rows.filter((r) => r.complete).map((r) => r.id));
      const live = new Set(rows.filter((r) => !r.complete).map((r) => r.id));
      report.yaEstaban += have.size;
      for (const item of items) {
        if (have.has(item.conversation_id)) continue;
        if (Date.now() > deadline) { report.incompleta = true; return report; }
        if (item.status && item.status !== "done" && item.status !== "failed") { report.enCurso++; continue; }
        try {
          const data = await elevenlabs<PostCallPayload>(`/v1/convai/conversations/${encodeURIComponent(item.conversation_id)}`, { signal: AbortSignal.timeout(15000) });
          if (data.conversation_initiation_client_data?.dynamic_variables?.sales_call_id) { report.ventas++; continue; }
          if (live.has(item.conversation_id)) {
            if (await completeConversationSummary(data)) report.completadas++;
            continue;
          }
          await recordConversation(data, { quiet: true });
          report.recuperadas++;
        } catch (e) {
          report.errores++;
          console.error("recuperar una conversación de ElevenLabs", e instanceof Error ? e.message.slice(0, 160) : e);
        }
      }
      cursor = page.has_more && page.next_cursor ? page.next_cursor : null;
    } while (cursor);
  }
  return report;
}

/**
 * Las charlas que siguen «sin resumen» un rato después de terminar (en general, las de WhatsApp, que
 * Turnia guarda en vivo): se le pide el resumen a ElevenLabs. Cubre el caso de que el webhook post-call
 * no llegue. Va de a pocas y solo con las de los últimos 3 días; las que ElevenLabs todavía tiene
 * abiertas se vuelven a mirar en la próxima vuelta.
 */
export async function completePendingSummaries(opts: { limit?: number; budgetMs?: number } = {}): Promise<{ revisadas: number; completadas: number; enCurso: number; errores: number }> {
  const deadline = Date.now() + (opts.budgetMs ?? 45_000);
  const out = { revisadas: 0, completadas: 0, enCurso: 0, errores: 0 };
  if (!process.env.ELEVENLABS_API_KEY) return out;
  const pending = await sql<Array<{ id: string }>>`
    select elevenlabs_conversation_id as id from conversations
    where summary is null and title is null and elevenlabs_conversation_id ~ '^conv_[a-zA-Z0-9]+$'
      and started_at > now() - interval '3 days' and started_at < now() - interval '20 minutes'
      and coalesce(status, '') <> 'failed'
    order by started_at desc
    limit ${opts.limit ?? 12}`;
  for (const { id } of pending) {
    if (Date.now() > deadline) break;
    out.revisadas++;
    try {
      const data = await elevenlabs<PostCallPayload>(`/v1/convai/conversations/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(10000) });
      if (data.status && data.status !== "done" && data.status !== "failed") { out.enCurso++; continue; }
      if (await completeConversationSummary(data)) out.completadas++;
    } catch (e) {
      out.errores++;
      console.error("completar el resumen de una conversación", e instanceof Error ? e.message.slice(0, 160) : e);
    }
  }
  return out;
}
