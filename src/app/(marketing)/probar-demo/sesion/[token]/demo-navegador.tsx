"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { Chevron, Icono } from "@/components/site/iconos";
import { requestMicrophone } from "@/lib/microphone";
import type { WebDemoMode, WebDemoState } from "@/lib/demo/web";
import { OrbeVoz } from "./orbe-voz";

// Demo en el navegador: espera a que se lea la web y después deja chatear o
// hablar con el agente como si fuera un paciente de esa clínica.

/** Cada cuánto se consulta el estado mientras se lee la web. */
const POLL_MS = 3000;
/** La lectura tarda ~1 minuto; pasado este plazo se da por fallida. */
const GIVE_UP_MS = 5 * 60_000;
// Cada estado ocupa la pantalla entera debajo del header fijo (4.5rem: 12 px de margen + barra de 60 px),
// así la demo se ve completa sin scroll en la computadora y en el celular.

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
    <div className="mx-auto flex min-h-[calc(100dvh-4.5rem)] max-w-[560px] flex-col items-center justify-center py-10 text-center">
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
    <div className="grid min-h-[calc(100dvh-4.5rem)] content-center items-center gap-x-12 gap-y-5 py-4 sm:py-6 md:grid-cols-[1fr_1.05fr] md:gap-y-10">
      <style>{CSS_LEYENDO}</style>
      <div>
        <p className="inline-flex max-w-full items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-brand-800 shadow-sm ring-1 ring-brand-950/5">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald" />
          </span>
          <span className="truncate">Demo en vivo · {host}</span>
        </p>
        <h1 className="mt-4 text-[30px] font-medium leading-[1.08] tracking-tight text-brand-950 sm:mt-5 sm:text-[40px] lg:text-[46px]">
          Tu recepcionista 24/7 <span className="text-brand-600">está casi lista</span>
        </h1>
        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-tinta sm:mt-4 sm:text-[17px]">
          {nombre ? "Estamos preparando la recepción de " : "Estamos leyendo "}
          <span className="font-medium text-brand-950">{host}</span> para que Sofi atienda como tu consultorio. Tarda alrededor de un minuto: no
          cierres esta página.
        </p>

        <div className="mt-6 max-w-md sm:mt-8" role="progressbar" aria-label="Preparando la demo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={avance}>
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium text-brand-950">{PASOS[paso].t}…</span>
            <span className="tabular-nums text-tinta">{avance}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-brand-100">
            <div className="h-full rounded-full bg-gradient-to-r from-brand-600 to-[#5b8cff] transition-[width] duration-500 ease-out" style={{ width: `${avance}%` }} />
          </div>
        </div>

        <ol className="mt-6 max-w-md space-y-2.5 sm:mt-8 sm:space-y-5" aria-live="polite">
          {PASOS.map((p, i) => {
            const hecho = i < paso;
            const actual = i === paso;
            return (
              <li key={p.t} className="flex items-center gap-3 sm:items-start">
                <span
                  className={`relative grid h-8 w-8 shrink-0 sm:mt-0.5 place-items-center rounded-full text-xs font-semibold ${
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
                  {/* En el celular, el detalle se omite para que la espera entre en una pantalla. */}
                  <span className="mt-0.5 block text-sm text-tinta max-sm:hidden">{hecho ? "Listo" : p.d}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="mx-auto w-full max-w-[520px]">
        {/* La web del consultorio, leída por Turnia. Es decorativa: en el celular no entra y se omite. */}
        <div aria-hidden="true" className="relative max-md:hidden">
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
            <div className="relative overflow-hidden p-5 pb-14">
              <div className="turnia-escaneo pointer-events-none absolute inset-x-0 top-0 h-1/5 bg-gradient-to-b from-transparent via-brand-500/15 to-transparent" />
              <div className="h-20 rounded-xl bg-gradient-to-br from-brand-50 to-[#eef6ff]" />
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

        {/* En pantallas muy bajas el dato se omite: la espera tiene que entrar sin scroll. */}
        <figure className="rounded-2xl bg-white/70 p-4 ring-1 ring-brand-950/5 md:mt-10 [@media(max-height:660px)]:hidden">
          <figcaption className="text-xs font-medium text-tinta">Mientras tanto, un dato</figcaption>
          <p key={dato.v} className="animar-aparecer mt-2 text-[15px] leading-relaxed text-brand-950">
            <span className="mr-1.5 text-xl font-semibold tracking-tight text-brand-600 tabular-nums">{dato.v}</span>
            {dato.t} <span className="whitespace-nowrap text-xs text-tinta">· {dato.f}</span>
          </p>
        </figure>
      </div>
    </div>
  );
}

const IDEAS = [
  "Quiero sacar un turno para la semana que viene",
  "¿Atienden por obra social?",
  "¿Dónde quedan y en qué horario atienden?",
  "Necesito cancelar mi turno",
];

type Clinic = Extract<WebDemoState, { status: "lista" }>["clinic"];

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-brand-900/65">{titulo}</dt>
      <dd className="mt-0.5 font-medium text-brand-950">{children}</dd>
    </div>
  );
}

/** La ficha del consultorio: al costado en la computadora; en el celular, en una hoja que sube desde abajo. */
function Ficha({ clinic, conWeb }: { clinic: Clinic; conWeb: boolean }) {
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
      <p className="mt-3 text-xs leading-relaxed text-tinta">
        {conWeb
          ? "Lo que tu web no dice (horarios, coberturas) es de prueba: en tu cuenta lo cargás vos."
          : "Los horarios y las coberturas son de prueba: en tu cuenta los cargás vos."}
      </p>
    </>
  );
}

function Lista({ token, state }: { token: string; state: Extract<WebDemoState, { status: "lista" }> }) {
  const { clinic } = state;
  const conWeb = Boolean(state.website);
  // Arranca en voz: es lo que más impresiona. El chat queda a un toque.
  const [mode, setMode] = useState<WebDemoMode>("voz");
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [remaining, setRemaining] = useState(state.remaining);
  const counter = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const fichaRef = useRef<HTMLDialogElement>(null);

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
  // Para que la esfera siga la voz: la de Sofi cuando habla, la del micrófono cuando escucha.
  const { getInputVolume, getOutputVolume } = conversation;

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
      const microfono = e instanceof DOMException ? e.name : "";
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

  function decir(text: string) {
    if (!connected) return void start(text);
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
  const tituloFicha = conWeb ? "Lo que leímos de tu web" : "La ficha de tu consultorio";
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
            {agent} ya atiende como la recepción de <span className="text-brand-600">{clinic.name}</span>
          </h1>
          <p className="mt-1.5 text-[15px] leading-relaxed text-tinta max-sm:hidden [@media(max-height:500px)]:hidden">
            Hablale o escribile como si fueras un paciente. Los turnos que reserves son de prueba y no llegan a tu agenda real.
          </p>
        </div>
        <p className="shrink-0 pb-1 text-sm text-tinta max-lg:hidden">
          ¿Lo querés con tu agenda real?{" "}
          <Link href="/pedi-una-demo" className="font-medium text-brand-600 hover:underline">
            Pedí una demo guiada
          </Link>
        </p>
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
      </div>

      <div className="mt-3 grid min-h-0 flex-1 gap-5 sm:mt-4 lg:grid-cols-[340px_1fr]">
        <aside className="flex min-h-0 flex-col overflow-y-auto overscroll-contain rounded-2xl bg-white p-5 shadow-sm ring-1 ring-brand-950/5 max-lg:hidden">
          <h2 className="mb-3 text-sm font-semibold text-brand-950">{tituloFicha}</h2>
          <Ficha clinic={clinic} conWeb={conWeb} />
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
                      onClick={() => decir(idea)}
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
                  onClick={() => setMode(m)}
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
                  enCharla ? "shrink-0 pb-1 pt-5 [@media(max-height:500px)]:pt-3" : "min-h-0 flex-1 py-4 [container-type:size]"
                }`}
              >
                <div className="relative">
                  <OrbeVoz
                    estado={connecting ? "conectando" : connected ? (conversation.isSpeaking ? "habla" : "escucha") : "inactiva"}
                    leerVolumen={connected ? (conversation.isSpeaking ? getOutputVolume : getInputVolume) : undefined}
                    className={`transition-[width,height] duration-500 ${
                      enCharla
                        ? "h-20 w-20 sm:h-28 sm:w-28 [@media(max-height:500px)]:h-14 [@media(max-height:500px)]:w-14"
                        : "h-[min(12rem,50cqh)] w-[min(12rem,50cqh)]"
                    }`}
                  />
                  {/* Tocar la esfera también llama; el botón accesible es el de abajo. */}
                  {!connected && (
                    <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => start()} disabled={connecting} className="absolute inset-0 rounded-full" />
                  )}
                </div>
                <p className="mt-5 h-5 shrink-0 text-sm font-medium text-brand-800 [@media(max-height:500px)]:mt-3" aria-live="polite">
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
                            onClick={() => decir(idea)}
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
            <p>
              {remaining === 1 ? "Te queda 1 conversación" : remaining > 0 ? `Te quedan ${remaining} conversaciones` : "Usaste todas las conversaciones"}
              <span className="max-sm:hidden"> de esta demo</span>.
            </p>
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
          <div className="mt-2">
            <Ficha clinic={clinic} conWeb={conWeb} />
          </div>
          <p className="mt-5 border-t border-brand-950/5 pt-4 text-sm text-tinta">
            ¿Lo querés con tu agenda real?{" "}
            <Link href="/pedi-una-demo" className="font-medium text-brand-600 hover:underline">
              Pedí una demo guiada
            </Link>
          </p>
        </div>
      </dialog>
    </div>
  );
}
