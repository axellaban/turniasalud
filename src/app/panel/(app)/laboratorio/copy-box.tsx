"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui";

/** El pedido para pegar en Claude o ChatGPT, con su botón para copiarlo. */
export function CopyBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <button
        type="button"
        className={buttonClass}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copiado" : "Copiar el pedido"}
      </button>
      <textarea readOnly value={text} rows={8} aria-label="Pedido para el chat" className="block w-full rounded-xl border border-brand-900/15 bg-brand-50/40 p-3 font-mono text-xs text-brand-900/80" />
      <p className="text-xs text-brand-900/60">{Math.round(text.length / 1000)} mil caracteres.</p>
    </div>
  );
}
