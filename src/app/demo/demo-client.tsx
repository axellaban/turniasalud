"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";

type Line = { id: number; role: "user" | "agent" | "system"; text: string };

type SessionInfo = {
  token?: string;
  signedUrl?: string;
  dynamicVariables: Record<string, string>;
  userId: string;
  clinicName?: string;
  error?: string;
};

export function DemoClient() {
  return (
    <ConversationProvider>
      <Demo />
    </ConversationProvider>
  );
}

function Demo() {
  const [mode, setMode] = useState<"chat" | "voz">("chat");
  const [phone, setPhone] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const counter = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const push = useCallback((role: Line["role"], text: string) => {
    counter.current += 1;
    const id = counter.current;
    setLines((prev) => {
      // En modo chat, el SDK puede repetir el mensaje que ya mostramos al enviarlo.
      const last = prev[prev.length - 1];
      if (role === "user" && last?.role === "user" && last.text.trim() === text.trim()) return prev;
      return [...prev, { id, role, text }];
    });
  }, []);

  const conversation = useConversation({
    onMessage: (m) => {
      if (m.message?.trim()) push(m.role === "agent" ? "agent" : "user", m.message);
    },
    onError: (message) => setError(typeof message === "string" ? message : "Error en la conversación"),
    onDisconnect: () => push("system", "Conversación finalizada."),
  });

  const connected = conversation.status === "connected";
  const connecting = conversation.status === "connecting" || loading;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines]);

  async function start() {
    setError(null);
    setLines([]);
    setLoading(true);
    try {
      if (mode === "voz") await navigator.mediaDevices.getUserMedia({ audio: true });
      const res = await fetch("/api/elevenlabs/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, mode }),
      });
      const info = (await res.json()) as SessionInfo;
      if (!res.ok) throw new Error(info.error || "No se pudo iniciar la conversación");
      await conversation.startSession({
        ...(mode === "chat" ? { signedUrl: info.signedUrl!, textOnly: true } : { conversationToken: info.token! }),
        dynamicVariables: info.dynamicVariables,
        userId: info.userId,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo iniciar la conversación");
    } finally {
      setLoading(false);
    }
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !connected) return;
    conversation.sendUserMessage(text);
    push("user", text);
    setDraft("");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <aside className="space-y-5 rounded-3xl border border-brand-900/10 bg-white p-6">
        <div>
          <p className="text-sm font-semibold text-brand-900">¿Cómo querés probarlo?</p>
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-full bg-brand-50 p-1 text-sm">
            {(["chat", "voz"] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={connected || connecting}
                onClick={() => setMode(m)}
                className={`rounded-full px-3 py-2 font-medium transition ${mode === m ? "bg-white text-brand-800 shadow" : "text-brand-700/70"}`}
              >
                {m === "chat" ? "💬 Chat" : "🎙️ Voz"}
              </button>
            ))}
          </div>
        </div>
        <label className="block text-sm">
          <span className="font-semibold text-brand-900">Tu celular (opcional)</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={connected || connecting}
            placeholder="11 5555-0001"
            className="mt-2 w-full rounded-xl border border-brand-900/15 px-3 py-2 outline-none focus:border-brand-500"
          />
          <span className="mt-1 block text-xs text-brand-900/55">
            Probá con <b>11 5555-0001</b> para ser “María”, una paciente que ya existe y tiene la limpieza vencida.
          </span>
        </label>
        {connected ? (
          <button type="button" onClick={() => conversation.endSession()} className="w-full rounded-full bg-neutral-900 py-3 font-semibold text-white">
            Terminar
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={connecting}
            className="w-full rounded-full bg-brand-600 py-3 font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {connecting ? "Conectando…" : "Empezar conversación"}
          </button>
        )}
        {mode === "voz" && connected && (
          <p className="text-center text-sm text-brand-700">{conversation.isSpeaking ? "🔊 Sofi está hablando…" : "🎙️ Te escucho…"}</p>
        )}
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="rounded-2xl bg-sun-100 p-4 text-xs leading-relaxed text-brand-950/80">
          <p className="font-semibold">Ideas para probar</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>“Quiero un turno con dermatología, tengo OSDE”</li>
            <li>“Necesito cancelar mi turno del martes”</li>
            <li>“¿Dónde queda la clínica? ¿Hay estacionamiento?”</li>
            <li>“Me tienen que renovar una receta”</li>
            <li>“Me duele mucho el pecho” (prueba de urgencia)</li>
          </ul>
        </div>
      </aside>

      <section className="flex min-h-[520px] flex-col overflow-hidden rounded-3xl border border-brand-900/10 bg-[#efeae2]">
        <div className="flex items-center gap-3 bg-brand-700 px-5 py-3 text-white">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-sm font-semibold">CP</div>
          <div>
            <p className="text-sm font-semibold">Centro Médico Plaza (demo)</p>
            <p className="text-xs text-brand-100">{connected ? "en línea" : "desconectado"}</p>
          </div>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-4 text-sm">
          {lines.length === 0 && (
            <p className="mx-auto mt-16 max-w-sm text-center text-brand-900/50">
              Tocá “Empezar conversación”. Sofi tiene acceso a la agenda real de la clínica demo: si reservás un turno, lo vas
              a ver en el panel.
            </p>
          )}
          {lines.map((line) =>
            line.role === "system" ? (
              <p key={line.id} className="text-center text-xs text-brand-900/50">
                {line.text}
              </p>
            ) : (
              <p
                key={line.id}
                className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 shadow-sm ${
                  line.role === "user" ? "ml-auto rounded-tr-none bg-[#d9fdd3]" : "rounded-tl-none bg-white"
                }`}
              >
                {line.text}
              </p>
            ),
          )}
          <div ref={bottomRef} />
        </div>
        {mode === "chat" && (
          <form onSubmit={send} className="flex gap-2 bg-white/70 p-3">
            <input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (connected) conversation.sendUserActivity();
              }}
              disabled={!connected}
              placeholder={connected ? "Escribí un mensaje" : "Empezá la conversación para escribir"}
              className="flex-1 rounded-full border border-brand-900/10 bg-white px-4 py-2 outline-none focus:border-brand-500"
            />
            <button type="submit" disabled={!connected || !draft.trim()} className="rounded-full bg-brand-600 px-5 font-semibold text-white disabled:opacity-50">
              Enviar
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
