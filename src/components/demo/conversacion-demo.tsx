"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConversation } from "@elevenlabs/react";
import { Chevron, Icono } from "@/components/site/iconos";
import { track, trackMilestone } from "@/lib/analytics";
import { requestMicrophone } from "@/lib/microphone";
import { OrbeVoz } from "./orbe-voz";

type Line = { id: number; role: "user" | "agent" | "system"; text: string };

/** La hora, para medir cada conversación (PostHog). */
const ahora = () => Date.now();

const IDEAS = [
  "Quiero sacar un turno para la semana que viene",
  "¿Atienden por obra social?",
  "¿Dónde quedan y en qué horario atienden?",
  "Necesito cancelar mi turno",
];

/** Lo que se muestra de la clínica: su ficha al costado y su nombre en la conversación. */
export type DemoClinic = { name: string; agentName: string; specialty: string; address: string | null; professionals: string[]; types: string[] };
type Clinic = DemoClinic;
export type DemoMode = "chat" | "voz";
export type DemoCredential = {
  token?: string;
  signedUrl?: string;
  /** El agente puede arrancar sin su saludo: en el chat contesta una vez al primer mensaje. */
  sinSaludo?: boolean;
  dynamicVariables: Record<string, string>;
  userId: string;
};

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-brand-900/65">{titulo}</dt>
      <dd className="mt-0.5 font-medium text-brand-950">{children}</dd>
    </div>
  );
}

/** La ficha del consultorio: al costado en la computadora; en el celular, en una hoja que sube desde abajo. */
function Ficha({ clinic, nota }: { clinic: Clinic; nota: string }) {
  return (
    <>
      <dl className="space-y-2.5 text-sm">
        <Dato titulo="Especialidad">{clinic.specialty}</Dato>
        {clinic.address && <Dato titulo="Dirección">{clinic.address}</Dato>}
        {clinic.professionals.length > 0 && <Dato titulo="Profesionales">{clinic.professionals.join(", ")}</Dato>}
        {clinic.types.length > 0 && (
          <div>
            <dt className="text-xs text-brand-900/65">Turnos que puede dar</dt>
            <dd className="mt-1.5 flex flex-wrap gap-1.5">
              {clinic.types.map((t) => (
                <span key={t} className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800">
                  {t}
                </span>
              ))}
            </dd>
          </div>
        )}
      </dl>
      {nota && <p className="mt-3 text-xs leading-relaxed text-tinta">{nota}</p>}
    </>
  );
}

/**
 * La conversación con el agente en el navegador, por voz (con la esfera) o por chat,
 * con la ficha de la clínica al costado. La usan /probar-demo (clínica armada con la
 * web del interesado) y /demo (la clínica elegida en el panel).
 */
