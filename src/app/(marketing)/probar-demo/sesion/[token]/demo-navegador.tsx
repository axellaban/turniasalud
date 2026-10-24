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
      state?.nombre ? (
        <Aviso titulo="No pudimos preparar la demo">Probá de nuevo en un rato o armala con la web del consultorio.</Aviso>
      ) : (
        <Aviso titulo={`No pudimos leer ${state ? hostOf(state.website) : "tu web"}`}>
          Puede que la página no responda o que no muestre texto que podamos leer. Revisá la dirección o probá con otra.
        </Aviso>
      )
    );
  }
  if (!state || state.status === "analizando") return <Leyendo website={state?.website || null} nombre={state?.nombre ?? null} />;
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

const PASOS = [
  { t: "Leemos las páginas de tu web", d: "Inicio, equipo, servicios y contacto" },
  { t: "Armamos la ficha de tu consultorio", d: "Profesionales, prestaciones, dirección y horarios" },
  { t: "Preparamos a tu recepcionista 24/7", d: "Con tus datos, lista para chat y voz" },
];
/** Cuándo pasa a cada paso (segundos). Es una guía visual: el estado real llega al consultar el servidor. */
const PASO_EN = [0, 6, 14];
const BUSCA = ["Profesionales", "Prestaciones", "Horarios", "Coberturas", "Dirección"];
/** Datos de estudios publicados (los mismos de la home), para que la espera sume. */
const DATOS = [
  { v: "29,5%", t: "de los turnos que los pacientes sacan solos se piden con el consultorio cerrado.", f: "JMIR Medical Informatics, 2021" },
  { v: "23%", t: "de los turnos se pierden en promedio porque el paciente no se presenta.", f: "Health Policy, 2018" },
  { v: "−29%", t: "de ausencias cuando el paciente recibe recordatorios automáticos.", f: "J Telemed Telecare, 2011" },
];

const CSS_LEYENDO = `
@keyframes turnia-escaneo { 0% { transform: translateY(-100%) } 100% { transform: translateY(520%) } }
@keyframes turnia-escribe { 0%, 80%, 100% { opacity: .25; transform: translateY(0) } 40% { opacity: 1; transform: translateY(-2px) } }
@keyframes turnia-gira { to { transform: rotate(360deg) } }
.turnia-escaneo { animation: turnia-escaneo 2.6s cubic-bezier(.45,0,.55,1) infinite }
.turnia-escribe span { animation: turnia-escribe 1.2s ease-in-out infinite }
.turnia-escribe span:nth-child(2) { animation-delay: .15s }
.turnia-escribe span:nth-child(3) { animation-delay: .3s }
.turnia-gira { animation: turnia-gira .9s linear infinite }
`;

