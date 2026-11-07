"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Badge, Card, buttonClass, ghostButtonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import { CTA_KEYS, CTA_LABEL, VARIABLES, pct, type Channel, type Cta, type VersionStatus } from "@/lib/sales/followup-stages";
import type { QueueItem, StageView } from "@/lib/sales/followup";
import { createFollowupVersionAction, markFollowupAction, prepareFollowupAction, setFollowupVersionStatusAction } from "./actions";

type Version = StageView["versions"][number];
type Prepared = Extract<Awaited<ReturnType<typeof prepareFollowupAction>>, { ok: true }>["data"];
type Exec = QueueItem["execution"];

const STATUS: Record<VersionStatus, { label: string; tone: "green" | "yellow" | "gray" }> = {
  active: { label: "Activa", tone: "green" },
  test: { label: "A prueba", tone: "yellow" },
  archived: { label: "Archivada", tone: "gray" },
};
const EXEC: Record<"pending" | "opened" | "sent" | "failed", { label: string; tone: "gray" | "yellow" | "green" | "red" }> = {
  pending: { label: "Pendiente", tone: "gray" },
  opened: { label: "Abierto", tone: "yellow" },
  sent: { label: "Enviado", tone: "green" },
  failed: { label: "No salió", tone: "red" },
};
const PAGE = 25;
const label = "text-[11px] font-semibold uppercase tracking-wider text-brand-900/60";

function ago(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days <= 0 ? "hoy" : days === 1 ? "hace 1 día" : `hace ${days} días`;
}

/** Panel → Follow-up: una franja por etapa del embudo, con su next best action, quienes esperan y los números de cada versión. */
export function FollowupBoard({ stages }: { stages: StageView[] }) {
  const [open, setOpen] = useState<string | null>(() => stages.find((s) => s.queue.length)?.key ?? null);
  const all = stages.flatMap((s) => s.versions);
  const tiles = [
    [stages.reduce((n, s) => n + s.queue.filter((q) => q.execution?.status !== "sent").length, 0), "esperando una acción"],
    [all.reduce((n, v) => n + v.stats.executions, 0), "ejecuciones confirmadas"],
    [all.reduce((n, v) => n + v.stats.conversions, 0), "avanzaron de etapa después"],
    [stages.filter((s) => s.versions.some((v) => v.status === "test")).length, "etapas con prueba A/B"],
  ] as const;
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([value, text]) => (
          <Card key={text} className="p-4">
            <p className="font-display text-2xl tabular-nums text-brand-950">{value}</p>
            <p className="text-sm text-brand-900/70">{text}</p>
          </Card>
        ))}
      </div>
      <div className="space-y-3">
        {stages.map((s, i) => (
          <StageBand key={s.key} stage={s} index={i + 1} open={open === s.key} onToggle={() => setOpen(open === s.key ? null : s.key)} />
        ))}
      </div>
    </>
  );
}

