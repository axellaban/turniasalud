"use client";

import { useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { requestMicrophone } from "@/lib/microphone";

type Info = { token: string; dynamicVariables: Record<string, string>; userId: string; clinicName: string; agentName: string; error?: string };

export function LlamadaDemo({ token }: { token: string }) {
  return (
    <ConversationProvider>
      <Llamada token={token} />
    </ConversationProvider>
  );
}

function Llamada({ token }: { token: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ended, setEnded] = useState(false);
  const conversation = useConversation({
    onError: (message) => setError(typeof message === "string" ? message : "Se cortó la llamada."),
    onDisconnect: () => setEnded(true),
  });
  const connected = conversation.status === "connected";

  async function llamar() {
    setError(null);
    setEnded(false);
    setLoading(true);
    try {
      await requestMicrophone();
      const res = await fetch("/api/demo/llamada", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json()) as Info;
      if (!res.ok) throw new Error(data.error || "No se pudo iniciar la llamada.");
      setInfo(data);
      await conversation.startSession({ conversationToken: data.token, dynamicVariables: data.dynamicVariables, userId: data.userId });
    } catch (e) {
      const permiso = e instanceof DOMException && e.name === "NotAllowedError";
      setError(permiso ? "Necesitamos permiso para usar el micrófono." : e instanceof Error ? e.message : "No se pudo iniciar la llamada.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-6">
      <h1 className="text-[32px] font-medium leading-tight tracking-tight text-brand-950 sm:text-[40px]">
        {info ? `Llamando a ${info.clinicName}` : "Hablá con tu recepcionista virtual"}
      </h1>
      <p className="mt-4 text-[16px] leading-relaxed text-tinta">
        Hablale como si fueras un paciente que quiere sacar un turno. Por ejemplo: «Hola, quiero un turno para la semana que viene».
      </p>

      <div className="mt-10 grid place-items-center">
        {connected ? (
          <button
            type="button"
            onClick={() => conversation.endSession()}
            className="grid h-28 w-28 place-items-center rounded-full bg-red-600 text-sm font-semibold text-white shadow-lg hover:bg-red-700"
          >
            Cortar
          </button>
        ) : (
          <button
            type="button"
            onClick={llamar}
            disabled={loading}
            className="grid h-28 w-28 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white shadow-lg hover:bg-brand-700 disabled:opacity-60"
          >
            {loading ? "Conectando…" : ended ? "Llamar de nuevo" : "📞 Llamar"}
          </button>
        )}
        <p className="mt-5 h-6 text-sm text-brand-700" aria-live="polite">
          {connected ? (conversation.isSpeaking ? `🔊 ${info?.agentName ?? "Sofi"} está hablando…` : "🎙️ Te escucho…") : ended ? "Llamada terminada." : ""}
        </p>
      </div>

      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {ended && !error && (
        <p className="mt-6 rounded-2xl bg-white p-4 text-sm text-tinta ring-1 ring-brand-950/5">
          Volvé al chat para probar otro modo (escribí <b>MENU</b>) o para terminar (<b>SALIR</b>).
        </p>
      )}
    </div>
  );
}
