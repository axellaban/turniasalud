"use client";

import { useState } from "react";
import type { MessagingChannel } from "@/lib/messaging-settings";
import { normalizeWebsite } from "@/lib/demo/website";

/** Campo de la web + PROBAR DEMO: abre WhatsApp con el mensaje armado. */
export function ProbarDemoForm({ channel, ready }: { channel: MessagingChannel; ready: boolean }) {
  const [web, setWeb] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [pending, setPending] = useState(false);

  async function probar(e: React.FormEvent) {
    e.preventDefault();
    const website = normalizeWebsite(web);
    if (!website) {
      setError("Revisá la dirección. Por ejemplo: miclinica.com.ar");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/demo/iniciar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ website }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo abrir la demo.");
      window.location.href = result.url;
    } catch (error) {
      setError(error instanceof Error ? error.message : "No se pudo abrir la demo.");
      setPending(false);
    }
  }

  if (!ready) {
    return (
      <p className="mx-auto mt-10 max-w-[560px] rounded-2xl bg-white p-5 text-sm text-tinta ring-1 ring-brand-950/5">
        La demo está pausada por el momento. Volvé en breve o pedí una demo guiada.
      </p>
    );
  }

  return (
    <form onSubmit={probar} className="mx-auto mt-10 max-w-[620px]" noValidate>
      <label htmlFor="web" className="sr-only">
        La web de tu clínica o consultorio
      </label>
      <div className="flex flex-col gap-3 rounded-2xl bg-white p-2 shadow-lg ring-1 ring-brand-950/10 focus-within:ring-2 focus-within:ring-brand-600 sm:flex-row">
        <input
          id="web"
          name="web"
          type="text"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={web}
          onChange={(e) => setWeb(e.target.value)}
          placeholder="La web de tu consultorio: miclinica.com.ar"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "web-error" : undefined}
          className="min-w-0 flex-1 rounded-xl px-4 py-3.5 text-[16px] text-brand-950 outline-none placeholder:text-tinta/85"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-brand-600 px-7 py-3.5 text-sm font-semibold uppercase tracking-wider text-white hover:bg-brand-700"
        >
          {pending ? "Abriendo…" : "Probar demo"}
        </button>
      </div>
      {error ? (
        <p id="web-error" role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      ) : (
        <p className="mt-3 text-xs text-tinta">{channel === "telegram" ? "Se abre Telegram. Tocá Iniciar para que Turnia reciba tu web y prepare la demo." : "Se abre WhatsApp con el mensaje listo. Solo tenés que enviarlo."}</p>
      )}
    </form>
  );
}