function StageBand({ stage, index, open, onToggle }: { stage: StageView; index: number; open: boolean; onToggle: () => void }) {
  const active = stage.versions.find((v) => v.status === "active");
  const testing = stage.versions.some((v) => v.status === "test");
  const pending = stage.queue.filter((q) => q.execution?.status !== "sent").length;
  return (
    <section data-testid="followup-stage" data-stage={stage.key} className={`overflow-hidden rounded-2xl border bg-white ${open ? "border-brand-300" : "border-brand-900/10"}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 text-left hover:bg-brand-50/50 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="font-semibold text-brand-950">
            <span className="mr-2 text-xs tabular-nums text-brand-900/50">{index}</span>
            {stage.title}
          </p>
          <p className="mt-0.5 text-xs text-brand-900/65">
            <Badge tone="yellow">{pending} esperando</Badge> → {stage.goal}
          </p>
        </div>
        <p className="hidden truncate text-sm text-brand-900/65 md:block">
          {active ? (
            <>
              <span className="font-medium text-brand-950">{active.trigger_label || "Next best action"}:</span> {active.body}
            </>
          ) : (
            "Sin versión activa"
          )}
        </p>
        <div className="flex items-center gap-2 tabular-nums">
          {testing && <Badge tone="yellow">A/B</Badge>}
          {active && <span className="rounded-md border border-brand-900/10 px-1.5 text-xs text-brand-900/60">V{active.version}</span>}
          <span className="min-w-14 text-right text-lg font-bold text-brand-700">{pct(active?.stats.rate ?? null)}</span>
          <span aria-hidden className={`text-brand-900/40 transition ${open ? "rotate-90" : ""}`}>›</span>
        </div>
      </button>
      {open && (
        <div className="border-t border-brand-900/10">
          <Editor stage={stage} />
          <Queue stage={stage} />
          <VersionTable stage={stage} />
        </div>
      )}
    </section>
  );
}

type Draft = { channel: Channel; trigger: string; body: string; ctas: Cta[] };

function Editor({ stage }: { stage: StageView }) {
  const router = useRouter();
  const live = stage.versions.find((v) => v.status === "active") ?? stage.versions.at(-1) ?? null;
  const [selected, setSelected] = useState<string | null>(live?.id ?? null);
  const [draft, setDraft] = useState<Draft | null>(live ? null : { channel: "whatsapp", trigger: "", body: "", ctas: ["whatsapp", "copy"] });
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const current = stage.versions.find((v) => v.id === selected) ?? live;
  const shown: Draft | Version | null = draft ?? current;
  const active = stage.versions.find((v) => v.status === "active");
  const next = Math.max(0, ...stage.versions.map((v) => v.version)) + 1;
  const bodyId = `followup-body-${stage.key}`;

  const act = (work: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) =>
    start(async () => {
      setError("");
      const r = await work();
      if (!r.ok) return setError(r.message ?? "No pudimos guardar.");
      after?.();
      router.refresh();
    });
  const save = (status: "active" | "test") =>
    draft &&
    act(
      () => createFollowupVersionAction({ stage: stage.key, ...draft, status }),
      () => setDraft(null),
    );
  const setStatus = (id: string, status: VersionStatus) => act(() => setFollowupVersionStatusAction(id, status));
  function insert(variable: string) {
    if (!draft) return;
    const el = document.getElementById(bodyId) as HTMLTextAreaElement | null;
    const at = el?.selectionStart ?? draft.body.length;
    setDraft({ ...draft, body: `${draft.body.slice(0, at)}${variable}${draft.body.slice(at)}` });
  }

  return (
    <div className="space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={label}>Versión</span>
        {stage.versions.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => {
              setDraft(null);
              setSelected(v.id);
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm ${!draft && current?.id === v.id ? "border-brand-700 ring-1 ring-brand-700" : "border-brand-900/15"}`}
          >
            V{v.version} <Badge tone={STATUS[v.status].tone}>{STATUS[v.status].label}</Badge>
          </button>
        ))}
        {draft ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-brand-700 px-2.5 py-1 text-sm ring-1 ring-brand-700">
            V{next} <Badge>Borrador</Badge>
          </span>
        ) : (
          <button
            type="button"
            className="rounded-lg border border-dashed border-brand-900/25 px-2.5 py-1 text-sm text-brand-800"
            onClick={() => setDraft(current ? { channel: current.channel, trigger: current.trigger_label, body: current.body, ctas: [...current.ctas] } : { channel: "whatsapp", trigger: "", body: "", ctas: ["whatsapp", "copy"] })}
          >
            + Nueva versión
          </button>
        )}
      </div>
      {shown && (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm">
              <span className="text-xs text-brand-900/65">Cuándo se dispara</span>
              <input
                className={inputClass}
                value={draft ? draft.trigger : (shown as Version).trigger_label}
                readOnly={!draft}
                maxLength={120}
                placeholder="Ej.: 2 días hábiles sin abrirla"
                onChange={(e) => draft && setDraft({ ...draft, trigger: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="text-xs text-brand-900/65">Canal</span>
              <select className={inputClass} value={shown.channel} disabled={!draft} onChange={(e) => draft && setDraft({ ...draft, channel: e.target.value as Channel })}>
                <option value="whatsapp">WhatsApp</option>
                <option value="tarea">Tarea</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="text-xs text-brand-900/65">Cuenta como conversión</span>
              <input className={inputClass} value={`Pasa a «${stage.goal}»`} readOnly />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-xs text-brand-900/65">{draft ? "Next best action" : "Next best action · una versión guardada no se edita: creá una nueva"}</span>
            <textarea
              id={bodyId}
              className={`${inputClass} min-h-28 leading-relaxed`}
              value={shown.body}
              readOnly={!draft}
              maxLength={1500}
              onChange={(e) => draft && setDraft({ ...draft, body: e.target.value })}
            />
          </label>
          {draft && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-brand-900/65">
              Variables:
              {VARIABLES.map(([v, hint]) => (
                <button key={v} type="button" title={hint} onClick={() => insert(v)} className="rounded border border-dashed border-brand-900/20 px-1.5 py-0.5 font-mono text-brand-900">
                  {v}
                </button>
              ))}
            </div>
          )}
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className={`${label} mb-1.5`}>Call to actions para la extensión</legend>
            {CTA_KEYS.map((k) => {
              const on = shown.ctas.includes(k);
              return (
                <label key={k} className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm font-medium ${on ? "border-brand-900/15" : "border-dashed border-brand-900/15 opacity-50"}`}>
                  <input
                    type="checkbox"
                    className="accent-brand-700"
                    checked={on}
                    disabled={!draft}
                    onChange={() => draft && setDraft({ ...draft, ctas: on ? draft.ctas.filter((c) => c !== k) : [...draft.ctas, k] })}
                  />
                  {CTA_LABEL[k]}
                </label>
              );
            })}
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            {draft ? (
              <>
                <button type="button" className={buttonClass} disabled={pending || !draft.body.trim()} onClick={() => save("active")}>
                  Guardar V{next} como activa
                </button>
                {active && (
                  <button type="button" className={secondaryButtonClass} disabled={pending || !draft.body.trim()} onClick={() => save("test")}>
                    Guardar y probar 50/50 contra V{active.version}
                  </button>
                )}
                {stage.versions.length > 0 && (
                  <button type="button" className={ghostButtonClass} onClick={() => setDraft(null)}>
                    Descartar
                  </button>
                )}
              </>
            ) : current?.status === "active" ? (
              <p className="text-sm text-brand-900/65">La activa: la reciben todos los de esta etapa{stage.versions.some((v) => v.status === "test") ? " que no están en la prueba" : ""}.</p>
            ) : current?.status === "test" ? (
              <>
                <button type="button" className={buttonClass} disabled={pending} onClick={() => setStatus(current.id, "active")}>
                  Hacerla la activa
                </button>
                <button type="button" className={secondaryButtonClass} disabled={pending} onClick={() => setStatus(current.id, "archived")}>
                  Detener prueba
                </button>
                <p className="text-sm text-brand-900/65">La recibe la mitad de los de esta etapa.</p>
              </>
            ) : current ? (
              <>
                <button type="button" className={secondaryButtonClass} disabled={pending} onClick={() => setStatus(current.id, "active")}>
                  Volver a activarla
                </button>
                {active && (
                  <button type="button" className={secondaryButtonClass} disabled={pending} onClick={() => setStatus(current.id, "test")}>
                    Probar 50/50 contra V{active.version}
                  </button>
                )}
              </>
            ) : null}
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Queue({ stage }: { stage: StageView }) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, Exec>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const statusOf = (q: QueueItem) => (q.id in state ? state[q.id] : q.execution);
  const done = stage.queue.filter((q) => statusOf(q)?.status === "sent").length;
  function finished(q: QueueItem, exec: Exec) {
    setState((s) => ({ ...s, [q.id]: exec }));
    if (exec?.status !== "sent") return;
    // La próxima pendiente: así se sigue sin buscar.
    const next = stage.queue.find((x) => x.id !== q.id && (x.id in state ? state[x.id] : x.execution)?.status !== "sent");
    setOpen(next?.id ?? null);
    if (next && stage.queue.indexOf(next) >= shown) setShown(stage.queue.indexOf(next) + 1);
  }
  return (
    <div className="space-y-2 border-t border-brand-900/10 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={label}>En esta etapa · {stage.queue.length}</span>
        <span className="text-xs text-brand-900/65">
          <b className="text-brand-950">{done}</b> con la acción enviada · primero los pendientes con WhatsApp ·{" "}
          <button type="button" className="font-semibold text-brand-700 underline" onClick={() => router.refresh()}>
            Actualizar
          </button>
        </span>
      </div>
      {stage.queue.length === 0 ? (
        <p className="text-sm text-brand-900/65">No hay nadie en esta etapa.</p>
      ) : (
        <ul className="divide-y divide-brand-900/5 overflow-hidden rounded-xl border border-brand-900/10">
          {stage.queue.slice(0, shown).map((q) => (
            <QueueRow key={q.id} stage={stage} item={q} exec={statusOf(q)} open={open === q.id} onToggle={() => setOpen(open === q.id ? null : q.id)} onDone={(e) => finished(q, e)} />
          ))}
          {stage.queue.length > shown && (
            <li>
              <button type="button" className="w-full bg-brand-50/60 px-3 py-2 text-sm font-semibold text-brand-700" onClick={() => setShown(shown + PAGE)}>
                Ver {Math.min(PAGE, stage.queue.length - shown)} más · quedan {stage.queue.length - shown}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function QueueRow({ stage, item: q, exec, open, onToggle, onDone }: { stage: StageView; item: QueueItem; exec: Exec; open: boolean; onToggle: () => void; onDone: (e: Exec) => void }) {
  const status = exec?.status ?? "pending";
  const version = stage.versions.find((v) => v.id === q.versionId);
  const testing = stage.versions.some((v) => v.status === "test");
  return (
    <li data-testid="followup-item" data-outreach={q.id} data-status={status} data-version={version?.version ?? ""} className={open ? "bg-brand-50/40" : ""}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-sm md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_5.5rem_7rem]">
        <div className="min-w-0">
          <Link href={`/panel/prospeccion/${q.id}`} className="block truncate font-semibold text-brand-950 hover:underline">
            {q.name}
          </Link>
          <span className="block truncate text-xs text-brand-900/60">{[q.business, q.zone].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="col-start-1 min-w-0 md:col-start-auto">
          <span className="block truncate font-mono text-xs">{q.phone ?? "Sin teléfono"}</span>
          <span className="block text-xs text-brand-900/60">{q.whatsapp ? "WhatsApp" : "Sin WhatsApp"}</span>
        </div>
        <div className="col-start-1 min-w-0 text-xs text-brand-900/60 md:col-start-auto">
          {ago(q.since)}
          {version ? ` · V${version.version}${testing ? (version.status === "test" ? " (prueba)" : " (activa)") : ""}` : ""}
        </div>
        <span className="row-start-1 md:row-start-auto">
          <Badge tone={EXEC[status].tone}>{EXEC[status].label}</Badge>
        </span>
        <button type="button" data-testid="followup-execute" className={status === "pending" && !open ? buttonClass : secondaryButtonClass} onClick={onToggle} disabled={!version}>
          {open ? "Cerrar" : status === "sent" ? "Ver" : version?.channel === "tarea" ? "Hacer tarea" : "Ejecutar"}
        </button>
      </div>
      {open && <Execute stage={stage} item={q} exec={exec} onDone={onDone} />}
    </li>
  );
}

function Execute({ stage, item, exec, onDone }: { stage: StageView; item: QueueItem; exec: Exec; onDone: (e: Exec) => void }) {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState(exec?.status ?? "pending");
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    prepareFollowupAction(item.id, stage.key)
      .then((r) => alive && (r.ok ? setPrepared(r.data) : setError(r.message)))
      .catch(() => alive && setError("No pudimos armar el mensaje."));
    return () => {
      alive = false;
    };
  }, [item.id, stage.key]);

  const mark = (estado: "opened" | "sent" | "failed") =>
    prepared &&
    start(async () => {
      setError("");
      const r = await markFollowupAction({ id: item.id, stage: stage.key, versionId: prepared.versionId, status: estado, reason });
      if (!r.ok) return setError(r.message);
      setStatus(r.data.execution.status);
      if (r.data.warning) setNotice(r.data.warning);
      if (estado !== "opened") onDone({ status: r.data.execution.status, at: r.data.execution.at, reason: estado === "failed" ? reason : null });
    });
  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${what} copiado.`);
    } catch {
      setNotice(`No pudimos copiarlo: ${text}`);
    }
  }

  if (!prepared)
    return (
      <div className="px-3 pb-3 text-sm">
        {error ? (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        ) : (
          <p className="text-brand-900/65">Armando el mensaje…</p>
        )}
      </div>
    );
  const task = prepared.channel === "tarea";
  const sent = status === "sent";
  const step = "w-full justify-start text-left";
  return (
    <div className="grid gap-3 px-3 pb-3 md:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">
        <p className="mb-1.5 text-xs text-brand-900/65">
          Para <b className="text-brand-950">{prepared.name}</b> · {task ? "tarea" : <>WhatsApp <b className="font-mono text-brand-950">{prepared.phone ?? "sin número"}</b></>} · V{prepared.version}
        </p>
        <p data-testid="followup-message" className="whitespace-pre-wrap break-words rounded-xl border border-brand-900/10 bg-white p-3 text-sm leading-relaxed">
          {prepared.message}
        </p>
        {prepared.warnings.map((w) => (
          <p key={w} className="mt-1.5 text-xs text-amber-800">
            {w}
          </p>
        ))}
        {notice && (
          <p role="status" className="mt-1.5 text-xs text-brand-900/70">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-1.5 text-xs text-red-700">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {task ? (
          <button type="button" data-testid="followup-confirm" className={`${buttonClass} ${step}`} disabled={sent || pending} onClick={() => mark("sent")}>
            {sent ? "Hecha" : "Marcar hecha"}
          </button>
        ) : (
          <>
            {prepared.whatsapp ? (
              <a
                data-testid="followup-open"
                href={prepared.whatsapp.app}
                target="turnia-whatsapp"
                className={`${status === "pending" || status === "failed" ? buttonClass : secondaryButtonClass} ${step}`}
                onClick={(e) => {
                  // En la compu, WhatsApp Web; en el celular, la app (como en Prospección).
                  if (!window.matchMedia("(pointer: coarse)").matches) e.currentTarget.href = prepared.whatsapp!.web;
                  if (!sent) mark("opened");
                }}
              >
                1. Abrir WhatsApp con el mensaje
              </a>
            ) : (
              <span data-testid="followup-open" aria-disabled="true" className={`${secondaryButtonClass} ${step} cursor-not-allowed opacity-50`}>
                1. Abrir WhatsApp
              </span>
            )}
            <button type="button" data-testid="followup-confirm" className={`${status === "opened" ? buttonClass : secondaryButtonClass} ${step}`} disabled={sent || pending || !prepared.ready} onClick={() => mark("sent")}>
              {sent ? "Enviado" : "2. Confirmar envío"}
            </button>
          </>
        )}
        {!sent &&
          (failing ? (
            <div className="flex gap-2">
              <input data-testid="followup-failed-reason" aria-label="Por qué no salió" className={inputClass} value={reason} maxLength={300} placeholder="Por qué no salió" onChange={(e) => setReason(e.target.value)} />
              <button type="button" data-testid="followup-failed-save" className={secondaryButtonClass} disabled={!reason.trim() || pending} onClick={() => mark("failed")}>
                Guardar
              </button>
            </div>
          ) : (
            <button type="button" data-testid="followup-failed" className={`${secondaryButtonClass} ${step}`} onClick={() => setFailing(true)}>
              {task ? "No se pudo hacer" : "No se envió"}
            </button>
          ))}
        {prepared.ctas.includes("copy") && (
          <button type="button" className={`${secondaryButtonClass} ${step}`} onClick={() => copy(prepared.message, "Mensaje")}>
            Copiar mensaje
          </button>
        )}
        {prepared.ctas.includes("demo") && (
          <button type="button" data-testid="followup-link-demo" className={`${secondaryButtonClass} ${step}`} onClick={() => copy(prepared.links.demo, "Link demo")}>
            Copiar link demo
          </button>
        )}
        {prepared.ctas.includes("panel") && (
          <button type="button" data-testid="followup-link-panel" className={`${secondaryButtonClass} ${step}`} onClick={() => copy(prepared.links.panel, "Link panel")}>
            Copiar link panel
          </button>
        )}
      </div>
    </div>
  );
}

function VersionTable({ stage }: { stage: StageView }) {
  if (!stage.versions.length) return null;
  const max = Math.max(0.01, ...stage.versions.map((v) => v.stats.rate ?? 0));
  const measured = stage.versions.filter((v) => v.stats.executions >= 30);
  const best = measured.length > 1 ? measured.reduce((a, b) => ((b.stats.rate ?? 0) > (a.stats.rate ?? 0) ? b : a)) : null;
  return (
    <div className="border-t border-brand-900/10 p-5">
      <span className={label}>Resultados por versión</span>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm tabular-nums">
          <thead>
            <tr className={`${label} border-b border-brand-900/10`}>
              <th className="py-2 text-left font-semibold">Versión</th>
              <th className="py-2 text-left font-semibold">Estado</th>
              <th className="py-2 text-right font-semibold">Ejecuciones</th>
              <th className="py-2 text-right font-semibold">Conversiones</th>
              <th className="py-2 text-right font-semibold">Tasa de conversión</th>
            </tr>
          </thead>
          <tbody>
            {stage.versions.map((v) => (
              <tr key={v.id} className="border-b border-brand-900/5">
                <td className="py-2.5 font-semibold">
                  V{v.version}
                  {best?.id === v.id && <span className="ml-1.5 text-[10px] font-bold tracking-wider text-brand-700">MEJOR</span>}
                </td>
                <td className="py-2.5">
                  <Badge tone={STATUS[v.status].tone}>{STATUS[v.status].label}</Badge>
                </td>
                <td className="py-2.5 text-right">{v.stats.executions}</td>
                <td className="py-2.5 text-right">{v.stats.conversions}</td>
                <td className="py-2.5 text-right">
                  <span
                    className={`mr-2 inline-block h-2 rounded align-middle ${v.status === "archived" ? "bg-brand-900/20" : "bg-brand-600"}`}
                    style={{ width: `${v.stats.rate === null ? 0 : Math.max(2, (v.stats.rate / max) * 110)}px` }}
                  />
                  <b>{pct(v.stats.rate)}</b>
                  {v.stats.smallSample && <span className="block text-xs text-brand-900/55">muestra chica</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-brand-900/60">
        Ejecución: un envío confirmado, una vez por persona. Conversión: pasó a «{stage.goal}» o más allá después del envío, con las definiciones de EMBUDO.md.
      </p>
    </div>
  );
}
