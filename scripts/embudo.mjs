// Embudo semanal de Turnia (ver EMBUDO.md): imprime la tabla en Markdown para pegarla en EMBUDO.md.
//
//   POSTHOG_PERSONAL_API_KEY=phx_… [DATABASE_URL=postgres://…] npm run embudo
//
// - Etapas 1 a 4 (saludos, demos enviadas, visitadas y con interacción): PostHog.
// - Etapas 5 a 7 (cuentas creadas, cuentas activas, clientes pagos): la base (Neon). Sin
//   DATABASE_URL esas filas salen como «sin base».
// - Semanas de lunes a domingo, hora de Buenos Aires. La semana 1 empieza el lunes 26/10/2026.
// - Cada prospecto o cuenta se cuenta una sola vez, en la semana en que llegó por primera vez a la
//   etapa. Excepción: «Cuentas activas» se mide de nuevo cada semana.
// Solo lee: no escribe en PostHog ni en la base.

const TZ = "America/Argentina/Buenos_Aires";
const WEEK_1 = "2026-10-26";
// Cuenta activa en una semana: Sofi atendió al menos ACTIVE_MIN_PATIENTS pacientes distintos y dio
// al menos ACTIVE_MIN_APPOINTMENTS turnos (no cargados a mano en el panel). Ver EMBUDO.md.
const ACTIVE_MIN_PATIENTS = 3;
const ACTIVE_MIN_APPOINTMENTS = 1;

const POSTHOG_HOST = (process.env.POSTHOG_HOST || "https://us.posthog.com").replace(/\/$/, "");
// El proyecto se comparte con otros productos: todo se filtra a los eventos de Turnia.
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID || "518346";
const POSTHOG_KEY = process.env.POSTHOG_PERSONAL_API_KEY?.trim();
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;

const STAGES = [
  ["saludos", "Saludos enviados"],
  ["demos_enviadas", "Demos enviadas"],
  ["demos_visitadas", "Demos visitadas"],
  ["demos_interaccion", "Demos con interacción"],
  ["cuentas_creadas", "Cuentas creadas"],
  ["cuentas_activas", "Cuentas activas"],
  ["clientes", "Clientes pagos"],
];
const FROM_DB = new Set(["cuentas_creadas", "cuentas_activas", "clientes"]);

const isoDay = (date) => date.toISOString().slice(0, 10);
const addDays = (day, n) => isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000));
const short = (day) => `${Number(day.slice(8, 10))}/${Number(day.slice(5, 7))}`;

/** Lunes de cada semana, desde la semana 1 hasta la actual (Buenos Aires). */
function weeks() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const monday = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const list = [];
  for (let day = WEEK_1; day <= monday; day = addDays(day, 7)) list.push(day);
  return { list, today };
}

