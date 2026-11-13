"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConversation, type DisconnectionDetails } from "@elevenlabs/react";
import { track, trackMilestone } from "@/lib/analytics";
import { requestMicrophone } from "@/lib/microphone";
import { TOPE_VOZ_AVISO, useTopeDeVoz } from "./tope-voz";
import { errorText } from "@/lib/error-text";

// La charla con Sofi en el navegador, por voz o por chat, sin la pantalla: la usan la demo de
// /probar-demo y /demo (ConversacionDemo) y la demo personal de cada odontólogo (/p/<código>).

export type DemoMode = "chat" | "voz";
export type DemoLine = { id: number; role: "user" | "agent" | "system"; text: string };
export type DemoCredential = {
  token?: string;
  signedUrl?: string;
  /** El agente puede arrancar sin su saludo: en el chat contesta una vez al primer mensaje. */
  sinSaludo?: boolean;
  dynamicVariables: Record<string, string>;
  userId: string;
};

/** La hora, para medir cada conversación (PostHog). */
const ahora = () => Date.now();

export function useCharlaDemo({
  agentName,
  pedirCredencial,
  modoInicial = "voz",
  remaining: initialRemaining,
  conCierre,
}: {
  agentName: string;
  /** Pide la credencial de ElevenLabs para una conversación nueva. Si falla, tira un Error con el motivo. */
  pedirCredencial: (mode: DemoMode) => Promise<DemoCredential>;
  modoInicial?: DemoMode;
  /** Conversaciones que le quedan (sin límite si no se pasa). */
  remaining?: number;
  /** Si hay un cierre que mostrar cuando termina una charla en la que el agente contestó. */
  conCierre: boolean;
}) {
  const [mode, setMode] = useState<DemoMode>(modoInicial);
  const [lines, setLines] = useState<DemoLine[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Un aviso que no es un error (por ejemplo, que seguimos por chat porque no hay micrófono). */
  const [aviso, setAviso] = useState<string | null>(null);
  /** Terminó una charla en la que el agente contestó: se muestra el cierre. */
  const [cerrada, setCerrada] = useState(false);
  const [loading, setLoading] = useState(false);
  const [remaining, setRemaining] = useState(initialRemaining);
  const counter = useRef(0);

  const push = useCallback((role: DemoLine["role"], text: string) => {
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
  const terminarCharla = useCallback((reason: string, beacon = false, detail?: string) => {
    const c = charla.current;
    if (!c) return;
    charla.current = null;
    track(
      "demo_conversation_ended",
      {
        mode: c.mode,
        duration_ms: Math.min(Date.now() - c.startedAt, 3_600_000),
        user_messages: c.user,
        agent_messages: c.agent,
        end_reason: reason,
        ...(detail ? { end_detail: detail } : {}),
      },
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
      setError(mode === "voz"
        ? "La llamada se interrumpió. Podés volver a llamar."
        : typeof message === "string" ? message : "Se cortó la conversación.");
    },
    onDisconnect: (details: DisconnectionDetails) => {
      // Si se corta antes de que el agente diga algo y no la cortó la persona, se muestra
      // el motivo que da ElevenLabs: sin esto solo se veía «Conversación terminada».
      const sinRespuesta = charla.current?.agent === 0 && details.reason !== "user";
      const contesto = (charla.current?.agent ?? 0) > 0;
      const motivo =
        details.reason === "user"
          ? ""
          : [details.reason === "error" ? details.message : "", details.closeReason, details.context?.reason, details.closeCode ?? details.context?.code]
              .filter((x) => x !== undefined && x !== null && x !== "")
              .join(" · ")
              .slice(0, 160);
      terminarCharla(details.reason === "user" ? "disconnect" : `disconnect_${details.reason}`, false, motivo);
      if (contesto && conCierre) {
        setCerrada(true);
        track("demo_closing_viewed", { mode, end_reason: details.reason });
      }
      if (sinRespuesta) {
        setError(`No se pudo conectar con ${agentName}. Probá de nuevo en unos segundos.`);
        return;
      }
      if (mode === "voz" && details.reason === "error") {
        setError("La llamada se interrumpió. Podés volver a llamar.");
        return;
      }
      push("system", "Conversación terminada.");
    },
  });
  const connected = conversation.status === "connected";
  const connecting = conversation.status === "connecting" || loading;
  useTopeDeVoz(connected && mode === "voz", () => {
    setAviso(TOPE_VOZ_AVISO);
    conversation.endSession();
  });

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

  async function start(first?: string) {
    setError(null);
    setAviso(null);
    setCerrada(false);
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
      const sinMicrofono = microfono === "NotAllowedError" || microfono === "NotFoundError" || microfono === "NotReadableError";
      track("demo_conversation_failed", {
        mode,
        error_kind: microfono === "NotAllowedError" ? "mic_denied" : sinMicrofono ? "mic_missing" : "start_error",
      });
      if (sinMicrofono) {
        // Sin micrófono no se frena: pasa al chat, que es lo que hacía casi todos a mano.
        track("demo_mode_switched", { to: "chat", auto: true });
        setMode("chat");
        setAviso("Sin micrófono, seguimos por chat: escribile acá abajo.");
      } else setError(errorText(e, "No se pudo iniciar la conversación."));
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

  /** Cambia entre voz y chat (no mientras hay una conversación abierta). */
  function cambiarModo(m: DemoMode) {
    if (m !== mode) track("demo_mode_switched", { to: m });
    setMode(m);
  }

  return { mode, cambiarModo, lines, draft, setDraft, error, aviso, cerrada, remaining, connected, connecting, conversation, start, decir, send };
}
