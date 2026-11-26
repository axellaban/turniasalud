import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { sql, type TransactionSql as Tx } from "./db";
import { notifyAxel } from "./chat-guard";
import { wahaConnections } from "./waha-connections";

// Radar de WhatsApp (WAHA) y del VPS donde corre. Solo lee: nunca reinicia, vincula ni cambia
// una instancia. Lo dispara el cron de diez minutos y lo completa el aviso `session.status` que
// manda cada WAHA al webhook. Guarda estado, eventos y muestras, nunca claves ni mensajes.

export const RAM_ALERT_PCT = 90;
export const DISK_ALERT_PCT = 85;
/** Un contenedor de WAHA cerca de su tope de memoria: Docker lo mata y la sesión arranca de cero. */
export const CONTAINER_ALERT_PCT = 90;
const COOLDOWN_MS = 3 * 3600_000;
const KEEP_DAYS = 30;

export type EasypanelConfig = { url: string; token: string; host: string };

export function easypanelConfig(): EasypanelConfig | null {
  // Si se pegó con las comillas del archivo .env, se sacan.
  const clean = (v: string | undefined) => v?.trim().replace(/^(['"])(.*)\1$/, "$2").trim();
  const url = clean(process.env.EASYPANEL_API_URL)?.replace(/\/$/, "");
  // También si se pegó como «EASYPANEL_API_TOKEN=…» o con «Bearer » adelante.
  const token = clean(clean(process.env.EASYPANEL_API_TOKEN)?.replace(/^EASYPANEL_API_TOKEN\s*=\s*/, "").replace(/^Bearer\s+/i, ""));
  if (!url || !token) return null;
  try {
    return { url, token, host: new URL(url).host };
  } catch {
    return null;
  }
}

/** La clave con la que el lector de logs del VPS firma lo que manda. Sale del token, sin otra variable. */
export function radarLogSecret(config = easypanelConfig()): string | null {
  return config ? createHmac("sha256", config.token).update("turnia-waha-radar").digest("hex") : null;
}

/**
 * Para comparar el token de Vercel con el del lector sin mostrarlo: su largo y el comienzo de su
 * SHA-256 (no permite reconstruirlo).
 */
export function radarTokenFingerprint(): { largo: number; huella: string } | null {
  const config = easypanelConfig();
  if (!config) return null;
  return { largo: config.token.length, huella: createHash("sha256").update(config.token).digest("hex").slice(0, 8) };
}

export function verifyRadarSecret(header: string | null): boolean {
  const secret = radarLogSecret();
  const given = header?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * `restriction`: WhatsApp frena los mensajes a contactos nuevos aunque la sesión siga en WORKING
 * (bloqueo temporal por escribir a muchos, error 463, o tope del ciclo, error 475). La doc de WAHA es
 * clara: no reiniciar ni re-vincular, porque no lo levanta y empeora la línea. Se frena y se espera.
 */
export type RadarSession = { name: string; status: string; phone: string | null; restriction?: string | null };
export type RadarInstance = {
  service: string;
  reachable: boolean;
  startedAt: string | null;
  version: string | null;
  memoryMb: number | null;
  memoryLimitMb: number | null;
  sessions: RadarSession[];
  error: string | null;
};
export type RadarSnapshot = {
  memoryPct: number | null;
  memoryFreeMb: number | null;
  diskPct: number | null;
  cpuPct: number | null;
  load1: number | null;
  instances: RadarInstance[];
  topMemory: Array<{ service: string; mb: number }>;
};

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
/** Últimos cuatro dígitos: alcanza para saber qué línea es sin guardar el número. */
const lastDigits = (jid: string | undefined | null) => (jid ? jid.split("@")[0].split(":")[0].slice(-4) || null : null);

async function easypanel<T>(config: EasypanelConfig, path: string, query?: Record<string, string>): Promise<T> {
  const qs = query ? "?" + new URLSearchParams(query).toString() : "";
  const res = await fetch(config.url + "/" + path + qs, {
    headers: { Authorization: "Bearer " + config.token }, cache: "no-store", signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error("Easypanel HTTP " + res.status + " en " + path);
  const body = await res.json() as T | { json: T };
  return body && typeof body === "object" && "json" in (body as object) ? (body as { json: T }).json : body as T;
}

type ServiceRow = { projectName: string; name: string; type: string; enabled?: boolean; source?: { image?: string }; resources?: { memoryLimit?: number } | null };
type MonitorRow = { projectName: string; serviceName: string; stats?: { memory?: { usage?: number } } };
type SystemStats = {
  cpuInfo?: { usedPercentage?: number; loadavg?: number[] };
  diskInfo?: { usedPercentage?: string | number };
  memInfo?: { usedMemPercentage?: number; freeMemMb?: number };
};

const isWaha = (s: ServiceRow) => s.type === "app" && (s.source?.image?.includes("devlikeapro/waha") || /waha/.test(s.name));

function envValue(env: string, name: string): string | null {
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && line.slice(0, i).trim() === name) return line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "") || null;
  }
  return null;
}

type MeInfo = {
  reachoutTimelock?: { isActive?: boolean; timeEnforcementEnds?: string | number | null } | null;
  messageCapping?: { cappingStatus?: string | null } | null;
} | null;

/** null si la línea puede escribir a contactos nuevos; si no, qué la frena. */
export function restrictionOf(me: MeInfo): string | null {
  const lock = me?.reachoutTimelock;
  if (lock?.isActive) {
    const ends = lock.timeEnforcementEnds ? new Date(typeof lock.timeEnforcementEnds === "number" && lock.timeEnforcementEnds < 1e12 ? lock.timeEnforcementEnds * 1000 : lock.timeEnforcementEnds) : null;
    return "bloqueo temporal" + (ends && !Number.isNaN(ends.getTime()) ? " hasta " + ends.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
  }
  const capping = me?.messageCapping?.cappingStatus;
  if (capping === "CAPPED") return "tope de contactos nuevos alcanzado";
  if (capping === "FIRST_WARNING" || capping === "SECOND_WARNING") return "aviso de tope de contactos nuevos (" + (capping === "FIRST_WARNING" ? "primer" : "segundo") + " aviso)";
  return null;
}

async function readInstance(config: EasypanelConfig, service: ServiceRow, memory: Map<string, number>): Promise<RadarInstance> {
  const id = service.projectName + "/" + service.name;
  const base: RadarInstance = {
    service: id, reachable: false, startedAt: null, version: null,
    memoryMb: memory.has(id) ? round(memory.get(id)! / 1048576, 0) : null,
    memoryLimitMb: service.resources?.memoryLimit || null, sessions: [], error: null,
  };
  try {
    const detail = await easypanel<{ env?: string }>(config, "inspectAppService", { projectName: service.projectName, serviceName: service.name });
    const key = envValue(detail.env ?? "", "WAHA_API_KEY");
    if (!key) return { ...base, error: "Sin WAHA_API_KEY" };
    // El dominio que Easypanel le da a cada servicio. WAHA_BASE_URL puede ser una dirección interna.
    const url = "https://" + service.projectName + "-" + service.name + "." + config.host;
    const get = (path: string) => fetch(url + path, { headers: { "X-Api-Key": key }, cache: "no-store", signal: AbortSignal.timeout(6000) });
    const [sessions, status, version] = await Promise.all([get("/api/sessions?all=true"), get("/api/server/status"), get("/api/server/version")]);
    if (!sessions.ok) return { ...base, error: "WAHA HTTP " + sessions.status };
    const list = await sessions.json() as Array<{ name?: string; status?: string; me?: { id?: string } | null }>;
    // Bloqueo temporal y tope de contactos nuevos: solo se pueden leer con la sesión funcionando.
    const restrictions = await Promise.all(list.map(async (s) => s.status === "WORKING" && s.name
      ? restrictionOf(await get("/api/sessions/" + encodeURIComponent(s.name) + "/me").then((r) => (r.ok ? r.json() : null)).catch(() => null))
      : null));
    const started = status.ok ? (await status.json() as { startTimestamp?: number }).startTimestamp : null;
    return {
      ...base,
      reachable: true,
      startedAt: started ? new Date(started).toISOString() : null,
      version: version.ok ? (await version.json() as { version?: string }).version ?? null : null,
      sessions: list.map((s, i) => ({ name: s.name ?? "?", status: s.status ?? "UNKNOWN", phone: lastDigits(s.me?.id), restriction: restrictions[i] })),
    };
  } catch (e) {
    // Sin el texto crudo del proveedor: puede traer direcciones internas.
    return { ...base, error: e instanceof Error && e.name === "TimeoutError" ? "No respondió a tiempo" : "No se pudo consultar" };
  }
}

export async function readRadar(config: EasypanelConfig): Promise<RadarSnapshot> {
  const [system, monitor, all] = await Promise.all([
    easypanel<SystemStats>(config, "getLegacyMonitorSystemStats").catch(() => null),
    easypanel<MonitorRow[]>(config, "getMonitorTableData").catch(() => []),
    easypanel<{ services: ServiceRow[] }>(config, "listProjectsAndServices"),
  ]);
  const memory = new Map<string, number>();
  for (const row of monitor ?? []) {
    const usage = row.stats?.memory?.usage;
    if (typeof usage === "number") memory.set(row.projectName + "/" + row.serviceName, usage);
  }
  const instances = await Promise.all(all.services.filter((s) => s.enabled !== false && isWaha(s)).map((s) => readInstance(config, s, memory)));
  const disk = Number(system?.diskInfo?.usedPercentage);
  return {
    memoryPct: typeof system?.memInfo?.usedMemPercentage === "number" ? round(system.memInfo.usedMemPercentage) : null,
    memoryFreeMb: typeof system?.memInfo?.freeMemMb === "number" ? round(system.memInfo.freeMemMb, 0) : null,
    diskPct: Number.isFinite(disk) ? round(disk) : null,
    cpuPct: typeof system?.cpuInfo?.usedPercentage === "number" ? round(system.cpuInfo.usedPercentage) : null,
    load1: system?.cpuInfo?.loadavg?.[0] ?? null,
    instances: instances.sort((a, b) => a.service.localeCompare(b.service)),
    topMemory: [...memory].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([service, bytes]) => ({ service, mb: round(bytes / 1048576, 0) })),
  };
}

type Alert = string;

async function state<T>(tx: Tx, key: string): Promise<T | null> {
  const [row] = await tx<{ value: T }[]>`select value from infra_radar_state where key = ${key} for update`;
  return row?.value ?? null;
}
async function setState(tx: Tx, key: string, value: unknown) {
  await tx`insert into infra_radar_state (key, value, updated_at) values (${key}, ${tx.json(value as never)}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
}
async function event(tx: Tx, kind: string, subject: string, detail: Record<string, unknown>, dedupe: string | null = null) {
  const rows = await tx`insert into infra_radar_events (kind, subject, detail, dedupe, created_at) values (${kind}, ${subject}, ${tx.json(detail as never)}, ${dedupe}, clock_timestamp())
    on conflict (dedupe) where dedupe is not null do nothing returning id`;
  return rows.length > 0;
}
/** Avisa una vez cada `ms` por tema: una RAM alta sostenida no tiene que llegar cada diez minutos. */
async function cooled(tx: Tx, key: string, ms = COOLDOWN_MS): Promise<boolean> {
  const last = await state<{ at: string }>(tx, "alert:" + key);
  if (last && Date.parse(last.at) > Date.now() - ms) return false;
  await setState(tx, "alert:" + key, { at: new Date().toISOString() });
  return true;
}

type InstanceState = { reachable: boolean; startedAt: string | null; sessions: Record<string, string>; restrictions?: Record<string, string | null> };

/** Solo avisan los transportes que Turnia usa: conserva el resto en el panel para diagnóstico. */
function alertSessionsForService(service: string): Set<string> {
  const config = easypanelConfig();
  if (!config) return new Set();
  const host = service.replace("/", "-") + "." + config.host;
  const targets = wahaConnections().filter((c) => c.enabled).map((c) => ({ url: c.url, session: c.session }));
  if (process.env.WAHA_URL) targets.push({ url: process.env.WAHA_URL, session: process.env.WAHA_SESSION || "default" });
  return new Set(targets.filter((t) => {
    try { return new URL(t.url).host === host; } catch { return false; }
  }).map((t) => t.session));
}

/** WAHA calcula Date.now() - uptime en cada GET: una diferencia de milisegundos no es un reinicio. */
function restarted(before: string | null, after: string | null): boolean {
  if (!before || !after) return false;
  const from = Date.parse(before), to = Date.parse(after);
  return Number.isFinite(from) && Number.isFinite(to) && to > from + 5000 && to <= Date.now() + 5000;
}

/** Compara con la corrida anterior, guarda eventos y devuelve lo que hay que avisar. */
export async function recordRadar(snapshot: RadarSnapshot): Promise<Alert[]> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('infra-radar', 0))`;
    const alerts: Alert[] = [];
    for (const inst of snapshot.instances) {
      const key = "waha:" + inst.service;
      const prev = await state<InstanceState>(tx, key);
      const sessions = Object.fromEntries(inst.sessions.map((s) => [s.name, s.status]));
      const alertSessions = alertSessionsForService(inst.service);
      if (prev && prev.reachable && !inst.reachable) {
        await event(tx, "unreachable", inst.service, { error: inst.error });
        if (alertSessions.size) alerts.push("🔴 " + inst.service + " no responde (" + (inst.error ?? "sin detalle") + ").");
      } else if (prev && !prev.reachable && inst.reachable) {
        await event(tx, "reachable", inst.service, {});
      }
      if (inst.reachable && restarted(prev?.startedAt ?? null, inst.startedAt)) {
        await event(tx, "restart", inst.service, { from: prev?.startedAt, to: inst.startedAt, version: inst.version });
      }
      if (inst.reachable) {
        for (const s of inst.sessions) {
          const before = prev?.sessions?.[s.name] ?? null;
          if (before === s.status) continue;
          await event(tx, "session", inst.service + "/" + s.name, { from: before, to: s.status, phone: s.phone });
          // La primera vez que se ve una sesión no se avisa: es el punto de partida del radar.
          if (alertSessions.has(s.name) && (before === "WORKING" || before === "STARTING") && s.status !== "WORKING" && s.status !== "STARTING") {
            const line = s.phone ? " (…" + s.phone + ")" : "";
            alerts.push("🔴 WhatsApp" + line + " pasó de " + before + " a " + s.status + " en " + inst.service + ". La conexión no está operativa. Revisar su estado antes de intervenir o reenviar avisos.");
          }
        }
        for (const s of inst.sessions) {
          if (s.status !== "WORKING") continue;
          const before = prev?.restrictions?.[s.name] ?? null;
          const now = s.restriction ?? null;
          if (before === now) continue;
          await event(tx, "restriction", inst.service + "/" + s.name, { from: before, to: now, phone: s.phone });
          const line = s.phone ? " (…" + s.phone + ")" : "";
          if (alertSessions.has(s.name) && now && (!before || before.startsWith("aviso de tope")) && !now.startsWith("aviso de tope")) {
            alerts.push("🔴 WhatsApp frenó la línea" + line + " en " + inst.service + ": " + now + ". NO reiniciar ni re-vincular (no lo levanta y empeora la línea). Frenar los mensajes a contactos nuevos; los pacientes que ya escribieron siguen recibiendo.");
          }
        }
      }
      if (inst.memoryMb && inst.memoryLimitMb && inst.memoryMb >= inst.memoryLimitMb * CONTAINER_ALERT_PCT / 100 && await cooled(tx, "container:" + inst.service)) {
        await event(tx, "container_memory", inst.service, { mb: inst.memoryMb, limit: inst.memoryLimitMb });
      }
      await setState(tx, key, inst.reachable
        ? { reachable: true, startedAt: inst.startedAt, sessions, restrictions: Object.fromEntries(inst.sessions.filter((x) => x.status === "WORKING").map((x) => [x.name, x.restriction ?? null])) }
        : { reachable: false, startedAt: prev?.startedAt ?? null, sessions: prev?.sessions ?? {}, restrictions: prev?.restrictions ?? {} });
    }
    if (snapshot.memoryPct !== null && snapshot.memoryPct >= RAM_ALERT_PCT && await cooled(tx, "memory")) {
      await event(tx, "memory", "vps", { pct: snapshot.memoryPct, freeMb: snapshot.memoryFreeMb, top: snapshot.topMemory });
    }
    if (snapshot.diskPct !== null && snapshot.diskPct >= DISK_ALERT_PCT && await cooled(tx, "disk")) {
      await event(tx, "disk", "vps", { pct: snapshot.diskPct });
    }
    await tx`insert into infra_radar_samples (memory_pct, disk_pct, cpu_pct, load1, instances)
      values (${snapshot.memoryPct}, ${snapshot.diskPct}, ${snapshot.cpuPct}, ${snapshot.load1}, ${tx.json(snapshot.instances.map((i) => ({
        service: i.service, reachable: i.reachable, memoryMb: i.memoryMb, sessions: i.sessions,
      })) as never)})`;
    await tx`delete from infra_radar_samples where created_at < now() - make_interval(days => ${KEEP_DAYS})`;
    await tx`delete from infra_radar_events where created_at < now() - make_interval(days => ${KEEP_DAYS})`;
    return alerts;
  });
}

/** Corrida del cron. Sin Easypanel configurado no hace nada (y lo dice). */
export async function runInfraRadar() {
  const config = easypanelConfig();
  if (!config) return { configured: false as const };
  let snapshot: RadarSnapshot;
  try {
    snapshot = await readRadar(config);
  } catch (e) {
    const alerts = await sql.begin(async (tx) => {
      await event(tx, "easypanel_error", "vps", { error: e instanceof Error ? e.message : "error" });
      return await cooled(tx, "easypanel", 3600_000) ? ["🔴 El radar no pudo leer Easypanel: el VPS puede estar caído."] : [];
    });
    if (alerts.length) await notifyAxel("⚠️ Turnia · radar\n" + alerts.join("\n"));
    return { configured: true as const, error: "No se pudo leer Easypanel" };
  }
  const alerts = await recordRadar(snapshot);
  if (alerts.length) await notifyAxel("⚠️ Turnia · radar de WhatsApp\n" + alerts.join("\n"));
  return {
    configured: true as const,
    ram: snapshot.memoryPct, disco: snapshot.diskPct,
    instancias: snapshot.instances.map((i) => ({ servicio: i.service, ok: i.reachable, sesiones: i.sessions.map((s) => (s.phone ? "…" + s.phone + " " : "") + s.status + (s.restriction ? " (" + s.restriction + ")" : "")) })),
    avisos: alerts.length,
  };
}

/** El aviso `session.status` de WAHA, en el momento en que pasa (el cron lo vería hasta diez minutos después). */
export async function recordSessionStatus(input: { line: string; session: string; status: string; phone: string | null; at: string | null }) {
  const subject = input.line + "/" + input.session;
  const alert = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${"infra-radar-hook:" + subject}::text, 0))`;
    const prev = await state<{ status: string }>(tx, "hook:" + subject);
    await setState(tx, "hook:" + subject, { status: input.status, at: input.at });
    if (prev?.status === input.status) return null;
    await event(tx, "webhook_status", subject, { from: prev?.status ?? null, to: input.status, phone: lastDigits(input.phone), at: input.at });
    // STARTING es de paso; las recuperaciones se conservan en el panel sin mandar avisos.
    if (input.status === "STARTING" || !prev) return null;
    const line = input.phone ? " (…" + lastDigits(input.phone) + ")" : "";
    if (input.status === "WORKING") return null;
    const enabled = input.line === "general"
      ? Boolean(process.env.WAHA_URL) && input.session === (process.env.WAHA_SESSION || "default")
      : wahaConnections().some((c) => c.enabled && c.id === input.line && c.session === input.session);
    if (!enabled || (prev.status !== "WORKING" && prev.status !== "STARTING")) return null;
    return "🔴 WhatsApp" + line + " pasó a " + input.status + " (" + input.line + "). Ver radar en los logs.";
  });
  if (alert) await notifyAxel("⚠️ Turnia · WhatsApp\n" + alert);
  return alert;
}

/** Lo que importa de un log de WAHA para entender una caída. */
const IMPORTANT = /logged ?out|logout|conflict|replaced|FAILED|SCAN_QR|stream errored|connection (closed|lost|failure)|restart required|bad ?session|unauthorized|ECONN|ETIMEDOUT|heap|out of memory|killed|status (code )?(401|403|408|411|428|440|500|503|515)/i;
const NOISE = /request completed|POST request was sent with status code: 2\d\d|Sending POST|Closing session|SessionEntry|privKey|rootKey|<Buffer|Mapped \{|non-existent (message|contact)|failed to decrypt poll vote/i;

/** Saca teléfonos y JIDs: un log puede traer el número de un paciente. */
export function redactLogLine(text: string): string {
  return text
    .replace(/"(notify|pushName|verifiedName|name|subject)"\s*:\s*"[^"]*"/g, '"$1":"…"')
    .replace(/\d{6,}(?=@|:\d+@)/g, (m) => "…" + m.slice(-4))
    .replace(/\+?\d[\d\s-]{8,}\d/g, (m) => "…" + m.replace(/\D/g, "").slice(-4))
    .slice(0, 1000);
}

export type LogLine = { at?: string | null; level?: string | null; text: string };

/** Lo que manda el lector de logs del VPS. Guarda solo advertencias, errores y cambios de estado. */
export async function ingestWahaLogs(service: string, lines: LogLine[]) {
  const kept = lines
    .filter((l) => l.text && !NOISE.test(l.text) && (/WARN|ERROR|FATAL/i.test(l.level ?? "") || IMPORTANT.test(l.text)))
    .slice(0, 200)
    .map((l) => ({ ...l, text: redactLogLine(l.text) }));
  const result = await sql.begin(async (tx) => {
    await setState(tx, "logs:" + service, { at: new Date().toISOString() });
    let saved = 0, important = 0;
    for (const l of kept) {
      const key = service + ":" + createHmac("sha256", "radar").update(l.text).digest("hex").slice(0, 32);
      if (!(await event(tx, "log", service, { at: l.at ?? null, level: l.level ?? null, text: l.text }, key))) continue;
      saved++;
      if (IMPORTANT.test(l.text)) important++;
    }
    return { saved, important };
  });
  // Un log puede ser histórico o una reconexión ya resuelta. La caída la confirman el estado y el webhook.
  return { saved: result.saved, important: result.important };
}

export type RadarOverview = {
  configured: boolean;
  sample: { created_at: string; memory_pct: number | null; disk_pct: number | null; cpu_pct: number | null; instances: Array<{ service: string; reachable: boolean; memoryMb: number | null; sessions: RadarSession[] }> } | null;
  events: Array<{ kind: string; subject: string; detail: Record<string, unknown>; created_at: string }>;
  logsSeenAt: string | null;
};

export async function radarOverview(): Promise<RadarOverview> {
  const [[sample], events, logs] = await Promise.all([
    sql<NonNullable<RadarOverview["sample"]>[]>`select created_at, memory_pct::float8 as memory_pct, disk_pct::float8 as disk_pct, cpu_pct::float8 as cpu_pct, instances
      from infra_radar_samples order by created_at desc limit 1`,
    sql<RadarOverview["events"]>`select kind, subject, detail, created_at from infra_radar_events order by created_at desc limit 40`,
    sql<{ at: string }[]>`select max(value->>'at') as at from infra_radar_state where key like 'logs:%'`,
  ]);
  return { configured: Boolean(easypanelConfig()), sample: sample ?? null, events, logsSeenAt: logs[0]?.at ?? null };
}
