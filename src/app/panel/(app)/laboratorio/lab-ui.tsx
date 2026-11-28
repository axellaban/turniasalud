import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, PageHeader, Tabs } from "@/components/ui";
import { DIMENSION_HELP, DIMENSION_LABEL, WEIGHTS, band, type Dims, type Verdict } from "@/lib/lab/score";
import { DIMS, num } from "@/lib/lab/panel";
import type { LabLine } from "@/lib/lab/transcript";
import type { LabFinding } from "@/lib/lab/judge";

// Piezas de las pantallas del Laboratorio de Sofi.

export const LAB_TABS = [
  { href: "/panel/laboratorio", label: "Resumen" },
  { href: "/panel/laboratorio/jugar", label: "Jugar de paciente" },
  { href: "/panel/laboratorio/charlas", label: "Charlas" },
  { href: "/panel/laboratorio/cobertura", label: "Cobertura" },
  { href: "/panel/laboratorio/mejoras", label: "Mejoras" },
  { href: "/panel/laboratorio/experimentos", label: "Experimentos" },
  { href: "/panel/laboratorio/corridas", label: "Corridas" },
  { href: "/panel/laboratorio/criterios", label: "Criterios" },
];

export function LabHeader({ current, title, description, actions, counts = {} }: {
  current: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  counts?: Record<string, number>;
}) {
  return (
    <>
      <PageHeader title={title} description={description} actions={actions} />
      <Tabs items={LAB_TABS.map((t) => ({ ...t, ...(counts[t.href] ? { count: counts[t.href] } : {}) }))} current={current} />
    </>
  );
}

export const fmtScore = (v: unknown) => {
  const n = num(v);
  return n === null ? "—" : String(Math.round(n));
};

const BAND = {
  muy_bien: { tone: "#4eb49e", label: "Muy bien", badge: "bg-emerald/15 text-emerald-700" },
  bien: { tone: "#ff9a1f", label: "Bien, con fallas para corregir", badge: "bg-sun-100 text-sun-700" },
  corregir: { tone: "#dc2626", label: "Hay que corregir", badge: "bg-red-50 text-red-700" },
} as const;

export function scoreTone(v: unknown): string {
  const b = band(num(v));
  return b ? BAND[b].tone : "#c9cfdc";
}

export function BandBadge({ score }: { score: unknown }) {
  const b = band(num(score));
  if (!b) return <Badge>Sin puntaje</Badge>;
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${BAND[b].badge}`}>{BAND[b].label}</span>;
}

/** Puntaje grande con su anillo. */
export function ScoreRing({ score, size = 148, label = "de 100" }: { score: unknown; size?: number; label?: string }) {
  const n = num(score);
  const dash = n === null ? 0 : (Math.max(0, Math.min(100, n)) / 100) * 327;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={n === null ? "Sin puntaje" : `Puntaje ${Math.round(n)} de 100`}>
        <circle cx="60" cy="60" r="52" fill="none" stroke="#eef1f8" strokeWidth="10" />
        <circle cx="60" cy="60" r="52" fill="none" stroke={scoreTone(n)} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${dash} 327`} transform="rotate(-90 60 60)" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-4xl font-semibold leading-none text-brand-950">{fmtScore(n)}</span>
        <span className="text-xs text-brand-900/65">{label}</span>
      </div>
    </div>
  );
}

