import "server-only";
import { sql } from "./db";
import { CONVERSACIONES, type Conversacion } from "@/content/conversaciones";
import { limpiarMp3, partirGuion } from "./mp3";

// Audios de las demos de la web pública, generados desde el panel con ElevenLabs
// Text to Dialogue y guardados en Postgres (tabla web_audios). Se sirven en
// /api/audios/<slug>.mp3 y /api/audios/<slug>.json. Es el mismo proceso que
// scripts/generar-audios.mjs, pero sin tener que correr nada en una computadora.

const API = "https://api.elevenlabs.io";
const MODELO = "eleven_v3";
const FORMATO = "mp3_44100_128";

export class AudioError extends Error {}

/** Para los audios se puede usar una clave aparte (con permiso Text to Speech). */
function apiKey(): string {
  const key = process.env.ELEVENLABS_TTS_API_KEY || process.env.ELEVENLABS_API_KEY;
  if (!key) throw new AudioError("Falta ELEVENLABS_API_KEY en Vercel.");
  return key;
}

async function llamar(ruta: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API}${ruta}`, {
    ...init,
    headers: { "xi-api-key": apiKey(), "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  if (res.ok) return res;
  const texto = await res.text();
  let detalle = texto.slice(0, 300);
  let estado = "";
  try {
    const json = JSON.parse(texto) as { detail?: { message?: string; status?: string } | Array<{ msg?: string }> };
    if (Array.isArray(json.detail)) detalle = json.detail[0]?.msg ?? detalle;
    else if (json.detail) {
      detalle = json.detail.message ?? detalle;
      estado = json.detail.status ?? "";
    }
  } catch {
    // respuesta no JSON
  }
  if ((res.status === 401 || res.status === 403) && /permission/i.test(`${estado} ${detalle}`)) {
    throw new AudioError(
      "La clave de ElevenLabs no tiene permiso de «Text to Speech» (y «Voices: Read» para leer tus favoritas). " +
        "En ElevenLabs → Developers → API Keys editá la clave «Turnia Salud · Vercel» y activá esos permisos, " +
        "o creá otra y cargala en Vercel como ELEVENLABS_TTS_API_KEY.",
    );
  }
  if (res.status === 402 || /quota|credit/i.test(detalle)) {
    throw new AudioError(`No alcanzan los créditos de ElevenLabs o el límite de la clave. Detalle: ${detalle}`);
  }
  throw new AudioError(`ElevenLabs respondió ${res.status}: ${detalle}`);
}

export type Voz = { id: string; nombre: string; genero?: string };
export type Voces = { agente: Voz; paciente: Voz; origen: string };

/** Las 2 voces marcadas como favoritas en ElevenLabs (o VOZ_AGENTE / VOZ_PACIENTE). */
export async function elegirVoces(): Promise<Voces> {
  const { VOZ_AGENTE, VOZ_PACIENTE } = process.env;
  if (VOZ_AGENTE && VOZ_PACIENTE) {
    return { agente: { id: VOZ_AGENTE, nombre: VOZ_AGENTE }, paciente: { id: VOZ_PACIENTE, nombre: VOZ_PACIENTE }, origen: "VOZ_AGENTE / VOZ_PACIENTE" };
  }
  type V = { voice_id: string; name: string; favorited_at_unix?: number | null; labels?: { gender?: string } };
  const voces: V[] = [];
  let token: string | undefined;
  for (let pagina = 0; pagina < 10; pagina++) {
    const qs = new URLSearchParams({ page_size: "100" });
    if (token) qs.set("next_page_token", token);
    const body = (await (await llamar(`/v2/voices?${qs}`)).json()) as { voices?: V[]; has_more?: boolean; next_page_token?: string };
    voces.push(...(body.voices ?? []));
    if (!body.has_more || !body.next_page_token) break;
    token = body.next_page_token;
  }
  const favoritas = voces.filter((v) => v.favorited_at_unix != null).sort((a, b) => a.favorited_at_unix! - b.favorited_at_unix!);
  if (favoritas.length < 2) {
    throw new AudioError(
      `Encontré ${favoritas.length} voces favoritas en ElevenLabs y necesito 2 (Sofi y el paciente). ` +
        "Marcalas con la estrella en ElevenLabs → Voices, o cargá VOZ_AGENTE y VOZ_PACIENTE en Vercel.",
    );
  }
  // Sofi es una voz femenina: si una sola de las dos primeras lo es, va para la agente.
  const dos = favoritas.slice(0, 2);
  const femeninas = dos.filter((v) => v.labels?.gender === "female");
  const agente = femeninas.length === 1 ? femeninas[0] : dos[0];
  const paciente = dos.find((v) => v !== agente)!;
  const voz = (v: V): Voz => ({ id: v.voice_id, nombre: v.name, genero: v.labels?.gender });
  return { agente: voz(agente), paciente: voz(paciente), origen: favoritas.length === 2 ? "voces favoritas" : "las 2 primeras favoritas" };
}

type Respuesta = {
  audio_base64: string;
  voice_segments?: Array<{ dialogue_input_index: number; start_time_seconds: number; end_time_seconds: number }>;
};

/** Genera el audio de una conversación y lo guarda en web_audios. Devuelve la duración en segundos. */
export async function generarAudio(conversacion: Conversacion, voces: Voces): Promise<number> {
  const bloques = partirGuion(conversacion.lineas);
  const partes: Buffer[] = [];
  const tramos = new Map<number, { inicio: number; fin: number }>();
  const anteriores: string[] = [];
  let desplazamiento = 0;

  for (const bloque of bloques) {
    const body: Record<string, unknown> = {
      model_id: MODELO,
      language_code: "es",
      inputs: bloque.lineas.map((l) => ({ text: l.texto, voice_id: l.quien === "agente" ? voces.agente.id : voces.paciente.id })),
    };
    if (anteriores.length) body.previous_request_ids = anteriores.slice(-3);
    const ruta = `/v1/text-to-dialogue/with-timestamps?output_format=${FORMATO}`;
    let res: Response;
    try {
      res = await llamar(ruta, { method: "POST", body: JSON.stringify(body) });
    } catch (e) {
      // Si el modelo no acepta encadenar pedidos, se reintenta sin continuidad.
      if (!anteriores.length || !(e instanceof AudioError) || !/previous_request/i.test(e.message)) throw e;
      delete body.previous_request_ids;
      res = await llamar(ruta, { method: "POST", body: JSON.stringify(body) });
    }
    const requestId = res.headers.get("request-id") ?? res.headers.get("x-request-id");
    if (requestId) anteriores.push(requestId);
    const json = (await res.json()) as Respuesta;
    const { audio, segundos } = limpiarMp3(Buffer.from(json.audio_base64, "base64"));
    for (const s of json.voice_segments ?? []) {
      const linea = bloque.desde + s.dialogue_input_index;
      const inicio = desplazamiento + s.start_time_seconds;
      const fin = desplazamiento + s.end_time_seconds;
      const previo = tramos.get(linea);
      tramos.set(linea, previo ? { inicio: Math.min(previo.inicio, inicio), fin: Math.max(previo.fin, fin) } : { inicio, fin });
    }
    partes.push(audio);
    desplazamiento += segundos;
  }

  const redondear = (x: number) => Math.round(x * 100) / 100;
  const segmentos = [...tramos.entries()]
    .map(([linea, t]) => ({ linea, inicio: redondear(t.inicio), fin: redondear(t.fin) }))
    .sort((a, b) => a.inicio - b.inicio);
  const sync = { version: 1, duracion: redondear(desplazamiento), generado: new Date().toISOString(), modelo: MODELO, segmentos };
  const mp3 = Buffer.concat(partes);
  await sql`
    insert into web_audios (slug, mp3, sync, voices, created_at)
    values (${conversacion.slug}, ${mp3}, ${sql.json(sync)}, ${sql.json({ agente: voces.agente, paciente: voces.paciente })}, now())
    on conflict (slug) do update set mp3 = excluded.mp3, sync = excluded.sync, voices = excluded.voices, created_at = now()`;
  return desplazamiento;
}

export type EstadoAudio = { slug: string; titulo: string; caracteres: number; generado: string | null; duracion: number | null };

export async function estadoAudios(): Promise<EstadoAudio[]> {
  let filas: Array<{ slug: string; created_at: string; duracion: number | null }> = [];
  try {
    filas = await sql`select slug, created_at, (sync->>'duracion')::float as duracion from web_audios`;
  } catch {
    // Tabla todavía no creada (falta correr schema.sql): todo figura sin generar.
  }
  const porSlug = new Map(filas.map((f) => [f.slug, f]));
  return CONVERSACIONES.map((c) => ({
    slug: c.slug,
    titulo: c.titulo,
    caracteres: c.lineas.reduce((t, l) => t + l.texto.length, 0),
    generado: porSlug.get(c.slug)?.created_at ?? null,
    duracion: porSlug.get(c.slug)?.duracion ?? null,
  }));
}

export async function leerAudio(slug: string): Promise<{ mp3: Buffer; sync: unknown; creado: string } | null> {
  const [fila] = await sql<{ mp3: Buffer; sync: unknown; created_at: string }[]>`
    select mp3, sync, created_at from web_audios where slug = ${slug}`;
  return fila ? { mp3: fila.mp3, sync: fila.sync, creado: fila.created_at } : null;
}

export async function leerSync(slug: string): Promise<{ sync: unknown; creado: string } | null> {
  const [fila] = await sql<{ sync: unknown; created_at: string }[]>`select sync, created_at from web_audios where slug = ${slug}`;
  return fila ? { sync: fila.sync, creado: fila.created_at } : null;
}
