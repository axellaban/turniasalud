// Los errores técnicos (de WAHA, de Smile Connect, de la red) dichos para el consultorio. El texto
// original queda para «Detalle». Es puro para poder probarlo.

const RULES: Array<[RegExp, string]> = [
  [/WAHA[\s\S]*(Session status|SCAN_QR|STOPPED|FAILED|STARTING|not (?:working|ready)|\b422\b)/i, "No se pudo enviar: la línea de WhatsApp estaba desconectada."],
  [/WAHA[\s\S]*(\b5\d\d\b|timeout|ECONN|fetch failed|aborted)/i, "No se pudo enviar: la línea de WhatsApp no respondió. Se vuelve a intentar sola."],
  [/outside (?:the )?configured hours|outside_hours/i, "Smile Connect no aceptó el horario: está fuera del horario del profesional cargado allá."],
  [/slot_unavailable|slot_conflict|not available|ocupad/i, "Smile Connect no aceptó el horario: ya estaba ocupado."],
  [/rate_limited|\b429\b|too many/i, "Smile Connect pidió esperar un momento (muchos pedidos seguidos). Se vuelve a intentar sola."],
  [/\b401\b|unauthorized|invalid_key|clave/i, "Smile Connect no aceptó la clave de Turnia."],
  [/\b403\b|forbidden|missing_scope|permiso/i, "A la clave de Smile Connect le falta un permiso para esto."],
  [/\b404\b|not_found/i, "Smile Connect no encontró ese turno o paciente: puede que lo hayan borrado allá."],
  [/timeout|ETIMEDOUT|AbortError|aborted|timed out/i, "No respondió a tiempo. Se vuelve a intentar sola."],
  [/ECONN|fetch failed|network/i, "No hubo conexión. Se vuelve a intentar sola."],
];

/** ¿Ya está dicho para una persona? (Sin códigos, llaves ni inglés técnico.) */
const looksHuman = (s: string) => !/[{}[\]]|\b[1-5]\d\d\b|\b(error|request|status|failed|POST|GET|PATCH)\b|_[a-z]/.test(s);

export function friendlyError(raw: string | null | undefined): { text: string; detail: string | null } | null {
  const clean = raw?.trim();
  if (!clean) return null;
  for (const [re, text] of RULES) if (re.test(clean)) return { text, detail: clean };
  if (looksHuman(clean)) return { text: clean, detail: null };
  return { text: "Hubo un error técnico. Turnia lo ve en el detalle.", detail: clean };
}
