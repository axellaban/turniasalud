"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { Icono } from "@/components/site/iconos";
import { requestMicrophone } from "@/lib/microphone";
import type { WebDemoMode, WebDemoState } from "@/lib/demo/web";

// Demo en el navegador: espera a que se lea la web y después deja chatear o
// hablar con el agente como si fuera un paciente de esa clínica.

/** Cada cuánto se consulta el estado mientras se lee la web. */
const POLL_MS = 3000;
/** La lectura tarda ~1 minuto; pasado este plazo se da por fallida. */
const GIVE_UP_MS = 5 * 60_000;

type Line = { id: number; role: "user" | "agent" | "system"; text: string };
type Credential = { token?: string; signedUrl?: string; dynamicVariables: Record<string, string>; userId: string; error?: string };

export function DemoNavegador({ token }: { token: string }) {
  const [state, setState] = useState<WebDemoState | null>(null);
  const [missing, setMissing] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    async function poll() {
      const res = await fetch(`/api/demo/web/${token}`, { cache: "no-store" }).catch(() => null);
      if (stop) return;
      if (res?.status === 404) return setMissing(true);
      const next = res?.ok ? ((await res.json()) as WebDemoState) : null;
      if (stop) return;
      if (next) setState(next);
      if (next && next.status !== "analizando") return;
      if (Date.now() - started > GIVE_UP_MS) return setTimedOut(true);
      timer = setTimeout(poll, POLL_MS);
    }
    poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [token]);

  if (missing || state?.status === "terminada") {
    return (
      <Aviso titulo="Esta demo ya no está disponible">
        Las demos duran 24 horas. Podés armar otra con tu web en un minuto.
      </Aviso>
    );
  }
  if (timedOut || state?.status === "error") {
    return (
      <Aviso titulo={`No pudimos leer ${state ? hostOf(state.website) : "tu web"}`}>
        Puede que la página no responda o que no muestre texto que podamos leer. Revisá la dirección o probá con otra.
      </Aviso>
    );
  }
  if (!state || state.status === "analizando") return <Leyendo website={state?.website ?? null} />;
  return (
    <ConversationProvider>
      <Lista token={token} state={state} />
    </ConversationProvider>
  );
}

function hostOf(website: string): string {
  try {
    return new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return website;
  }
}

function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[560px] py-10 text-center">
      <h1 className="text-[32px] font-medium leading-tight tracking-tight text-brand-950 sm:text-[40px]">{titulo}</h1>
      <p className="mt-4 text-[17px] leading-relaxed text-tinta">{children}</p>
      <Link href="/probar-demo" className="mt-8 inline-flex rounded-lg bg-brand-600 px-5 py-3 text-sm font-medium text-white hover:bg-brand-700">
        Probar con otra web
      </Link>
    </div>
  );
}

const PASOS = ["Leemos las páginas de tu web", "Armamos la ficha: profesionales, prestaciones y horarios", "Preparamos a tu recepcionista"];

