/** Combina la memoria previa con lo nuevo, sin crecer indefinidamente. */
export function mergeMemory(previous: string | null, addition: string | null, max = 800): string | null {
  if (!addition) return previous;
  if (previous?.includes(addition)) return previous;
  const merged = previous ? `${previous} ${addition}` : addition;
  return merged.length > max ? `…${merged.slice(merged.length - max)}` : merged;
}