export function ConversacionDemo({
  clinic,
  titulo,
  bajada,
  tituloFicha,
  notaFicha,
  pedirCredencial,
  remaining: initialRemaining,
  extraFicha,
  extraBoton,
  cta,
}: {
  clinic: DemoClinic;
  titulo: React.ReactNode;
  bajada: string;
  tituloFicha: string;
  notaFicha: string;
  /** Pide la credencial de ElevenLabs para una conversación nueva. Si falla, tira un Error con el motivo. */
  pedirCredencial: (mode: DemoMode) => Promise<DemoCredential>;
  /** Conversaciones que le quedan (sin límite si no se pasa). */
  remaining?: number;
  /** Algo más debajo de la ficha (por ejemplo, con qué teléfono probar). */
  extraFicha?: React.ReactNode;
  /** En el celular, un botón propio que abre la hoja con extraFicha arriba y su campo listo para escribir. */
  extraBoton?: string;
  /** El llamado al costado del título y al pie de la ficha en el celular. */
  cta?: React.ReactNode;
}) {
  // Arranca en voz: es lo que más impresiona. El chat queda a un toque.
  const [mode, setMode] = useState<DemoMode>("voz");
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [remaining, setRemaining] = useState(initialRemaining);
  const counter = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const fichaRef = useRef<HTMLDialogElement>(null);
  const extraRef = useRef<HTMLDivElement>(null);

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

  // PostHog: cada conversación de punta a punta (modo, duración y cuántos mensajes), nunca el texto.
  const charla = useRef<{ mode: DemoMode; startedAt: number; user: number; agent: number } | null>(null);
  const terminarCharla = useCallback((reason: string, beacon = false) => {
    const c = charla.current;
    if (!c) return;
    charla.current = null;
    track(
      "demo_conversation_ended",
      { mode: c.mode, duration_ms: Math.min(Date.now() - c.startedAt, 3_600_000), user_messages: c.user, agent_messages: c.agent, end_reason: reason },
      beacon,
    );
  }, []);
  useEffect(() => {
    const salir = () => terminarCharla("pagehide", true);
    window.addEventListener("pagehide", salir);
    return () => {
      window.removeEventListener("pagehide", salir);
      terminarCharla("unmount");
    };
  }, [terminarCharla]);

  const conversation = useConversation({
    onMessage: (m) => {
      if (!m.message?.trim()) return;
      const c = charla.current;
      // En chat, lo que escribe se cuenta al mandarlo: el SDK puede repetirlo acá.
      if (c && m.role === "agent") c.agent += 1;
      else if (c && c.mode === "voz") c.user += 1;
      push(m.role === "agent" ? "agent" : "user", m.message);
    },
    onError: (message) => {
      if (charla.current) track("demo_conversation_error", { mode: charla.current.mode });
      setError(typeof message === "string" ? message : "Se cortó la conversación.");
    },
    onDisconnect: () => {
      terminarCharla("disconnect");
      push("system", "Conversación terminada.");
    },
  });
  const connected = conversation.status === "connected";
  const connecting = conversation.status === "connecting" || loading;
  // Para que la esfera siga la voz: la de Sofi cuando habla, la del micrófono cuando escucha.
  const { getInputVolume, getOutputVolume } = conversation;

  // El primer mensaje se manda recién cuando el SDK ya tiene la conversación activa:
  // justo después de startSession todavía rechaza sendUserMessage.
  const pendiente = useRef<string | null>(null);
  useEffect(() => {
    if (!connected || !pendiente.current) return;
    const text = pendiente.current;
    pendiente.current = null;
    if (charla.current) charla.current.user += 1;
    conversation.sendUserMessage(text);
    push("user", text);
  }, [connected, conversation, push]);

  // Baja hasta el último mensaje dentro de la conversación, sin mover la página.
  useEffect(() => {
    const list = listRef.current;
    if (list && lines.length > 0) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [lines]);

  async function start(first?: string) {
    setError(null);
    setLines([]);
    setLoading(true);
    try {
      if (mode === "voz") await requestMicrophone();
      const info = await pedirCredencial(mode);
      setRemaining((r) => (r === undefined ? r : Math.max(0, r - 1)));
      pendiente.current = first && mode === "chat" ? first : null;
      await conversation.startSession({
        ...(mode === "chat" ? { signedUrl: info.signedUrl!, textOnly: true } : { conversationToken: info.token! }),
        // En el chat escribe primero el paciente: sin el saludo fijo, la primera respuesta saluda y contesta.
        ...(mode === "chat" && first && info.sinSaludo ? { overrides: { agent: { firstMessage: "" } } } : {}),
        dynamicVariables: info.dynamicVariables,
        userId: info.userId,
      });
      charla.current = { mode, startedAt: ahora(), user: 0, agent: 0 };
      track("demo_conversation_started", { mode, with_suggestion: Boolean(first), ...(remaining === undefined ? {} : { remaining: remaining - 1 }) });
      trackMilestone("first_demo_conversation", { mode });
    } catch (e) {
      pendiente.current = null;
      const microfono = e instanceof DOMException ? e.name : "";
      track("demo_conversation_failed", {
        mode,
        error_kind: microfono === "NotAllowedError" ? "mic_denied" : microfono === "NotFoundError" || microfono === "NotReadableError" ? "mic_missing" : "start_error",
      });
      setError(
        microfono === "NotAllowedError"
          ? "Necesitamos permiso para usar el micrófono. Si preferís, probala por chat."
          : microfono === "NotFoundError" || microfono === "NotReadableError"
            ? "No encontramos un micrófono disponible. Conectá uno o probala por chat."
            : e instanceof Error
              ? e.message
              : "No se pudo iniciar la conversación.",
      );
      // Lo que escribió no se pierde: queda en el campo para reintentar.
      if (first) setDraft(first);
    } finally {
      setLoading(false);
    }
  }

  function decir(text: string, sugerencia?: number) {
    if (sugerencia !== undefined) track("demo_suggestion_used", { suggestion: sugerencia, mode, connected });
    if (!connected) return void start(text);
    if (charla.current) charla.current.user += 1;
    conversation.sendUserMessage(text);
    push("user", text);
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    decir(text);
  }

  const agent = clinic.agentName;
  const voz = mode === "voz";
  // En el celular, apenas empieza la charla, el título se guarda (queda para lectores de pantalla) y la conversación gana lugar.
  // Lo mismo en pantallas muy bajas (celular apaisado o con el teclado abierto).
  const enCharla = lines.length > 0;
  const burbujas = lines.map((line) =>
    line.role === "system" ? (
      <p key={line.id} className="text-center text-xs text-tinta">
        {line.text}
      </p>
    ) : (
      <p
        key={line.id}
        className={`w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 ${
          line.role === "user" ? "ml-auto rounded-br-md bg-brand-600 text-white" : "rounded-bl-md bg-white text-brand-950 ring-1 ring-brand-950/5"
        }`}
      >
        {line.text}
      </p>
    ),
  );
  return (
    // Alto fijo de pantalla: el título y la conversación entran enteros y los mensajes se desplazan adentro.
    <div className="flex h-[calc(100dvh-4.5rem)] min-h-[280px] flex-col py-3 sm:py-5 [@media(max-height:500px)]:py-2">
      <div className="shrink-0 lg:flex lg:items-end lg:justify-between lg:gap-8">
        <div className="min-w-0">
          <h1 className={`text-[22px] font-medium leading-tight tracking-tight text-brand-950 sm:text-[28px] lg:text-[32px] [@media(max-height:500px)]:sr-only ${enCharla ? "max-sm:sr-only" : ""}`}>
            {titulo}
          </h1>
          <p className="mt-1.5 text-[15px] leading-relaxed text-tinta max-sm:hidden [@media(max-height:500px)]:hidden">
            {bajada}
          </p>
        </div>
        {cta && <p className="shrink-0 pb-1 text-sm text-tinta max-lg:hidden">{cta}</p>}
        <div className="flex flex-wrap gap-x-2 lg:hidden">
          <button
            type="button"
            onClick={() => fichaRef.current?.showModal()}
            aria-haspopup="dialog"
            className={`inline-flex max-w-full items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-medium text-brand-800 shadow-sm ring-1 ring-brand-950/5 hover:bg-brand-50 lg:hidden [@media(max-height:500px)]:mt-0 ${enCharla ? "sm:mt-2.5" : "mt-2.5"}`}
          >
            <Icono nombre="web" className="h-4 w-4 shrink-0 text-brand-600" />
            <span className="truncate">{tituloFicha}</span>
            <Chevron className="h-3.5 w-3.5 shrink-0 -rotate-90" />
          </button>
          {extraFicha && extraBoton && (
            <button
              type="button"
              onClick={() => {
                fichaRef.current?.showModal();
                extraRef.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
              }}
              aria-haspopup="dialog"
              className={`inline-flex max-w-full items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-medium text-brand-800 shadow-sm ring-1 ring-brand-950/5 hover:bg-brand-50 lg:hidden [@media(max-height:500px)]:mt-0 ${enCharla ? "sm:mt-2.5" : "mt-2.5"}`}
            >
              <span className="truncate">{extraBoton}</span>
              <Chevron className="h-3.5 w-3.5 shrink-0 -rotate-90" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 grid min-h-0 flex-1 gap-5 sm:mt-4 lg:grid-cols-[340px_1fr]">
        <aside className="flex min-h-0 flex-col overflow-y-auto overscroll-contain rounded-2xl bg-white p-5 shadow-sm ring-1 ring-brand-950/5 max-lg:hidden">
          <h2 className="mb-3 text-sm font-semibold text-brand-950">{tituloFicha}</h2>
          <Ficha clinic={clinic} nota={notaFicha} />
          {extraFicha && <div className="mt-4 border-t border-brand-950/5 pt-4">{extraFicha}</div>}
          <div className="mt-4 border-t border-brand-950/5 pt-4">
            <h2 className="text-sm font-semibold text-brand-950">{voz ? "Decile, por ejemplo" : "Probá con"}</h2>
            {/* En el chat se tocan para mandarlas; en la voz son ideas de qué decir. */}
            <ul className="mt-2 space-y-1.5">
              {IDEAS.map((idea) => (
                <li key={idea}>
                  {voz ? (
                    <p className="rounded-lg bg-brand-50/60 px-3 py-1.5 text-sm text-brand-800">«{idea}»</p>
                  ) : (
                    <button
                      type="button"
                      disabled={connecting}
                      onClick={() => decir(idea, IDEAS.indexOf(idea))}
                      className="w-full rounded-lg bg-brand-50 px-3 py-1.5 text-left text-sm text-brand-800 hover:bg-brand-100 disabled:opacity-60"
                    >
                      «{idea}»
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <section aria-label={`Conversación con ${agent}`} className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-brand-950/5">
          <div className="flex items-center justify-between gap-3 border-b border-brand-950/5 px-3 py-2.5 sm:px-4 sm:py-3">
            <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
              <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-white">
                <Icono nombre={voz ? "telefono" : "chat"} className="h-4 w-4" />
                {connected && <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald ring-2 ring-white" />}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-brand-950">{clinic.name}</p>
                <p className="truncate text-xs text-tinta">{connected ? `${agent} · en línea` : `${agent} · recepcionista virtual`}</p>
              </div>
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-1 rounded-lg bg-brand-50 p-1 text-sm" role="group" aria-label="Cómo querés probarlo">
              {(["voz", "chat"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  disabled={connected || connecting}
                  onClick={() => {
                    if (m !== mode) track("demo_mode_switched", { to: m });
                    setMode(m);
                  }}
                  className={`rounded-md px-3 py-1.5 font-medium ${mode === m ? "bg-white text-brand-800 shadow-sm" : "text-brand-700 hover:text-brand-900"}`}
                >
                  {m === "chat" ? "Chat" : "Voz"}
                </button>
              ))}
            </div>
          </div>

          {voz ? (
            // Llamada: la esfera en el centro (grande antes de hablar) y lo que se dice, debajo.
            <div
              className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
              style={{ background: "radial-gradient(70% 60% at 50% 42%, #e6ecff 0%, #f3f6ff 50%, #ffffff 100%)" }}
            >
              {/* Antes de hablar, la esfera se ajusta al alto que haya (container query); después, queda chica arriba. */}
              <div
                className={`flex flex-col items-center justify-center px-4 text-center ${
                  enCharla ? "shrink-0 pb-1 pt-7 [@media(max-height:500px)]:pt-4" : "min-h-0 flex-1 py-4 [container-type:size]"
                }`}
              >
                <div className="relative">
                  <OrbeVoz
                    estado={connecting ? "conectando" : connected ? (conversation.isSpeaking ? "habla" : "escucha") : "inactiva"}
                    leerVolumen={connected ? (conversation.isSpeaking ? getOutputVolume : getInputVolume) : undefined}
                    className={`transition-[width,height] duration-500 ${
                      enCharla
                        ? "h-20 w-20 sm:h-28 sm:w-28 [@media(max-height:500px)]:h-14 [@media(max-height:500px)]:w-14"
                        : "h-[min(12rem,46cqh)] w-[min(12rem,46cqh)]"
                    }`}
                  />
                  {/* Tocar la esfera también llama; el botón accesible es el de abajo. */}
                  {!connected && (
                    <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => start()} disabled={connecting} className="absolute inset-0 rounded-full" />
                  )}
                </div>
                <p className={`h-5 shrink-0 text-sm font-medium text-brand-800 [@media(max-height:500px)]:mt-3 ${enCharla ? "mt-5" : "mt-8"}`} aria-live="polite">
                  {connected
                    ? conversation.isMuted
                      ? "Micrófono silenciado"
                      : conversation.isSpeaking
                        ? `${agent} está hablando…`
                        : "Te escucho…"
                    : enCharla && !connecting
                      ? "Llamada terminada"
                      : ""}
                </p>
                {!enCharla && (
                  <p className="mt-2 max-w-xs text-sm leading-relaxed text-tinta [@container(max-height:240px)]:hidden">
                    Hablale como si fueras un paciente. Por ejemplo: «Hola, quiero un turno para la semana que viene».
                  </p>
                )}
              </div>
              {enCharla && (
                <div
                  ref={listRef}
                  aria-live="polite"
                  className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 pb-3 pt-4 text-[15px] [mask-image:linear-gradient(to_bottom,transparent,#000_24px)] sm:px-4"
                >
                  {burbujas}
                </div>
              )}
            </div>
          ) : (
            <div ref={listRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain bg-[#f5f7fc] p-3 text-[15px] sm:p-4">
              {lines.length === 0 && (
                  <div className="my-auto py-2 text-center">
                    <p className="mx-auto max-w-sm text-tinta max-lg:hidden">Escribí abajo o tocá una de las frases de ejemplo para empezar.</p>
                    {/* En pantallas muy bajas quedan solo las frases, para que entren todas. */}
                    <p className="mx-auto max-w-sm text-sm text-tinta lg:hidden [@media(max-height:600px)]:hidden">
                      Tocá una frase para empezar o escribí abajo. Los turnos que reserves son de prueba.
                    </p>
                    {/* En el celular, las frases de ejemplo van acá: no hay columna al costado. */}
                    <ul className="mt-3 flex flex-wrap justify-center gap-1.5 sm:gap-2 lg:hidden [@media(max-height:600px)]:mt-0">
                      {IDEAS.map((idea) => (
                        <li key={idea}>
                          <button
                            type="button"
                            disabled={connecting}
                            onClick={() => decir(idea, IDEAS.indexOf(idea))}
                            className="rounded-full bg-white px-3 py-1.5 text-left text-[13px] text-brand-800 shadow-sm ring-1 ring-brand-950/10 hover:bg-brand-50 disabled:opacity-60 sm:px-3.5 sm:py-2 sm:text-sm"
                          >
                            {idea}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
              )}
              <div className={lines.length > 0 ? "mt-auto space-y-2" : undefined} aria-live="polite">
                {burbujas}
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="mx-3 mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 sm:mx-4">
              {error}
            </p>
          )}

          {!voz ? (
            <form onSubmit={send} className="flex gap-2 p-3 pb-2">
              <label htmlFor="mensaje" className="sr-only">
                Mensaje para {agent}
              </label>
              <input
                id="mensaje"
                value={draft}
                autoComplete="off"
                enterKeyHint="send"
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (connected) conversation.sendUserActivity();
                }}
                disabled={connecting}
                placeholder={`Escribile a ${agent}…`}
                className="min-w-0 flex-1 rounded-full bg-[#f5f7fc] px-4 py-2.5 text-[16px] text-brand-950 outline-none ring-1 ring-brand-950/10 placeholder:text-tinta/85 focus:ring-2 focus:ring-brand-600"
              />
              <button type="submit" disabled={connecting || !draft.trim()} className="rounded-full bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
                {connecting ? "Conectando…" : "Enviar"}
              </button>
            </form>
          ) : (
            <div className="flex items-center justify-center gap-3 px-3 pb-2 pt-3 sm:px-4">
              {connected ? (
                <>
                  <button
                    type="button"
                    onClick={() => conversation.setMuted(!conversation.isMuted)}
                    aria-pressed={conversation.isMuted}
                    aria-label={conversation.isMuted ? "Activar el micrófono" : "Silenciar el micrófono"}
                    className={`grid h-11 w-11 place-items-center rounded-full ring-1 transition-colors ${
                      conversation.isMuted ? "bg-brand-950 text-white ring-brand-950" : "bg-white text-brand-950 ring-brand-950/10 hover:bg-brand-50"
                    }`}
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
                      <path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" />
                      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
                      {conversation.isMuted && <path d="M4 4l16 16" />}
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => conversation.endSession()}
                    className="inline-flex h-11 items-center gap-2 rounded-full bg-red-600 px-6 text-sm font-semibold text-white hover:bg-red-700"
                  >
                    <Icono nombre="telefono" className="h-4 w-4 rotate-[135deg]" /> Cortar
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => start()}
                  disabled={connecting}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-brand-600 px-6 text-sm font-semibold text-white shadow-[0_10px_24px_rgb(33_87_225/0.3)] hover:bg-brand-700 disabled:opacity-60"
                >
                  <Icono nombre="telefono" className="h-4 w-4" /> {connecting ? "Conectando…" : enCharla ? "Llamar de nuevo" : `Llamar a ${agent}`}
                </button>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 px-4 pb-2.5 pt-1 text-xs text-tinta">
            {/* En el celular, sin «en esta demo» ni «la conversación»: así entra en una línea. */}
            {remaining === undefined ? <span /> : (
              <p>
                {remaining === 1 ? "Te queda 1 conversación" : remaining > 0 ? `Te quedan ${remaining} conversaciones` : "Usaste todas las conversaciones"}
                <span className="max-sm:hidden"> de esta demo</span>.
              </p>
            )}
            {connected && !voz && (
              <button type="button" onClick={() => conversation.endSession()} className="shrink-0 font-medium text-brand-600 hover:underline">
                Terminar<span className="max-sm:hidden"> la conversación</span>
              </button>
            )}
          </div>
        </section>
      </div>

      {/* Celular: la ficha en una hoja que sube desde abajo. Se cierra con Esc, con la X o tocando afuera. */}
      <dialog
        ref={fichaRef}
        aria-labelledby="ficha-titulo"
        onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
        className="mx-0 mb-0 mt-auto max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-3xl bg-white shadow-2xl backdrop:bg-brand-950/40 lg:hidden"
      >
        <div className="animar-aparecer px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3" style={{ animationDuration: "0.25s" }}>
          <span aria-hidden="true" className="mx-auto block h-1 w-10 rounded-full bg-brand-950/15" />
          <div className="mt-2 flex items-center justify-between gap-3">
            <h2 id="ficha-titulo" className="text-base font-semibold text-brand-950">
              {tituloFicha}
            </h2>
            <button
              type="button"
              onClick={() => fichaRef.current?.close()}
              aria-label="Cerrar"
              className="-mr-2 grid h-10 w-10 place-items-center rounded-full text-brand-950 hover:bg-brand-50"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          {/* Arriba de la ficha: es lo que se completa; la ficha es para leer. */}
          {extraFicha && <div ref={extraRef} className="mt-3 border-b border-brand-950/5 pb-4">{extraFicha}</div>}
          <div className="mt-2">
            <Ficha clinic={clinic} nota={notaFicha} />
          </div>
          {cta && <p className="mt-5 border-t border-brand-950/5 pt-4 text-sm text-tinta">{cta}</p>}
        </div>
      </dialog>
    </div>
  );
}
