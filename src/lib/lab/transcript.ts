// Una charla (simulada o real) en un formato único para el juez, los controles y el panel.

export type LabTool = { name: string; params: string; result: string | null; error: boolean };
export type LabLine = { role: "paciente" | "sofi"; text: string; tools: LabTool[] };

type RawToolCall = { request_id?: string; tool_name?: string; params_as_json?: string };
type RawToolResult = { request_id?: string; tool_name?: string; result_value?: string; is_error?: boolean };
type RawLine = {
  role?: string;
  message?: string | null;
  tool_calls?: RawToolCall[] | null;
  tool_results?: RawToolResult[] | null;
};

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

/**
 * Convierte las líneas de ElevenLabs (agent_responses de una simulación, transcript de una conversación
 * o el historial de un caso) en LabLine. Los resultados de herramientas se unen a su llamada por
 * request_id (o por nombre). Puro.
 */
export function normalizeTranscript(raw: unknown): LabLine[] {
  if (!Array.isArray(raw)) return [];
  const lines: LabLine[] = [];
  for (const item of raw as RawLine[]) {
    if (!item || typeof item !== "object") continue;
    const role = item.role === "user" ? "paciente" : "sofi";
    const tools: LabTool[] = (item.tool_calls ?? []).map((c) => ({
      name: c.tool_name ?? "herramienta",
      params: clip(c.params_as_json ?? "", 1500),
      result: null,
      error: false,
    }));
    for (const r of item.tool_results ?? []) {
      const byId = (item.tool_calls ?? []).findIndex((c) => r.request_id && c.request_id === r.request_id);
      const target = byId >= 0 ? tools[byId] : tools.find((t) => t.name === r.tool_name && t.result === null);
      const value = clip(r.result_value ?? "", 2500);
      if (target) {
        target.result = value;
        target.error = Boolean(r.is_error);
      } else {
        // El resultado llegó en otra línea que la llamada: se pega a la última llamada abierta.
        const open = [...lines].reverse().flatMap((l) => l.tools).find((t) => t.name === r.tool_name && t.result === null);
        if (open) {
          open.result = value;
          open.error = Boolean(r.is_error);
        } else {
          tools.push({ name: r.tool_name ?? "herramienta", params: "", result: value, error: Boolean(r.is_error) });
        }
      }
    }
    const text = (item.message ?? "").trim();
    if (!text && !tools.length) continue;
    // Varias líneas seguidas de Sofi con solo herramientas se juntan con la siguiente.
    const last = lines.at(-1);
    if (last && last.role === role && role === "sofi" && !last.text) {
      last.tools.push(...tools);
      last.text = text;
      continue;
    }
    lines.push({ role, text, tools });
  }
  return lines;
}

/** La charla como texto para el juez: «Paciente:», «Sofi:» y cada herramienta con su resultado. Puro. */
export function transcriptText(lines: LabLine[], maxChars = 60_000): string {
  const out: string[] = [];
  for (const l of lines) {
    for (const t of l.tools) {
      out.push(`  [herramienta ${t.name}${t.params ? ` ${t.params}` : ""}]${t.result !== null ? ` → ${t.error ? "ERROR " : ""}${t.result}` : ""}`);
    }
    if (l.text) out.push(`${l.role === "paciente" ? "Paciente" : "Sofi"}: ${l.text}`);
  }
  const text = out.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[charla recortada]` : text;
}

/** Las líneas guardadas en conversations.transcript (sin herramientas). Puro. */
export function storedTranscript(raw: unknown): LabLine[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Array<{ role?: string; message?: string | null }>)
    .map((t) => ({ role: t.role === "user" ? ("paciente" as const) : ("sofi" as const), text: (t.message ?? "").trim(), tools: [] }))
    .filter((l) => l.text);
}
