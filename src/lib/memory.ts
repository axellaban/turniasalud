/**
 * Combina la memoria previa con lo nuevo, sin crecer indefinidamente.
 * Con fecha, la nota nueva va con el día en que el paciente lo contó («[30/10/2026] …»):
 * así el agente sabe si es de esta semana o de hace un año.
 */
export function mergeMemory(previous: string | null, addition: string | null, max = 800, date?: string): string | null {
  const text = addition?.trim();
  if (!text) return previous;
  if (previous?.includes(text)) return previous;
  const note = date ? `[${date}] ${text}` : text;
  const merged = previous ? `${previous} ${note}` : note;
  return merged.length > max ? `…${merged.slice(merged.length - max)}` : merged;
}
