/**
 * Qué decirle a quien usa la web cuando algo falla. Los mensajes propios (los que arma nuestra API)
 * se muestran tal cual. Los del navegador no: sin conexión, el fetch falla con «Failed to fetch»
 * (Chrome), «Load failed» (Safari) o «NetworkError…» (Firefox), en inglés y sin decir qué hacer.
 * Pasó en /probar-demo (QA del 13/11). Una respuesta que no es JSON (una página de error) tampoco.
 */
export const SIN_CONEXION = "No pudimos conectarnos. Revisá tu conexión a internet y probá de nuevo.";

export function errorText(e: unknown, fallback: string): string {
  if (e instanceof TypeError) return SIN_CONEXION;
  if (e instanceof SyntaxError) return fallback;
  return e instanceof Error && e.message ? e.message : fallback;
}
