import "server-only";
import { sql } from "./db";
import { elevenlabs } from "./elevenlabs";
import { recordConversation, type PostCallPayload } from "./conversations";

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
  const report: BackfillReport = { desde, agentes: agents.length, enElevenlabs: 0, yaEstaban: 0, recuperadas: 0, enCurso: 0, ventas: 0, errores: 0, incompleta: false };
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
      const have = new Set((await sql<Array<{ id: string }>>`
        select elevenlabs_conversation_id as id from conversations where elevenlabs_conversation_id = any(${ids}::text[])`).map((r) => r.id));
      report.yaEstaban += ids.filter((id) => have.has(id)).length;
      for (const item of items) {
        if (have.has(item.conversation_id)) continue;
        if (Date.now() > deadline) { report.incompleta = true; return report; }
        if (item.status && item.status !== "done" && item.status !== "failed") { report.enCurso++; continue; }
        try {
          const data = await elevenlabs<PostCallPayload>(`/v1/convai/conversations/${encodeURIComponent(item.conversation_id)}`, { signal: AbortSignal.timeout(15000) });
          if (data.conversation_initiation_client_data?.dynamic_variables?.sales_call_id) { report.ventas++; continue; }
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