async function hogql(query) {
  const response = await fetch(`${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${POSTHOG_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });
  if (!response.ok) throw new Error(`PostHog respondió ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return (await response.json()).results;
}

/** Etapas 1 a 4: { etapa: { lunes: cantidad } }. */
async function posthogStages() {
  const week = (column) => `toString(toStartOfWeek(toTimeZone(${column}, '${TZ}'), 1))`;
  // Solo prospectos (`prospecto:<código>`), solo producción y sin tráfico interno. Los dispositivos
  // internos y la vista desde el panel nunca se identifican como prospecto.
  const base = `distinct_id LIKE 'prospecto:%' AND properties.app_env = 'production'
    AND coalesce(properties.is_internal, false) = false AND timestamp >= toDateTime('${WEEK_1} 00:00:00', '${TZ}')`;
  const rows = await hogql(`
    SELECT stage, ${week("first_at")} AS semana, count() FROM (
      -- Saludos y demos enviadas: cuentan si el último envío no se deshizo después.
      SELECT 'saludos' AS stage, distinct_id,
        minIf(timestamp, event = 'prospect_greeting_sent') AS first_at,
        maxIf(timestamp, event = 'prospect_greeting_sent') AS last_sent,
        maxIf(timestamp, event = 'prospect_contact_undone' AND properties.contact_kind = 'saludo') AS last_undo
      FROM events WHERE ${base} AND event IN ('prospect_greeting_sent', 'prospect_contact_undone')
      GROUP BY distinct_id HAVING countIf(event = 'prospect_greeting_sent') > 0 AND last_sent > last_undo
      UNION ALL
      SELECT 'demos_enviadas', distinct_id,
        minIf(timestamp, event = 'prospect_pitch_sent'),
        maxIf(timestamp, event = 'prospect_pitch_sent') AS last_sent,
        maxIf(timestamp, event = 'prospect_contact_undone' AND properties.contact_kind = 'mensaje') AS last_undo
      FROM events WHERE ${base} AND event IN ('prospect_pitch_sent', 'prospect_contact_undone')
      GROUP BY distinct_id HAVING countIf(event = 'prospect_pitch_sent') > 0 AND last_sent > last_undo
      UNION ALL
      SELECT 'demos_visitadas', distinct_id, min(timestamp), max(timestamp), toDateTime(0)
      FROM events WHERE ${base} AND event = 'personal_demo_viewed' AND coalesce(properties.preview, false) = false
      GROUP BY distinct_id
      UNION ALL
      -- Al menos una conversación (voz o chat) con Sofi dentro de su demo.
      SELECT 'demos_interaccion', distinct_id, min(timestamp), max(timestamp), toDateTime(0)
      FROM events WHERE ${base} AND event = 'demo_conversation_started'
      GROUP BY distinct_id
    ) GROUP BY stage, semana`);
  const out = {};
  for (const [stage, monday, count] of rows) (out[stage] ??= {})[monday] = count;
  return out;
}

/** Etapas 5 a 7 desde la base: { etapa: { lunes: cantidad } }. */
async function databaseStages(from) {
  const { default: postgres } = await import("postgres");
  const sql = postgres(DATABASE_URL, { max: 1, prepare: false, idle_timeout: 5 });
  const week = (column) => sql`to_char(date_trunc('week', ${sql(column)} at time zone ${TZ}), 'YYYY-MM-DD')`;
  try {
    // Una cuenta es un consultorio con acceso propio al panel (código de «Acceso del consultorio»),
    // que no se revocó. Cuenta en la semana de su primer código.
    const accounts = sql`
      select clinic_id, min(created_at) as created_at from clinic_access
      group by clinic_id having bool_or(revoked_at is null)`;
    const [created, active, clients] = await Promise.all([
      sql`select ${week("created_at")} as semana, count(*)::int as n from (${accounts}) a group by 1`,
      sql`
        with cuentas as (${accounts}),
        pacientes as (
          select v.clinic_id, ${week("v.started_at")} as semana, count(distinct v.patient_id) as n
          from conversations v join cuentas c using (clinic_id)
          where v.patient_id is not null and v.started_at >= ${from}::date group by 1, 2),
        turnos as (
          select a.clinic_id, ${week("a.created_at")} as semana, count(*) as n
          from appointments a join cuentas c using (clinic_id)
          where a.source <> 'panel' and a.created_at >= ${from}::date group by 1, 2)
        select p.semana, count(*)::int as n from pacientes p join turnos t using (clinic_id, semana)
        where p.n >= ${ACTIVE_MIN_PATIENTS} and t.n >= ${ACTIVE_MIN_APPOINTMENTS} group by 1`,
      // Cliente pago: está en «Cliente» en Prospección (se marca cuando paga el primer mes). Cuenta en
      // la semana en que se marcó por primera vez.
      sql`
        select ${week("first_at")} as semana, count(*)::int as n from (
          select o.id, min(e.created_at) as first_at
          from sales_outreach o join sales_outreach_events e on e.outreach_id = o.id
          where o.status = 'cliente' and e.kind = 'estado' and split_part(e.detail, ':', 1) = 'cliente'
          group by o.id) c
        group by 1`,
    ]);
    const toMap = (rows) => Object.fromEntries(rows.map((r) => [r.semana, r.n]));
    return { cuentas_creadas: toMap(created), cuentas_activas: toMap(active), clientes: toMap(clients) };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  if (!POSTHOG_KEY) throw new Error("Falta POSTHOG_PERSONAL_API_KEY (clave personal de PostHog, phx_…).");
  const { list, today } = weeks();
  const [ph, db] = await Promise.all([posthogStages(), DATABASE_URL ? databaseStages(WEEK_1) : null]);
  const data = { ...ph, ...(db ?? {}) };

  const header = list.map((monday, i) => `Semana ${i + 1} (${short(monday)}–${short(addDays(monday, 6) < today ? addDays(monday, 6) : today)})`);
  const lines = [
    `| Etapa | ${header.join(" | ")} | Total |`,
    `| --- | ${list.map(() => "---:").join(" | ")} | ---: |`,
  ];
  for (const [key, label] of STAGES) {
    if (FROM_DB.has(key) && !db) {
      lines.push(`| ${label} | ${list.map(() => "sin base").join(" | ")} | sin base |`);
      continue;
    }
    const values = list.map((monday) => data[key]?.[monday] ?? 0);
    // Las activas se miden cada semana: el total es la última semana, no la suma.
    const total = key === "cuentas_activas" ? values.at(-1) : values.reduce((a, b) => a + b, 0);
    lines.push(`| ${label} | ${values.join(" | ")} | ${total} |`);
  }
  console.log(`Embudo de Turnia al ${short(today)}/${today.slice(0, 4)} (lunes a domingo, hora de Buenos Aires)\n`);
  console.log(lines.join("\n"));
  if (!db) console.log("\nSin DATABASE_URL: cuentas y clientes salen de la base (Neon); ver EMBUDO.md.");
}

main().catch((error) => {
  console.error(`[embudo] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
