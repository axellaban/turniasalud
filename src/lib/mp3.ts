// Utilidades puras para armar los audios de las demos (mismo algoritmo que
// scripts/generar-audios.mjs, que corre en Node sin compilar TypeScript).

const MAX_CARACTERES = 1800; // Text to Dialogue recomienda ≤ 2000 por pedido

export type LineaTexto = { quien: "agente" | "paciente"; texto: string };
export type Bloque = { desde: number; lineas: LineaTexto[]; caracteres: number };

/** Parte el guion en bloques de ≤ 1800 caracteres respetando las líneas. */
export function partirGuion(lineas: LineaTexto[], max = MAX_CARACTERES): Bloque[] {
  const bloques: Bloque[] = [];
  let actual: Bloque = { desde: 0, lineas: [], caracteres: 0 };
  lineas.forEach((l, i) => {
    if (actual.lineas.length > 0 && actual.caracteres + l.texto.length > max) {
      bloques.push(actual);
      actual = { desde: i, lineas: [], caracteres: 0 };
    }
    actual.lineas.push(l);
    actual.caracteres += l.texto.length;
  });
  if (actual.lineas.length) bloques.push(actual);
  return bloques;
}

const BITRATES: Record<1 | 2, number[]> = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], // MPEG-1 capa III
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], // MPEG-2/2.5 capa III
};
const MUESTREO: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

function leerCuadro(buf: Buffer, i: number) {
  if (i + 4 > buf.length || buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) return null;
  const version = (buf[i + 1] >> 3) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  const capa = (buf[i + 1] >> 1) & 3; // 1 = capa III
  const indiceBitrate = buf[i + 2] >> 4;
  const indiceMuestreo = (buf[i + 2] >> 2) & 3;
  if (version === 1 || capa !== 1 || indiceBitrate === 0 || indiceBitrate === 15 || indiceMuestreo === 3) return null;
  const mpeg1 = version === 3;
  const bitrate = BITRATES[mpeg1 ? 1 : 2][indiceBitrate] * 1000;
  const muestreo = MUESTREO[version][indiceMuestreo];
  const relleno = (buf[i + 2] >> 1) & 1;
  const muestras = mpeg1 ? 1152 : 576;
  const largo = Math.floor(((muestras / 8) * bitrate) / muestreo) + relleno;
  return { largo, muestras, muestreo, mpeg1, mono: buf[i + 3] >> 6 === 3 };
}

/**
 * Devuelve los cuadros de audio sin cabeceras ID3/Xing (que harían que el
 * navegador lea mal la duración al unir bloques) y la duración real en segundos.
 */
export function limpiarMp3(buf: Buffer): { audio: Buffer; segundos: number } {
  let i = 0;
  if (buf.subarray(0, 3).toString("latin1") === "ID3") {
    const tam = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    i = 10 + tam + (buf[5] & 0x10 ? 10 : 0);
  }
  const partes: Buffer[] = [];
  let segundos = 0;
  let primero = true;
  while (i < buf.length) {
    const cuadro = leerCuadro(buf, i);
    if (!cuadro || cuadro.largo <= 4) {
      i++; // basura o etiqueta: buscar la próxima sincronización
      continue;
    }
    const fin = Math.min(i + cuadro.largo, buf.length);
    if (primero) {
      primero = false;
      const lateral = cuadro.mpeg1 ? (cuadro.mono ? 17 : 32) : cuadro.mono ? 9 : 17;
      const marca = buf.subarray(i + 4 + lateral, i + 8 + lateral).toString("latin1");
      if (marca === "Xing" || marca === "Info") {
        i = fin;
        continue;
      }
    }
    partes.push(buf.subarray(i, fin));
    segundos += cuadro.muestras / cuadro.muestreo;
    i = fin;
  }
  return { audio: Buffer.concat(partes), segundos };
}
