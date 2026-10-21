#!/usr/bin/env node
// Genera los audios de las demos (public/audios/<slug>.mp3 + .json) con ElevenLabs
// Text to Dialogue, a partir de src/content/conversaciones.json.
//
// Uso:
//   node --env-file=.env.local scripts/generar-audios.mjs              → todos los guiones
//   node --env-file=.env.local scripts/generar-audios.mjs pediatria    → solo esos slugs
//   node scripts/generar-audios.mjs --dry-run                          → valida y muestra el plan, sin gastar créditos
// Opciones: --telefono (filtro de voz de llamada), --forzar (regenera aunque ya exista).
// Voces: VOZ_AGENTE y VOZ_PACIENTE; si no están, usa las 2 voces marcadas como favoritas.
// Sin dependencias: Node 20.6 o más nuevo.

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUIONES = path.join(RAIZ, "src/content/conversaciones.json");
const SALIDA = path.join(RAIZ, "public/audios");
const API = process.env.ELEVENLABS_API_URL || "https://api.elevenlabs.io";
const MODELO = "eleven_v3";
const FORMATO = "mp3_44100_128";
const MAX_CARACTERES = 1800; // la API recomienda ≤ 2000 por pedido

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const slugsPedidos = args.filter((a) => !a.startsWith("--"));
const dryRun = flags.has("--dry-run");
const forzar = flags.has("--forzar");
const telefono = flags.has("--telefono");

function salir(mensaje, codigo = 1) {
  console.error(`\n✖ ${mensaje}\n`);
  process.exit(codigo);
}

// ---------- guiones ----------

function validar(conversaciones) {
  const errores = [];
  const vistos = new Set();
  for (const c of conversaciones) {
    if (!c.slug || vistos.has(c.slug)) errores.push(`slug vacío o repetido: ${c.slug}`);
    vistos.add(c.slug);
    if (!Array.isArray(c.lineas) || c.lineas.length === 0) errores.push(`${c.slug}: sin líneas`);
    (c.lineas ?? []).forEach((l, i) => {
      if (l.quien !== "agente" && l.quien !== "paciente") errores.push(`${c.slug} #${i}: quien inválido (${l.quien})`);
      if (!l.texto?.trim()) errores.push(`${c.slug} #${i}: texto vacío`);
      if (l.texto?.length > MAX_CARACTERES) errores.push(`${c.slug} #${i}: más de ${MAX_CARACTERES} caracteres`);
    });
  }
  return errores;
}

/** Parte el guion en bloques de ≤ MAX_CARACTERES respetando las líneas. */
function partir(lineas) {
  const bloques = [];
  let actual = { desde: 0, lineas: [], caracteres: 0 };
  lineas.forEach((l, i) => {
    if (actual.lineas.length > 0 && actual.caracteres + l.texto.length > MAX_CARACTERES) {
      bloques.push(actual);
      actual = { desde: i, lineas: [], caracteres: 0 };
    }
    actual.lineas.push(l);
    actual.caracteres += l.texto.length;
  });
  if (actual.lineas.length) bloques.push(actual);
  return bloques;
}

// ---------- MP3 ----------
// Para unir los bloques hace falta la duración real de cada uno (incluye silencios al
// final) y sacar las cabeceras ID3/Xing, que harían que el navegador lea mal el total.

const BITRATES = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], // MPEG-1 capa III
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], // MPEG-2/2.5 capa III
};
const MUESTREO = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