function Leyendo({ website }: { website: string | null }) {
  // Avanza solo para mostrar progreso: el estado real llega al consultar el servidor.
  const [paso, setPaso] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPaso((p) => Math.min(PASOS.length - 1, p + 1)), 18_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="mx-auto max-w-[560px] py-10 text-center">
      <h1 className="text-[32px] font-medium leading-tight tracking-tight text-brand-950 sm:text-[40px]">
        Preparando tu demo{website ? ` con ${hostOf(website)}` : ""}…
      </h1>
      <p className="mt-4 text-[17px] leading-relaxed text-tinta">Tarda alrededor de un minuto. No cierres esta página.</p>
      <ol className="mx-auto mt-10 max-w-sm space-y-4 text-left" aria-live="polite">
        {PASOS.map((p, i) => (
          <li key={p} className="flex items-center gap-3">
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                i < paso ? "bg-brand-600 text-white" : i === paso ? "bg-brand-100 text-brand-700 ring-2 ring-brand-600" : "bg-white text-brand-900/65 ring-1 ring-brand-950/10"
              }`}
            >
              {i < paso ? "✓" : i + 1}
            </span>
            <span className={`text-[15px] ${i <= paso ? "font-medium text-brand-950" : "text-tinta"}`}>{p}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const IDEAS = [
  "Quiero sacar un turno para la semana que viene",
  "¿Atienden por obra social?",
  "¿Dónde quedan y en qué horario atienden?",
  "Necesito cancelar mi turno",
];

function Lista({ token, state }: { token: string; state: Extract<WebDemoState, { status: "lista" }> }) {
  const { clinic } = state;
  const [mode, setMode] = useState<WebDemoMode>("chat");
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [remaining, setRemaining] = useState(state.remaining);
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
    onError: (message) => setError(typeof message === "string" ? message : "Se cortó la conversación."),
    onDisconnect: () => push("system", "Conversación terminada."),
  });
  const connected = conversation.status === "connected";
  const connecting = conversation.status === "connecting" || loading;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [lines]);

  async function start(first?: string) {
    setError(null);
    setLines([]);
    setLoading(true);
    try {
      if (mode === "voz") await requestMicrophone();
      const res = await fetch(`/api/demo/web/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const info = (await res.json()) as Credential;
      if (!res.ok) throw new Error(info.error || "No se pudo iniciar la conversación.");
      setRemaining((r) => Math.max(0, r - 1));
      await conversation.startSession({
        ...(mode === "chat" ? { signedUrl: info.signedUrl!, textOnly: true } : { conversationToken: info.token! }),
        dynamicVariables: info.dynamicVariables,
        userId: info.userId,
      });
      if (first && mode === "chat") {
        conversation.sendUserMessage(first);
        push("user", first);
      }
    } catch (e) {
      const permiso = e instanceof DOMException && e.name === "NotAllowedError";
      setError(permiso ? "Necesitamos permiso para usar el micrófono." : e instanceof Error ? e.message : "No se pudo iniciar la conversación.");
      // Lo que escribió no se pierde: queda en el campo para reintentar.
      if (first) setDraft(first);
    } finally {
      setLoading(false);
    }
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    if (!connected) return void start(text);
    conversation.sendUserMessage(text);
    push("user", text);
  }

  const agent = clinic.agentName;
  return (
    <div>
      <h1 className="text-[30px] font-medium leading-tight tracking-tight text-brand-950 sm:text-[40px]">
        {agent} ya atiende como la recepción de <span className="text-brand-600">{clinic.name}</span>
      </h1>
      <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-tinta">
        Escribile o hablale como si fueras un paciente. Los turnos que reserves son de prueba y no llegan a tu agenda real.
      </p>

      <div className="mt-8 grid gap-5 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-brand-950/5">
          <div>
            <p className="text-sm font-semibold text-brand-950">Lo que leímos de tu web</p>
            <dl className="mt-3 space-y-3 text-sm">
              <div>
                <dt className="text-brand-900/65">Especialidad</dt>
                <dd className="font-medium text-brand-950">{clinic.specialty}</dd>
              </div>
              {clinic.address && (
                <div>
                  <dt className="text-brand-900/65">Dirección</dt>
                  <dd className="font-medium text-brand-950">{clinic.address}</dd>
                </div>
              )}
              {clinic.professionals.length > 0 && (
                <div>
                  <dt className="text-brand-900/65">Profesionales</dt>
                  <dd className="font-medium text-brand-950">{clinic.professionals.join(", ")}</dd>
                </div>
              )}
              {clinic.types.length > 0 && (
                <div>
                  <dt className="text-brand-900/65">Turnos que puede dar</dt>
                  <dd className="font-medium text-brand-950">{clinic.types.join(", ")}</dd>
                </div>
              )}
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-tinta">
              Lo que tu web no dice (horarios, coberturas) se completa con datos de prueba. En tu cuenta lo cargás vos.
            </p>
          </div>
          <div className="border-t border-brand-950/5 pt-4">
            <p className="text-sm font-semibold text-brand-950">Probá con</p>
            <ul className="mt-2 space-y-1.5">
              {IDEAS.map((idea) => (
                <li key={idea}>
                  <button
                    type="button"
                    disabled={mode !== "chat" || connecting}
                    onClick={() => (connected ? (conversation.sendUserMessage(idea), push("user", idea)) : start(idea))}
                    className="w-full rounded-lg bg-brand-50 px-3 py-2 text-left text-sm text-brand-800 hover:bg-brand-100 disabled:opacity-60"
                  >
                    «{idea}»
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* En el celular la conversación va primero; la ficha y los ejemplos, debajo. */}
        <section className="flex min-h-[440px] flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-brand-950/5 max-lg:order-first lg:min-h-[520px]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-950/5 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-white">
                <Icono nombre={mode === "chat" ? "chat" : "telefono"} className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-brand-950">{clinic.name}</p>
                <p className="text-xs text-tinta">{connected ? `${agent} · en línea` : `${agent} · recepcionista virtual`}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-brand-50 p-1 text-sm" role="group" aria-label="Cómo querés probarlo">
              {(["chat", "voz"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  disabled={connected || connecting}
                  onClick={() => setMode(m)}
                  className={`rounded-md px-3 py-1.5 font-medium ${mode === m ? "bg-white text-brand-800 shadow-sm" : "text-brand-700 hover:text-brand-900"}`}
                >
                  {m === "chat" ? "Chat" : "Voz"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto bg-[#f5f7fc] p-4 text-[15px]" aria-live="polite">
            {lines.length === 0 && (
              <div className="mx-auto mt-14 max-w-sm text-center text-tinta">
                {mode === "chat" ? (
                  <p>Escribí abajo o tocá una de las frases de ejemplo para empezar.</p>
                ) : (
                  <>
                    <p>Tocá «Llamar» y hablale con el micrófono. Por ejemplo: «Hola, quiero un turno para la semana que viene».</p>
                    <button
                      type="button"
                      onClick={() => start()}
                      disabled={connecting}
                      className="mt-6 inline-flex items-center gap-2 rounded-full bg-brand-600 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                    >
                      <Icono nombre="telefono" className="h-4 w-4" /> {connecting ? "Conectando…" : "Llamar"}
                    </button>
                  </>
                )}
              </div>
            )}
            {lines.map((line) =>
              line.role === "system" ? (
                <p key={line.id} className="text-center text-xs text-tinta">
                  {line.text}
                </p>
              ) : (
                <p
                  key={line.id}
                  className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 ${
                    line.role === "user" ? "ml-auto rounded-br-md bg-brand-600 text-white" : "rounded-bl-md bg-white text-brand-950 ring-1 ring-brand-950/5"
                  }`}
                >
                  {line.text}
                </p>
              ),
            )}
            {mode === "voz" && connected && (
              <p className="text-center text-sm font-medium text-brand-700">{conversation.isSpeaking ? `${agent} está hablando…` : "Te escucho…"}</p>
            )}
            <div ref={bottomRef} />
          </div>

          {error && (
            <p role="alert" className="mx-4 mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}

          {mode === "chat" ? (
            <form onSubmit={send} className="flex gap-2 border-t border-brand-950/5 p-3">
              <label htmlFor="mensaje" className="sr-only">
                Mensaje para {agent}
              </label>
              <input
                id="mensaje"
                value={draft}
                autoComplete="off"
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (connected) conversation.sendUserActivity();
                }}
                disabled={connecting}
                placeholder="Escribí como si fueras un paciente…"
                className="min-w-0 flex-1 rounded-full bg-[#f5f7fc] px-4 py-2.5 text-[16px] text-brand-950 outline-none ring-1 ring-brand-950/10 placeholder:text-tinta/85 focus:ring-2 focus:ring-brand-600"
              />
              <button type="submit" disabled={connecting || !draft.trim()} className="rounded-full bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
                {connecting ? "Conectando…" : "Enviar"}
              </button>
            </form>
          ) : (
            connected && (
              <div className="border-t border-brand-950/5 p-3 text-center">
                <button type="button" onClick={() => conversation.endSession()} className="rounded-full bg-red-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-red-700">
                  Cortar
                </button>
              </div>
            )
          )}
        </section>
      </div>

      <div className="mt-6 flex flex-col gap-3 text-sm text-tinta sm:flex-row sm:items-center sm:justify-between">
        <p>
          {remaining > 0 ? `Te quedan ${remaining} conversaciones en esta demo.` : "Usaste todas las conversaciones de esta demo."}
          {connected && (
            <>
              {" "}
              <button type="button" onClick={() => conversation.endSession()} className="font-medium text-brand-600 hover:underline">
                Terminar la conversación
              </button>
            </>
          )}
        </p>
        <p>
          ¿Querés usarlo con tu agenda real?{" "}
          <Link href="/pedi-una-demo" className="font-medium text-brand-600 hover:underline">
            Pedí una demo guiada
          </Link>
        </p>
      </div>
    </div>
  );
}
