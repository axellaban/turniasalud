// Límites de Sofi para que una charla no se vuelva cara: bots que se responden con ella en bucle,
// números que escriben sin parar, audios larguísimos y llamadas eternas. Valen para todas las
// clínicas. Puro (sin base ni red): los números y las reglas se prueban solos.

/** Chat (WhatsApp). El equipo del consultorio no tiene topes. */
export const CHAT_LIMITS = {
  /** Mensajes de un mismo número en una ventana corta: a partir del siguiente, Sofi se pausa. */
  burst: { messages: 25, minutes: 30 },
  /** Mensajes de un mismo número en 24 horas. */
  daily: 60,
  /** Cuánto dura la pausa por exceso de mensajes. */
  pauseHours: 12,
  /** Cuánto queda en silencio un bot o un vendedor. */
  muteDays: 7,
  /** Una respuesta más rápida que esto (desde que Sofi contestó) no la escribe una persona… */
  fastReplySeconds: 3,
  /** …y si pasa tantas veces seguidas, es un bot. */
  fastRepliesInARow: 4,
  /** El mismo mensaje (largo) repetido tantas veces en la charla también es un bot. */
  repeatedMessages: 3,
  repeatedMinChars: 15,
  /** Lo que pase de este largo se recorta antes de llegar a Sofi (la ficha de salud entra de sobra). */
  maxChars: 4000,
  /** Audios más largos no se transcriben. */
  maxAudioSeconds: 180,
  /** Fotos o PDF que Sofi lee por número por día. */
  dailyDocuments: 10,
} as const;

/** Llamadas. La demo web por voz tiene su propio tope, más corto. */
export const CALL_LIMITS = {
  maxSeconds: 8 * 60,
  silenceSeconds: 20,
  webDemoSeconds: 3 * 60,
} as const;

/** Fusible por clínica: pasado esto en un día, Turnia le avisa a Axel (no corta a nadie). */
export const CLINIC_FUSE = { chatMessages: 400, callMinutes: 120 } as const;

export const PAUSE_REPLY = "Para seguir con esto te va a escribir alguien del equipo del consultorio. ¡Gracias por la paciencia!";
export const LONG_AUDIO_REPLY = "Tu audio es muy largo para mí. ¿Me mandás uno de menos de 3 minutos, o me lo escribís?";
export const DOCUMENTS_LIMIT_REPLY = "Por hoy ya no puedo leer más fotos ni archivos. ¿Me contás por escrito qué dice? Si es importante, traelo el día del turno.";
export const CALL_LIMIT_MESSAGE = "Se nos terminó el tiempo de la llamada. Te va a contactar alguien del equipo para terminar lo que necesitabas. ¡Gracias!";
export const CLIPPED_NOTE = "\n[El mensaje seguía, pero era demasiado largo y se recortó.]";

export type ChatLine = { role: "user" | "agent"; message: string; at: string };
export type BotSignal = "rapido" | "repetido";

/** Recorta un mensaje entrante larguísimo (spam, textos pegados) antes de mandárselo a Sofi. */
export function clipIncoming(text: string, max: number = CHAT_LIMITS.maxChars): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}${CLIPPED_NOTE}` : text;
}

const normalized = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * ¿Del otro lado hay un programa? Dos señales que una persona no da:
 * - contesta a Sofi en menos de 3 segundos, 4 veces seguidas (una respuesta lenta corta la racha);
 * - manda el mismo mensaje largo por tercera vez en la charla.
 * `lines` es la charla abierta; `incoming` el mensaje que acaba de llegar.
 */
export function botSignal(lines: ChatLine[], incoming: string, now: Date = new Date()): BotSignal | null {
  const text = normalized(incoming);
  if (text.length >= CHAT_LIMITS.repeatedMinChars) {
    const same = lines.filter((l) => l.role === "user" && normalized(l.message) === text).length;
    if (same + 1 >= CHAT_LIMITS.repeatedMessages) return "repetido";
  }
  // Cuánto tardó en contestar cada vez que Sofi le respondió (solo el primer mensaje después de ella).
  const delays: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].role === "user" && lines[i - 1].role === "agent") {
      delays.push(Date.parse(lines[i].at) - Date.parse(lines[i - 1].at));
    }
  }
  const last = lines.at(-1);
  if (last?.role === "agent") delays.push(now.getTime() - Date.parse(last.at));
  let streak = 0;
  for (let i = delays.length - 1; i >= 0; i--) {
    const d = delays[i];
    if (!Number.isFinite(d) || d >= CHAT_LIMITS.fastReplySeconds * 1000) break;
    streak++;
  }
  return streak >= CHAT_LIMITS.fastRepliesInARow ? "rapido" : null;
}

export const BOT_DETAIL: Record<BotSignal, string> = {
  rapido: `Contestó en menos de ${CHAT_LIMITS.fastReplySeconds} segundos ${CHAT_LIMITS.fastRepliesInARow} veces seguidas.`,
  repetido: `Mandó el mismo mensaje ${CHAT_LIMITS.repeatedMessages} veces.`,
};

/**
 * Duración de un audio Ogg Opus (las notas de voz de WhatsApp), en segundos, leyendo
 * la última página: su posición final está en muestras a 48 kHz. null si no es Ogg Opus.
 */
export function oggOpusSeconds(bytes: Uint8Array): number | null {
  const isOgg = (i: number) => bytes[i] === 0x4f && bytes[i + 1] === 0x67 && bytes[i + 2] === 0x67 && bytes[i + 3] === 0x53;
  if (bytes.length < 64 || !isOgg(0)) return null;
  const head = new TextDecoder("latin1").decode(bytes.subarray(28, 36));
  if (head !== "OpusHead") return null;
  const preSkip = bytes[38] | (bytes[39] << 8);
  for (let i = bytes.length - 27; i >= 0; i--) {
    if (!isOgg(i)) continue;
    // Posición de 64 bits en dos mitades (sin BigInt): una nota de voz no pasa de los 32 bits altos chicos.
    const view = new DataView(bytes.buffer, bytes.byteOffset + i + 6, 8);
    const low = view.getUint32(0, true);
    const high = view.getUint32(4, true);
    // Todo en 1 (-1) marca una página sin posición; 0 es el encabezado.
    if ((low === 0xffffffff && high === 0xffffffff) || (low === 0 && high === 0)) continue;
    return Math.max(0, (high * 2 ** 32 + low - preSkip) / 48000);
  }
  return null;
}

/**
 * ¿El audio pasa el tope? Usa la duración que informa el canal o la del archivo; si no se puede
 * saber (otro formato), un archivo de más de 3 MB cuenta como largo.
 */
export function audioTooLong(seconds: number | null | undefined, bytes?: Uint8Array | null): boolean {
  const known = typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? seconds : bytes ? oggOpusSeconds(bytes) : null;
  if (known != null) return known > CHAT_LIMITS.maxAudioSeconds;
  return (bytes?.length ?? 0) > 3 * 1024 * 1024;
}