function leerCuadro(buf, i) {
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

/** Devuelve los cuadros de audio (sin ID3 ni Xing/Info) y su duración en segundos. */
function limpiarMp3(buf) {
  let i = 0;
  if (buf.subarray(0, 3).toString("latin1") === "ID3") {
    const tam = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    i = 10 + tam + (buf[5] & 0x10 ? 10 : 0);
  }
  const partes = [];
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

// ---------- ElevenLabs ----------

async function llamar(ruta, opciones = {}) {
  const res = await fetch(`${API}${ruta}`, {
    ...opciones,
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json", ...opciones.headers },
  });
  if (res.ok) return res;
  const texto = await res.text();
  let detalle = texto;
  try {
    const json = JSON.parse(texto);
    detalle = json.detail?.message ?? json.detail?.[0]?.msg ?? JSON.stringify(json.detail ?? json);
    if (res.status === 401 || res.status === 403) {
      const estado = json.detail?.status ?? "";
      if (/permission/i.test(estado) || /permission/i.test(detalle)) {
        salir(
          "La clave de ElevenLabs no tiene permiso para este paso.\n" +
            "  Necesita «Text to Speech» (y «Voices: Read» para buscar las favoritas).\n" +
            "  Creá una clave con esos permisos en ElevenLabs → Developers → API Keys y cargala\n" +
            "  como ELEVENLABS_API_KEY en .env.local (no la pegues en el chat).\n" +
            `  Detalle: ${detalle}`,
        );
      }
    }
    if (res.status === 402 || /quota|credits/i.test(detalle)) {
      salir(`No alcanzan los créditos de ElevenLabs (o el límite de la clave). Detalle: ${detalle}`);
    }
  } catch {
    // respuesta no JSON: se informa tal cual
  }
  const error = new Error(`ElevenLabs ${res.status}: ${detalle}`);
  error.status = res.status;
  throw error;
}

async function elegirVoces() {
  const { VOZ_AGENTE, VOZ_PACIENTE } = process.env;
  if (VOZ_AGENTE && VOZ_PACIENTE) return { agente: VOZ_AGENTE, paciente: VOZ_PACIENTE, origen: "variables VOZ_AGENTE / VOZ_PACIENTE" };

  const voces = [];
  let token;
  for (let pagina = 0; pagina < 10; pagina++) {
    const qs = new URLSearchParams({ page_size: "100" });
    if (token) qs.set("next_page_token", token);
    const body = await (await llamar(`/v2/voices?${qs}`)).json();
    voces.push(...(body.voices ?? []));
    if (!body.has_more || !body.next_page_token) break;
    token = body.next_page_token;
  }
  const favoritas = voces
    .filter((v) => v.favorited_at_unix != null)
    .sort((a, b) => a.favorited_at_unix - b.favorited_at_unix);
  const nombre = (v) => `${v.name} (${v.voice_id}${v.labels?.gender ? `, ${v.labels.gender}` : ""})`;

  if (favoritas.length !== 2) {
    console.log(`\nVoces favoritas encontradas: ${favoritas.length}`);
    favoritas.forEach((v) => console.log(`  · ${nombre(v)}`));
    salir(
      "Necesito exactamente 2 voces favoritas, o definí cuáles usar en .env.local:\n" +
        "  VOZ_AGENTE=<voice_id de Sofi>\n  VOZ_PACIENTE=<voice_id del paciente>",
    );
  }
  // Sofi es una voz femenina: si una sola de las dos lo es, va para la agente.
  // Si no, la primera que se marcó como favorita.
  const femeninas = favoritas.filter((v) => v.labels?.gender === "female");
  const agente = femeninas.length === 1 ? femeninas[0] : favoritas[0];
  const paciente = favoritas.find((v) => v !== agente);
  console.log(`\nVoz de Sofi (agente):   ${nombre(agente)}`);
  console.log(`Voz del paciente:       ${nombre(paciente)}`);
  console.log("Si están al revés, definí VOZ_AGENTE y VOZ_PACIENTE en .env.local.");
  return { agente: agente.voice_id, paciente: paciente.voice_id, origen: "voces favoritas" };
}

async function generarBloque(bloque, voces, anteriores) {
  const body = {
    model_id: MODELO,
    language_code: "es",
    inputs: bloque.lineas.map((l) => ({ text: l.texto, voice_id: l.quien === "agente" ? voces.agente : voces.paciente })),
    ...(anteriores.length ? { previous_request_ids: anteriores.slice(-3) } : {}),
    ...(telefono ? { audio_effects: { filter_preset_id: process.env.FILTRO_TELEFONO || "phone" } } : {}),
  };
  const ruta = `/v1/text-to-dialogue/with-timestamps?output_format=${FORMATO}`;
  let res;
  try {
    res = await llamar(ruta, { method: "POST", body: JSON.stringify(body) });
  } catch (e) {
    // Si el modelo no acepta encadenar pedidos, se reintenta sin continuidad.
    if (anteriores.length && e.status >= 400 && e.status < 500 && /previous_request/i.test(e.message)) {
      delete body.previous_request_ids;
      res = await llamar(ruta, { method: "POST", body: JSON.stringify(body) });
    } else if (telefono && e.status === 404) {
      salir(
        `El filtro de voz «${body.audio_effects.filter_preset_id}» no existe. ` +
          "Mirá los disponibles en GET /v1/audio-effects/catalog y definí FILTRO_TELEFONO.",
      );
    } else {
      throw e;
    }
  }
  const requestId = res.headers.get("request-id") ?? res.headers.get("x-request-id");
  const json = await res.json();
  return { json, requestId };
}

async function existe(archivo) {
  try {
    await access(archivo);
    return true;
  } catch {
    return false;
  }
}

async function generar(conversacion, voces) {
  const mp3 = path.join(SALIDA, `${conversacion.slug}.mp3`);
  const sync = path.join(SALIDA, `${conversacion.slug}.json`);
  if (!forzar && (await existe(mp3)) && (await existe(sync))) {
    console.log(`\n· ${conversacion.slug}: ya existe (usá --forzar para regenerar)`);
    return;
  }
  const bloques = partir(conversacion.lineas);
  console.log(`\n▶ ${conversacion.slug}: ${conversacion.lineas.length} líneas en ${bloques.length} pedidos`);

  const audios = [];
  const tramos = new Map(); // línea global → { inicio, fin }
  const anteriores = [];
  let desplazamiento = 0;

  for (const [n, bloque] of bloques.entries()) {
    process.stdout.write(`  pedido ${n + 1}/${bloques.length} (${bloque.caracteres} caracteres)… `);
    const { json, requestId } = await generarBloque(bloque, voces, anteriores);
    if (requestId) anteriores.push(requestId);
    const { audio, segundos } = limpiarMp3(Buffer.from(json.audio_base64, "base64"));
    for (const s of json.voice_segments ?? []) {
      const linea = bloque.desde + s.dialogue_input_index;
      const inicio = desplazamiento + s.start_time_seconds;
      const fin = desplazamiento + s.end_time_seconds;
      const previo = tramos.get(linea);
      tramos.set(linea, previo ? { inicio: Math.min(previo.inicio, inicio), fin: Math.max(previo.fin, fin) } : { inicio, fin });
    }
    audios.push(audio);
    desplazamiento += segundos;
    console.log(`${segundos.toFixed(1)} s`);
  }

  const faltan = conversacion.lineas.map((_, i) => i).filter((i) => !tramos.has(i));
  if (faltan.length) console.warn(`  ⚠ sin marcas de tiempo para las líneas ${faltan.join(", ")} (no se resaltan)`);

  const redondear = (x) => Math.round(x * 100) / 100;
  const segmentos = [...tramos.entries()]
    .map(([linea, t]) => ({ linea, inicio: redondear(t.inicio), fin: redondear(t.fin) }))
    .sort((a, b) => a.inicio - b.inicio);

  await mkdir(SALIDA, { recursive: true });
  await writeFile(mp3, Buffer.concat(audios));
  await writeFile(
    sync,
    JSON.stringify(
      { version: 1, duracion: redondear(desplazamiento), generado: new Date().toISOString(), modelo: MODELO, segmentos },
      null,
      2,
    ) + "\n",
  );
  const m = Math.floor(desplazamiento / 60);
  const s = String(Math.round(desplazamiento % 60)).padStart(2, "0");
  console.log(`  ✔ public/audios/${conversacion.slug}.mp3 (${m}:${s}) y .json`);
}

// ---------- main ----------

const conversaciones = JSON.parse(await readFile(GUIONES, "utf8"));
const errores = validar(conversaciones);
if (errores.length) salir(`Hay errores en los guiones:\n  ${errores.join("\n  ")}`);

const elegidas = slugsPedidos.length ? conversaciones.filter((c) => slugsPedidos.includes(c.slug)) : conversaciones;
const desconocidos = slugsPedidos.filter((s) => !conversaciones.some((c) => c.slug === s));
if (desconocidos.length) salir(`No existen estos guiones: ${desconocidos.join(", ")}.\nDisponibles: ${conversaciones.map((c) => c.slug).join(", ")}`);

const totalCaracteres = elegidas.reduce((t, c) => t + c.lineas.reduce((s, l) => s + l.texto.length, 0), 0);
console.log(`Guiones: ${elegidas.length} · ${totalCaracteres.toLocaleString("es-AR")} caracteres en total`);
console.log("(Text to Dialogue consume créditos por carácter: revisá el saldo y el límite de la clave antes de generar.)");

if (dryRun) {
  for (const c of elegidas) {
    const bloques = partir(c.lineas);
    console.log(`\n${c.slug} — ${c.lineas.length} líneas, ${bloques.length} pedidos`);
    for (const b of bloques) console.log(`  líneas ${b.desde}–${b.desde + b.lineas.length - 1}: ${b.caracteres} caracteres`);
  }
  console.log("\nDry run: no se llamó a ElevenLabs.");
  process.exit(0);
}

if (!process.env.ELEVENLABS_API_KEY) {
  salir("Falta ELEVENLABS_API_KEY. Corré el script con: node --env-file=.env.local scripts/generar-audios.mjs");
}

const voces = await elegirVoces();
for (const c of elegidas) {
  try {
    await generar(c, voces);
  } catch (e) {
    salir(`Falló ${c.slug}: ${e.message}`);
  }
}
console.log("\nListo. Los reproductores de la web toman los archivos nuevos de public/audios/ al publicar.");