/** Barras por dimensión (con la otra corrida al lado, si se compara). */
export function DimBars({ dims, compare, showHelp = true }: { dims: Dims | null; compare?: Dims | null; showHelp?: boolean }) {
  return (
    <ul className="space-y-3.5">
      {DIMS.map((d) => {
        const v = num(dims?.[d]);
        const c = compare ? num(compare[d]) : null;
        return (
          <li key={d}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium text-brand-950">
                {DIMENSION_LABEL[d]} <span className="font-normal text-brand-900/60">· {WEIGHTS[d]} %</span>
              </span>
              <span className="font-semibold text-brand-950">
                {compare !== undefined && <span className="mr-1 font-normal text-brand-900/60">{fmtScore(c)} →</span>}
                {v === null ? <span className="font-normal text-brand-900/60">no aplica</span> : Math.round(v)}
              </span>
            </div>
            {compare !== undefined && (
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#eef1f8]">
                <div className="h-1.5 rounded-full bg-brand-200" style={{ width: `${c ?? 0}%` }} />
              </div>
            )}
            <div className={`${compare !== undefined ? "mt-0.5" : "mt-1.5"} h-2 overflow-hidden rounded-full bg-[#eef1f8]`}>
              <div className="h-2 rounded-full" style={{ width: `${v ?? 0}%`, background: compare !== undefined ? "#2157e1" : scoreTone(v) }} />
            </div>
            {showHelp && <p className="mt-1 text-xs text-brand-900/60">{DIMENSION_HELP[d]}</p>}
          </li>
        );
      })}
    </ul>
  );
}

