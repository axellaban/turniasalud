import "server-only";
import { sql } from "./db";
import { notifyAxel } from "./chat-guard";
import { wahaConnectionForClinic, wahaConnections, type WahaConnection } from "./waha-connections";

export type WahaHealth = { status: string; ready: boolean; reason: string | null };
const STATES = new Set(["WORKING", "FAILED", "STOPPED", "STARTING", "SCAN_QR_CODE"]);

/** Lee la sesión real. Nunca reinicia, desvincula ni cambia una línea. */
export async function readWahaHealth(connection: WahaConnection): Promise<WahaHealth> {
  try {
    const response = await fetch(connection.url.replace(/\/$/, "") + "/api/sessions/" + encodeURIComponent(connection.session), {
      headers: { "X-Api-Key": connection.apiKey }, cache: "no-store", signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return { status: "ERROR", ready: false, reason: "WAHA HTTP " + response.status };
    const body = await response.json() as { status?: string; me?: { id?: string } };
    const status = STATES.has(body.status ?? "") ? body.status! : "UNKNOWN";
    const phone = body.me?.id?.split("@")[0]?.split(":")[0];
    if (status === "WORKING" && phone !== connection.phone) {
      return { status: "WRONG_NUMBER", ready: false, reason: "La cuenta conectada no coincide con la línea configurada." };
    }
    return { status, ready: status === "WORKING", reason: status === "WORKING" ? null : "Sesión " + status };
  } catch {
    // No persistir respuestas crudas ni credenciales del proveedor.
    return { status: "ERROR", ready: false, reason: "No se pudo consultar la sesión de WAHA." };
  }
}

export async function clinicWhatsappStatus(clinicId: string): Promise<WahaHealth> {
  const connection = wahaConnectionForClinic(clinicId);
  return connection?.enabled ? readWahaHealth(connection)
    : { status: "OFF", ready: false, reason: "No hay una línea propia de WhatsApp habilitada." };
}

export type StoredWahaHealth = { status: string; checked_at: string; failure_at: string | null };
export async function lastClinicWhatsappHealth(clinicId: string): Promise<StoredWahaHealth | null> {
  return (await sql<StoredWahaHealth[]>`select status, checked_at, failure_at from waha_connection_health where clinic_id = ${clinicId} limit 1`)[0] ?? null;
}

/** El cron existente de diez minutos detecta una caída aunque no lleguen mensajes. */
export async function monitorClinicWhatsapps() {
  const results: Array<{ connection: string; status: string }> = [];
  for (const connection of wahaConnections().filter((c) => c.enabled)) {
    const health = await readWahaHealth(connection);
    const alert = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${"waha-health:" + connection.id}::text, 0))`;
      const [previous] = await tx`select * from waha_connection_health where connection_id = ${connection.id}`;
      const changed = previous?.status !== health.status;
      const due = !health.ready && (!previous?.alerted_at || Date.parse(previous.alerted_at) < Date.now() - 3600_000);
      await tx`
        insert into waha_connection_health (connection_id, clinic_id, status, checked_at, last_working_at, failure_at, error, alerted_at)
        values (${connection.id}, ${connection.clinicId}, ${health.status}, now(),
          ${health.ready ? new Date() : null}, ${health.ready ? null : new Date()}, ${health.reason}, ${due ? new Date() : null})
        on conflict (connection_id) do update set status = excluded.status, clinic_id = excluded.clinic_id,
          checked_at = now(), last_working_at = coalesce(excluded.last_working_at, waha_connection_health.last_working_at),
          failure_at = case when ${health.ready} then null else coalesce(waha_connection_health.failure_at, now()) end,
          error = excluded.error, alerted_at = case when ${health.ready} then null when ${due} then now() else waha_connection_health.alerted_at end`;
      if (changed) {
        await tx`insert into waha_health_events (connection_id, clinic_id, status, reason)
          values (${connection.id}, ${connection.clinicId}, ${health.status}, ${health.reason})`;
        const log = health.ready ? console.info : console.warn;
        log(JSON.stringify({ evento: "estado_whatsapp", conexion: connection.id, estado: health.status, motivo: health.reason }));
      }
      if (!health.ready && (!previous || previous.status === "WORKING")) {
        await tx`insert into tasks (clinic_id, type, priority, title, details)
          values (${connection.clinicId}, 'administrativo', 'alta', 'Revisar conexión de WhatsApp',
            ${"La línea propia no está operativa (" + health.status + "). Revisar WAHA y las confirmaciones pendientes. No reenviar avisos antiguos sin comprobar la agenda."})`;
      }
      return due;
    });
    if (alert) await notifyAxel("⚠️ Turnia · WhatsApp " + connection.id + ": " + health.status +
      ". La línea del consultorio no está lista para enviar o recibir. Revisar WAHA y confirmaciones pendientes.");
    results.push({ connection: connection.id, status: health.status });
  }
  return results;
}
