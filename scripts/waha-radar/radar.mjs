// Lector de logs de las WAHA. Corre en el VPS como servicio de Easypanel (n8n/waha-radar, imagen
// node:22-alpine, este archivo montado en /app/radar.mjs). Escucha en vivo los logs de cada WAHA por
// el websocket de Easypanel y manda a Turnia (/api/infra/waha-logs) las advertencias, los errores y
// los cambios de estado. Así, cuando una sesión se cae, queda el porqué.
//
// Solo lee. Nunca reinicia, vincula ni toca una WAHA. Variables (en Easypanel, nunca en el repo):
//   EASYPANEL_TOKEN   token de la API de Easypanel (lee los logs y firma lo que manda a Turnia)
//   EASYPANEL_HOST    p. ej. xxxx.easypanel.host
//   WAHA_SERVICES     servicios a escuchar, p. ej. n8n/waha,n8n/turnia-waha
//   TURNIA_URL        https://turniasalud.app
// Lo importante también queda en /data/radar-AAAA-MM-DD.log (volumen), por si Turnia no responde.

import { createHmac } from "node:crypto";
import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";

const TOKEN = process.env.EASYPANEL_TOKEN ?? "";
const HOST = process.env.EASYPANEL_HOST ?? "";
const TURNIA = (process.env.TURNIA_URL ?? "https://turniasalud.app").replace(/\/$/, "");
const SERVICES = (process.env.WAHA_SERVICES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SECRET = createHmac("sha256", TOKEN).update("turnia-waha-radar").digest("hex");
const DATA = "/data";
const KEEP_FILES_DAYS = 30;
const MAX_QUEUE = 3000;

if (!TOKEN || !HOST || SERVICES.length === 0) {
  console.error("Faltan EASYPANEL_TOKEN, EASYPANEL_HOST o WAHA_SERVICES.");
  process.exit(1);
}

// Lo mismo que filtra Turnia: ruido de cada mensaje y volcados de claves de cifrado, nunca.
const NOISE = /request completed|POST request was sent with status code: 2\d\d|Sending POST|Closing session|SessionEntry|privKey|pubKey|rootKey|<Buffer|Mapped \{|non-existent (message|contact)|failed to decrypt poll vote/i;
const IMPORTANT = /logged ?out|logout|conflict|replaced|FAILED|SCAN_QR|STOPPED|STARTING|WORKING|stream errored|connection (closed|lost|failure)|restart required|bad ?session|unauthorized|ECONN|ETIMEDOUT|heap|out of memory|killed|status (code )?(401|403|408|411|428|440|500|503|515)/i;
const ANSI = /\x1b\[[0-9;]*m/g;
const STRUCTURED = /^\[(\d\d:\d\d:\d\d\.\d{3})\]\s+(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\b/;

const queues = new Map(SERVICES.map((s) => [s, []]));
// Al reconectar, Easypanel vuelve a mandar el arranque del contenedor: no se repite.
const seen = new Map(SERVICES.map((s) => [s, new Set()]));
mkdirSync(DATA, { recursive: true });

function today() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" });
}

// Ni nombres ni números de contactos: un log puede traer los de pacientes.
function redact(text) {
  return text
    .replace(/"(notify|pushName|verifiedName|name|subject)"\s*:\s*"[^"]*"/g, '"$1":"…"')
    .replace(/\d{6,}(?=@|:\d+@)/g, (m) => "…" + m.slice(-4))
    .replace(/\+?\d[\d\s-]{8,}\d/g, (m) => "…" + m.replace(/\D/g, "").slice(-4));
}

function keep(service, line) {
  const text = line.replace(ANSI, "").replace(/\r/g, "").trimEnd();
  if (!text || NOISE.test(text)) return;
  const m = STRUCTURED.exec(text);
  // Las líneas sueltas (volcados de objetos) solo pasan si son claramente de una caída.
  if (!m && !IMPORTANT.test(text)) return;
  const level = m?.[2] ?? null;
  if (m && !/WARN|ERROR|FATAL/.test(level) && !IMPORTANT.test(text)) return;
  const entry = { at: m?.[1] ?? null, level, text: redact(text).slice(0, 4000) };
  const done = seen.get(service);
  if (done.has(entry.text)) return;
  done.add(entry.text);
  if (done.size > 5000) done.delete(done.values().next().value);
  try {
    appendFileSync(`${DATA}/radar-${today()}.log`, JSON.stringify({ service, received: new Date().toISOString(), ...entry }) + "\n");
  } catch { /* el disco no frena el envío */ }
  const q = queues.get(service);
  q.push(entry);
  if (q.length > MAX_QUEUE) q.splice(0, q.length - MAX_QUEUE);
}

function listen(service, attempt = 0) {
  const url = `wss://${HOST}/ws/serviceLogs?token=${encodeURIComponent(TOKEN)}&service=${encodeURIComponent(service.replace("/", "_"))}&compose=false`;
  let partial = "";
  let opened = false;
  const ws = new WebSocket(url);
  ws.onopen = () => { opened = true; console.log(`escuchando ${service}`); };
  ws.onmessage = (msg) => {
    let chunk = "";
    try { chunk = JSON.parse(typeof msg.data === "string" ? msg.data : Buffer.from(msg.data).toString()).output ?? ""; } catch { return; }
    const lines = (partial + chunk).split("\n");
    partial = lines.pop() ?? "";
    for (const line of lines) keep(service, line);
  };
  ws.onerror = () => {};
  ws.onclose = () => {
    if (partial) keep(service, partial);
    const wait = Math.min(60_000, 5_000 * 2 ** (opened ? 0 : Math.min(attempt, 4)));
    console.log(`se cortó ${service}; reintento en ${wait / 1000} s`);
    setTimeout(() => listen(service, opened ? 0 : attempt + 1), wait);
  };
}

async function flush(service, force = false) {
  const q = queues.get(service);
  if (q.length === 0 && !force) return;
  const lines = q.slice(0, 400);
  try {
    const res = await fetch(`${TURNIA}/api/infra/waha-logs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ service, lines }),
      signal: AbortSignal.timeout(15_000),
    });
    // Si Turnia no lo acepta todavía (falta la variable en Vercel o está caído), se reintenta.
    if (res.ok) q.splice(0, lines.length);
    else console.log(`Turnia respondió ${res.status} para ${service}; quedan ${q.length} líneas`);
  } catch {
    console.log(`Turnia no respondió para ${service}; quedan ${q.length} líneas`);
  }
}

function cleanup() {
  const limit = Date.now() - KEEP_FILES_DAYS * 86_400_000;
  for (const name of readdirSync(DATA)) {
    const day = /^radar-(\d{4}-\d\d-\d\d)\.log$/.exec(name)?.[1];
    if (day && Date.parse(day) < limit) try { unlinkSync(`${DATA}/${name}`); } catch { /* sigue */ }
  }
}

for (const service of SERVICES) listen(service);
setInterval(() => { for (const s of SERVICES) flush(s); }, 10_000);
// Latido cada cinco minutos: Turnia sabe que el lector sigue vivo aunque no haya nada que contar.
setInterval(() => { for (const s of SERVICES) flush(s, true); }, 300_000);
setInterval(cleanup, 6 * 3600_000);
cleanup();
for (const s of SERVICES) flush(s, true);