/** La charla con las herramientas que usó Sofi. */
export function Transcript({ lines, history = [] }: { lines: LabLine[]; history?: LabLine[] }) {
  if (!lines.length && !history.length) return <p className="text-sm text-brand-900/60">Sin mensajes.</p>;
  const all = [...history.map((l) => ({ ...l, old: true })), ...lines.map((l) => ({ ...l, old: false }))];
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-[#f3efe8] p-3 sm:p-4">
      {all.map((l, i) => (
        <div key={i} className={`flex flex-col gap-1 ${l.role === "paciente" ? "items-end" : "items-start"} ${l.old ? "opacity-60" : ""}`}>
          {l.tools.map((t, j) => (
            <details key={j} className={`max-w-[92%] rounded-xl border px-3 py-1.5 font-mono text-xs ${t.error ? "border-red-200 bg-red-50 text-red-800" : "border-brand-900/10 bg-white/80 text-brand-900/80"}`}>
              <summary className="cursor-pointer">{t.name}{t.error ? " · error" : ""}</summary>
              {t.params && <p className="mt-1 break-all">→ {t.params}</p>}
              {t.result !== null && <p className="mt-1 break-all">← {t.result}</p>}
            </details>
          ))}
          {l.text && (
            <p className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${l.role === "paciente" ? "rounded-tr-sm bg-[#dcf2e6] text-brand-950" : "rounded-tl-sm border border-brand-900/10 bg-white text-brand-950"}`}>
              {l.text}
            </p>
          )}
        </div>
      ))}
      {history.length > 0 && <p className="text-center text-xs text-brand-900/60">Lo atenuado es el historial que traía el caso.</p>}
    </div>
  );
}

function VerdictItem({ v }: { v: Verdict }) {
  return (
    <li className="flex gap-2.5 py-2">
      <span aria-label={v.pass ? "Cumple" : "No cumple"} className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-bold ${v.pass ? "bg-emerald/15 text-emerald-700" : "bg-red-50 text-red-700"}`}>
        {v.pass ? "✓" : "✕"}
      </span>
      <span>
        {v.text}
        {v.critical && <span className="ml-1 text-xs font-semibold text-red-700">· crítica</span>}
        {!v.pass && v.reason && <span className="mt-0.5 block text-xs text-brand-900/70">{v.reason}</span>}
      </span>
    </li>
  );
}

/** Las condiciones que no cumplió, a la vista; las que cumplió, plegadas. */
export function Verdicts({ items }: { items: Verdict[] }) {
  if (!items.length) return null;
  const failed = items.filter((v) => !v.pass);
  const passed = items.filter((v) => v.pass);
  return (
    <div className="text-sm">
      {failed.length > 0 && <ul className="divide-y divide-brand-900/5">{failed.map((v, i) => <VerdictItem key={i} v={v} />)}</ul>}
      {passed.length > 0 && (
        <details className={failed.length ? "mt-2" : ""} open={!failed.length && passed.length <= 3}>
          <summary className="cursor-pointer font-medium text-emerald-700">Cumple {passed.length} de {items.length}</summary>
          <ul className="divide-y divide-brand-900/5">{passed.map((v, i) => <VerdictItem key={i} v={v} />)}</ul>
        </details>
      )}
    </div>
  );
}

export function Findings({ items }: { items: LabFinding[] | null }) {
  if (!items?.length) return null;
  return (
    <ul className="space-y-2 text-sm">
      {items.map((f, i) => (
        <li key={i} className="rounded-xl bg-[#f6f7fb] px-3 py-2">
          <span className="font-medium">{f.problema}</span>
          <span className="ml-1 text-xs text-brand-900/60">· {DIMENSION_LABEL[f.dimension] ?? f.dimension} · {f.gravedad}</span>
          {f.cita && <span className="mt-1 block text-xs text-brand-900/75">«{f.cita}»</span>}
          {f.mejora && <span className="mt-1 block text-xs text-emerald-700">Mejor: {f.mejora}</span>}
        </li>
      ))}
    </ul>
  );
}

export const RUN_STATUS: Record<string, { label: string; tone: "gray" | "green" | "yellow" | "red" | "blue" }> = {
  preparando: { label: "Preparando", tone: "gray" },
  corriendo: { label: "Simulando", tone: "blue" },
  puntuando: { label: "Puntuando", tone: "yellow" },
  terminada: { label: "Terminada", tone: "green" },
  error: { label: "Con error", tone: "red" },
};

export const KIND_LABEL: Record<string, string> = { bateria: "Batería", experimento: "Experimento", jugar: "Jugar de paciente", verificacion: "Verificación con producción" };

export function RunLink({ id, children }: { id: string; children: ReactNode }) {
  return <Link href={`/panel/laboratorio/corridas/${id}`} className="font-medium text-brand-700 hover:underline">{children}</Link>;
}

/** Con qué motor y modelo respondió Sofi en la corrida. */
export const modelLabel = (llm: string | null | undefined, engine?: string | null) => {
  const model = !llm ? "Opus (modelo de producción)" : /haiku/i.test(llm) ? `Haiku (${llm})` : llm;
  return engine === "simulador" ? `Simulador propio · ${model}` : `ElevenLabs · ${model}`;
};

/** El consumo de una corrida en una línea: simulador, ElevenLabs y juez, con el total. */
export function usageText(usage: { simulador?: { usd: number; charlas: number }; elevenlabs?: { v?: number; simulaciones: number; con_datos: number; creditos: number; usd?: number }; juez?: { usd: number; llamadas: number; segunda_instancia_llamadas?: number; segunda_instancia_usd?: number } } | null | undefined): string | null {
  if (!usage) return null;
  const parts: string[] = [];
  if (usage.simulador) parts.push(`Simulador: USD ${Number(usage.simulador.usd).toFixed(3)} (${usage.simulador.charlas} charlas)`);
  const el = usage.elevenlabs;
  if (el && el.v === 2) {
    parts.push(el.con_datos
      ? `ElevenLabs: ${Math.round(el.creditos).toLocaleString("es-AR")} créditos · USD ${(el.usd ?? 0).toFixed(2)} (${el.con_datos} simulaciones)`
      : `ElevenLabs: sin datos de consumo (${el.simulaciones} simulaciones)`);
  } else if (el) {
    parts.push("ElevenLabs: recalculando el consumo…");
  }
  if (usage.juez) {
    const second = Number(usage.juez.segunda_instancia_llamadas ?? 0);
    const haikuCalls = usage.juez.llamadas - second;
    parts.push(`Juez: USD ${(Number(usage.juez.usd) - Number(usage.juez.segunda_instancia_usd ?? 0)).toFixed(3)} (${haikuCalls} evaluaciones)`);
    if (second) parts.push(`Opus (segunda instancia): USD ${Number(usage.juez.segunda_instancia_usd ?? 0).toFixed(3)} (${second} revisiones)`);
  }
  const total = Number(usage.simulador?.usd ?? 0) + (el?.v === 2 ? el.usd ?? 0 : 0) + Number(usage.juez?.usd ?? 0);
  if (total) parts.push(`Total: USD ${total.toFixed(2)}`);
  return parts.length ? parts.join(" · ") : null;
}
