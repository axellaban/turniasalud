import { friendlyError } from "@/lib/friendly-error";

/** Un error dicho para el consultorio; el texto técnico, plegado en «Detalle». */
export function ErrorText({ raw, className = "text-red-700" }: { raw: string | null | undefined; className?: string }) {
  const e = friendlyError(raw);
  if (!e) return null;
  return (
    <span className={className}>
      {e.text}
      {e.detail && <details className="mt-0.5 text-xs text-brand-900/60"><summary className="cursor-pointer">Ver el error técnico</summary><code className="break-all">{e.detail}</code></details>}
    </span>
  );
}
