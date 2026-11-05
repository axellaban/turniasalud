import { describe, expect, it } from "vitest";
import { CHAT_LIMITS, CLIPPED_NOTE, audioTooLong, botSignal, clipIncoming, oggOpusSeconds, type ChatLine } from "./chat-limits";
import { healthFormTemplate } from "./health-form";

const T0 = Date.parse("2026-11-05T15:00:00Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

/** Una charla en la que el otro contesta a Sofi con estas demoras (en ms). */
function chat(delays: number[]): { lines: ChatLine[]; end: number } {
  const lines: ChatLine[] = [{ role: "user", message: "hola", at: at(0) }];
  let t = 0;
  delays.forEach((d, i) => {
    t += 4000; // Sofi tarda en contestar
    lines.push({ role: "agent", message: `respuesta ${i}`, at: at(t) });
    t += d;
    lines.push({ role: "user", message: `mensaje ${i}`, at: at(t) });
  });
  return { lines, end: t };
}

describe("botSignal", () => {
  it("una persona que tarda en contestar no es un bot", () => {
    const { lines, end } = chat([12000, 25000, 8000, 40000]);
    lines.push({ role: "agent", message: "¿algo más?", at: at(end + 4000) });
    expect(botSignal(lines, "no, gracias", new Date(T0 + end + 15000))).toBeNull();
  });

  it("contestar en menos de 3 segundos 4 veces seguidas es un bot", () => {
    const { lines, end } = chat([800, 1200, 900]);
    lines.push({ role: "agent", message: "¿algo más?", at: at(end + 4000) });
    expect(botSignal(lines, "Elegí una opción", new Date(T0 + end + 4000 + 700))).toBe("rapido");
    // Con una sola respuesta lenta en el medio, la racha se corta.
    const slow = chat([800, 9000, 900]);
    slow.lines.push({ role: "agent", message: "¿algo más?", at: at(slow.end + 4000) });
    expect(botSignal(slow.lines, "Elegí una opción", new Date(T0 + slow.end + 4000 + 700))).toBeNull();
  });

  it("dos mensajes seguidos de una persona no cuentan como respuestas rápidas", () => {
    const { lines, end } = chat([1000, 1000]);
    lines.push({ role: "user", message: "y otra cosa", at: at(end + 500) });
    expect(botSignal(lines, "perdón, una más", new Date(T0 + end + 900))).toBeNull();
  });

  it("el mismo mensaje largo por tercera vez es un bot; un «hola» repetido no", () => {
    const menu = "Gracias por comunicarte con Ventas SA. Respondé 1 para precios.";
    const lines: ChatLine[] = [
      { role: "user", message: menu, at: at(0) },
      { role: "agent", message: "Este WhatsApp es para turnos.", at: at(5000) },
      { role: "user", message: `  ${menu.toUpperCase()} `, at: at(60000) },
    ];
    expect(botSignal(lines, menu, new Date(T0 + 120000))).toBe("repetido");
    const hola: ChatLine[] = [
      { role: "user", message: "hola", at: at(0) },
      { role: "user", message: "hola", at: at(30000) },
    ];
    expect(botSignal(hola, "hola", new Date(T0 + 60000))).toBeNull();
  });
});

describe("clipIncoming", () => {
  it("deja pasar lo normal y recorta lo larguísimo con una nota para Sofi", () => {
    expect(clipIncoming("quiero un turno")).toBe("quiero un turno");
    const clipped = clipIncoming("a".repeat(9000));
    expect(clipped.startsWith("a".repeat(CHAT_LIMITS.maxChars))).toBe(true);
    expect(clipped.endsWith(CLIPPED_NOTE)).toBe(true);
  });

  it("la ficha de salud completa entra entera", () => {
    const empty = { full_name: null, dni: null, birth_date: null, email: null, phone: null, coverage: null, coverage_plan: null, member_number: null, address: null, sex: null };
    const filled = healthFormTemplate({}, empty).replace(/:\s*$/gm, ": SI, desde hace años y con tratamiento");
    expect(filled.length).toBeLessThan(CHAT_LIMITS.maxChars);
    expect(clipIncoming(filled)).toBe(filled);
  });
});

/** Un Ogg Opus mínimo: la página del encabezado y una última página con su posición en muestras. */
function oggOpus(seconds: number, preSkip = 312): Uint8Array {
  const page = (granule: number, packet: Uint8Array) => {
    const header = new Uint8Array(28 + packet.length);
    header.set([0x4f, 0x67, 0x67, 0x53]);
    const view = new DataView(header.buffer);
    view.setUint32(6, granule % 2 ** 32, true);
    view.setUint32(10, Math.floor(granule / 2 ** 32), true);
    header[26] = 1;
    header[27] = packet.length;
    header.set(packet, 28);
    return header;
  };
  const head = new Uint8Array(19);
  head.set(new TextEncoder().encode("OpusHead"));
  head[8] = 1;
  head[9] = 1;
  head[10] = preSkip & 0xff;
  head[11] = preSkip >> 8;
  const first = page(0, head);
  const body = new Uint8Array(200).fill(7);
  const last = page(seconds * 48000 + preSkip, new Uint8Array(40).fill(9));
  const all = new Uint8Array(first.length + body.length + last.length);
  all.set(first);
  all.set(body, first.length);
  all.set(last, first.length + body.length);
  return all;
}

describe("audios", () => {
  it("mide la duración de una nota de voz Ogg Opus", () => {
    expect(oggOpusSeconds(oggOpus(95))).toBeCloseTo(95, 3);
    expect(oggOpusSeconds(oggOpus(4 * 3600))).toBeCloseTo(4 * 3600, 3);
    expect(oggOpusSeconds(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("más de 3 minutos es largo: por lo que informa el canal, por el archivo o, si no se sabe, por el tamaño", () => {
    expect(audioTooLong(240)).toBe(true);
    expect(audioTooLong(60)).toBe(false);
    expect(audioTooLong(null, oggOpus(200))).toBe(true);
    expect(audioTooLong(undefined, oggOpus(30))).toBe(false);
    expect(audioTooLong(null, new Uint8Array(4 * 1024 * 1024))).toBe(true);
    expect(audioTooLong(null, new Uint8Array(500 * 1024))).toBe(false);
  });
});