function Leyendo({ website, nombre }: { website: string | null; nombre: string | null }) {
  const [segundos, setSegundos] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSegundos((s) => s + 0.5), 500);
    return () => clearInterval(t);
  }, []);
  const paso = PASO_EN.filter((desde) => segundos >= desde).length - 1;
  // Se acerca al 95 % sin llegar: el 100 % es la página lista.
  const avance = Math.round(95 * (1 - Math.exp(-segundos / 12)));
  // Sin web, la página muestra el nombre del consultorio en lugar de la dirección.
  const host = nombre ?? (website ? hostOf(website) : "tu web");
  const dato = DATOS[Math.floor(segundos / 7) % DATOS.length];
  const buscando = Math.floor(segundos / 1.5) % BUSCA.length;

  return (
    <div className="grid items-center gap-10 py-6 md:grid-cols-[1fr_1.05fr] md:py-10">
      <style>{CSS_LEYENDO}</style>
      <div>
        <p className="inline-flex max-w-full items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-brand-800 shadow-sm ring-1 ring-brand-950/5">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald" />
          </span>
          <span className="truncate">Demo en vivo · {host}</span>
        </p>
        <h1 className="mt-5 text-[34px] font-medium leading-[1.08] tracking-tight text-brand-950 sm:text-[46px]">
          Tu recepcionista 24/7 <span className="text-brand-600">está casi lista</span>
        </h1>
        <p className="mt-4 max-w-md text-[17px] leading-relaxed text-tinta">
          {nombre ? "Estamos preparando la recepción de " : "Estamos leyendo "}
          <span className="font-medium text-brand-950">{host}</span> para que Sofi atienda como tu consultorio. Tarda alrededor de un minuto: no
          cierres esta página.
        </p>

        <div className="mt-8 max-w-md" role="progressbar" aria-label="Preparando la demo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={avance}>
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium text-brand-950">{PASOS[paso].t}…</span>
            <span className="tabular-nums text-tinta">{avance}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-brand-100">
            <div className="h-full rounded-full bg-gradient-to-r from-brand-600 to-[#5b8cff] transition-[width] duration-500 ease-out" style={{ width: `${avance}%` }} />
          </div>
        </div>

        <ol className="mt-8 max-w-md space-y-5" aria-live="polite">
          {PASOS.map((p, i) => {
            const hecho = i < paso;
            const actual = i === paso;
            return (
              <li key={p.t} className="flex items-start gap-3">
                <span
                  className={`relative mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                    hecho ? "bg-brand-600 text-white" : actual ? "bg-white text-brand-700" : "bg-white text-brand-900/65 ring-1 ring-brand-950/10"
                  }`}
                >
                  {actual && <span className="turnia-gira absolute inset-0 rounded-full border-2 border-brand-100 border-t-brand-600" aria-hidden="true" />}
                  {hecho ? (
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" className="h-4 w-4" aria-hidden="true">
                      <path d="M5 10.5 8.5 14 15 6.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span>
                  <span className={`block text-[15px] ${hecho || actual ? "font-semibold text-brand-950" : "font-medium text-tinta"}`}>{p.t}</span>
                  <span className="mt-0.5 block text-sm text-tinta">{hecho ? "Listo" : p.d}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div aria-hidden="true" className="relative mx-auto w-full max-w-[520px]">
        {/* La web del consultorio, leída por Turnia. */}
        <div className="overflow-hidden rounded-2xl bg-white shadow-[0_24px_70px_rgb(8_24_63/0.14)] ring-1 ring-brand-950/5">
          <div className="flex items-center gap-3 border-b border-brand-950/5 bg-[#f7f8fc] px-4 py-3">
            <span className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff6159]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs text-tinta ring-1 ring-brand-950/5">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3 w-3 shrink-0">
                <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
                <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
              </svg>
              <span className="truncate">{host}</span>
            </span>
          </div>
          <div className="relative overflow-hidden p-5 pb-20">
            <div className="turnia-escaneo pointer-events-none absolute inset-x-0 top-0 h-1/5 bg-gradient-to-b from-transparent via-brand-500/15 to-transparent" />
            <div className="h-28 rounded-xl bg-gradient-to-br from-brand-50 to-[#eef6ff]" />
            <div className="mt-4 h-3 w-2/3 rounded-full bg-brand-950/10" />
            <div className="mt-2 h-3 w-1/2 rounded-full bg-brand-950/[0.06]" />
            <div className="mt-5 grid grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-lg bg-brand-950/[0.04] p-3">
                  <div className="h-6 w-6 rounded-full bg-brand-950/10" />
                  <div className="mt-2 h-2 w-full rounded-full bg-brand-950/[0.08]" />
                  <div className="mt-1.5 h-2 w-2/3 rounded-full bg-brand-950/[0.06]" />
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {BUSCA.map((b, i) => (
                <span
                  key={b}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors duration-300 ${
                    i === buscando ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-700"
                  }`}
                >
                  {b}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Sofi, del otro lado, aprendiendo. */}
        <div className="absolute -bottom-6 -left-3 flex max-w-[290px] items-center gap-3 rounded-2xl bg-white p-3 pr-4 shadow-[0_16px_40px_rgb(8_24_63/0.16)] ring-1 ring-brand-950/5 sm:-left-8">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white">S</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-brand-950">Sofi</span>
            <span className="flex items-center gap-1.5 text-xs text-tinta">
              Aprendiendo sobre tu consultorio
              <span className="turnia-escribe inline-flex gap-0.5">
                <span className="h-1 w-1 rounded-full bg-tinta" />
                <span className="h-1 w-1 rounded-full bg-tinta" />
                <span className="h-1 w-1 rounded-full bg-tinta" />
              </span>
            </span>
          </span>
        </div>
      </div>

      <figure className="mt-6 rounded-2xl bg-white/70 p-5 ring-1 ring-brand-950/5 md:col-span-2 md:mt-8">
        <figcaption className="text-xs font-medium text-tinta">Mientras tanto, un dato</figcaption>
        <p key={dato.v} className="animar-aparecer mt-2 text-[15px] leading-relaxed text-brand-950">
          <span className="mr-1.5 text-xl font-semibold tracking-tight text-brand-600 tabular-nums">{dato.v}</span>
          {dato.t} <span className="whitespace-nowrap text-xs text-tinta">· {dato.f}</span>
        </p>
      </figure>
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

  // El primer mensaje se manda recién cuando el SDK ya tiene la conversación activa:
  // justo después de startSession todavía rechaza sendUserMessage.
  const pendiente = useRef<string | null>(null);
  useEffect(() => {
    if (!connected || !pendiente.current) return;
    const text = pendiente.current;
    pendiente.current = null;
    conversation.sendUserMessage(text);
    push("user", text);
  }, [connected, conversation, push]);

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
      pendiente.current = first && mode === "chat" ? first : null;
      await conversation.startSession({
        ...(mode === "chat" ? { signedUrl: info.signedUrl!, textOnly: true } : { conversationToken: info.token! }),
        dynamicVariables: info.dynamicVariables,
        userId: info.userId,
      });
    } catch (e) {
      pendiente.current = null;
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
                  <p>Tocá «Llamar» y hablale con el micrófono. Por ejemplo: «Hola, quiero un turno para la semana que viene».</p>
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
            <div className="border-t border-brand-950/5 p-3 text-center">
              {connected ? (
                <button type="button" onClick={() => conversation.endSession()} className="rounded-full bg-red-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-red-700">
                  Cortar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => start()}
                  disabled={connecting}
                  className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  <Icono nombre="telefono" className="h-4 w-4" /> {connecting ? "Conectando…" : "Llamar"}
                </button>
              )}
            </div>
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
