import { Badge, Card } from "@/components/ui";
import { DISK_ALERT_PCT, RAM_ALERT_PCT, type RadarOverview } from "@/lib/infra-radar";

const when = (iso: string) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const KIND: Record<string, string> = {
  session: "Sesión", webhook_status: "Aviso de WAHA", restart: "Reinicio", unreachable: "No responde", reachable: "Volvió",
  memory: "RAM alta", disk: "Disco alto", container_memory: "Memoria del contenedor", log: "Log", easypanel_error: "Easypanel",
};

function describe(e: { kind: string; detail: Record<string, unknown> }) {
  const d = e.detail;
  if (e.kind === "session" || e.kind === "webhook_status") return `${d.phone ? "…" + d.phone + " " : ""}${d.from ?? "—"} → ${d.to}`;
  if (e.kind === "memory" || e.kind === "disk") return `${d.pct} %`;
  if (e.kind === "container_memory") return `${d.mb} de ${d.limit} MB`;
  if (e.kind === "log") return String(d.text ?? "").slice(0, 160);
  if (e.kind === "unreachable" || e.kind === "easypanel_error") return String(d.error ?? "");
  return "";
}

/** Radar de las WAHA y del VPS: lo último que vio el cron y los cambios de los últimos días. */
export function RadarCard({ radar }: { radar: RadarOverview | null }) {
  if (!radar) return null;
  const s = radar.sample;
  return (
    <Card>
      <h2 className="mb-1 font-semibold text-brand-950">Radar de WhatsApp y VPS</h2>
      {!radar.configured ? (
        <p className="text-sm text-brand-900/70">Falta cargar <code className="text-xs">EASYPANEL_API_URL</code> y <code className="text-xs">EASYPANEL_API_TOKEN</code> en Vercel.</p>
      ) : !s ? (
        <p className="text-sm text-brand-900/70">Todavía no corrió: se actualiza cada diez minutos.</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-brand-900/60">
            {when(s.created_at)} · RAM <Badge tone={(s.memory_pct ?? 0) >= RAM_ALERT_PCT ? "red" : "green"}>{s.memory_pct ?? "?"} %</Badge>{" "}
            · disco <Badge tone={(s.disk_pct ?? 0) >= DISK_ALERT_PCT ? "red" : "green"}>{s.disk_pct ?? "?"} %</Badge> · CPU {s.cpu_pct ?? "?"} %
            {" "}· logs {radar.logsSeenAt ? "leídos " + when(radar.logsSeenAt) : "sin lector"}
          </p>
          <ul className="space-y-1 text-sm">
            {s.instances.map((i) => (
              <li key={i.service} className="flex flex-wrap items-center gap-2">
                <code className="text-xs">{i.service}</code>
                {!i.reachable ? <Badge tone="red">No responde</Badge> : i.sessions.map((x) => (
                  <Badge key={x.name} tone={x.status === "WORKING" ? "green" : "red"}>{x.phone ? "…" + x.phone + " " : ""}{x.status}</Badge>
                ))}
                {i.memoryMb ? <span className="text-xs text-brand-900/60">{i.memoryMb} MB</span> : null}
              </li>
            ))}
          </ul>
        </>
      )}
      {radar.events.length > 0 && (
        <details className="mt-4 text-xs">
          <summary className="cursor-pointer text-brand-900/70">Últimos eventos ({radar.events.length})</summary>
          <ul className="mt-2 space-y-1">
            {radar.events.map((e, i) => (
              <li key={i} className="break-words"><span className="text-brand-900/60">{when(e.created_at)}</span> · <b>{KIND[e.kind] ?? e.kind}</b> · {e.subject} {describe(e)}</li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
