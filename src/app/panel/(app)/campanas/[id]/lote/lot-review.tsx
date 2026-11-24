"use client";

import { useActionState, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  markManualFollowupAction,
  markManualSentAction,
  sendLotWithSofiAction,
  setOutcomeAction,
  setPilotAction,
} from "../../../../campaign-actions";
import type { LotItem, SentItem } from "@/lib/campaign-lot";
import { buttonClass, secondaryButtonClass } from "@/components/ui";

type Mode = "sofi" | "manual";

const OUTCOMES: Array<[NonNullable<SentItem["outcome"]>, string]> = [
  ["respondio", "Respondió"],
  ["no_interesa", "No le interesa"],
  ["baja", "Pidió la baja"],
];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

const shortName = (name: string) => {
  const [first, last] = name.split(/\s+/);
  return last ? `${first} ${last[0]}.` : first;
};

const form = (data: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
};

export function LotReview(props: {
  clinicId: string;
  campaignId: string;
  title: string;
  subtitle: string;
  items: LotItem[];
  sent: SentItem[];
  pilot: { size: number; contacted: number; done: boolean } | null;
  pilotSize: number;
  lotSize: number;
  sofiProblem: string | null;
  usage: { sent: number; cap: number } | null;
  windowLabel: string;
  inWindow: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(props.sofiProblem ? "manual" : "sofi");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [sofiState, sofiAction, sofiPending] = useActionState(sendLotWithSofiAction, undefined);

  const chosen = props.items.filter((i) => !excluded.has(i.id));
  // El que toca ahora en el envío manual: el primero elegido que no se mandó ni se salteó.
  const queue = useMemo(() => chosen.filter((i) => !done.has(i.id) && !skipped.has(i.id) && i.links), [chosen, done, skipped]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const current = queue.find((i) => i.id === currentId) ?? queue[0] ?? null;

  const next = useCallback(() => {
    if (!current) return;
    const idx = queue.findIndex((i) => i.id === current.id);
    setCurrentId(queue[idx + 1]?.id ?? null);
  }, [current, queue]);

  const open = useCallback(() => {
    if (!current?.links) return;
    // En la compu, WhatsApp Web; en el celular, la app. Siempre en la misma pestaña aparte.
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    window.open(coarse ? current.links.app : current.links.web, "turnia-whatsapp");
    const id = current.id;
    setDone((d) => new Set(d).add(id));
    next();
    startTransition(async () => {
      const f = form({ clinic_id: props.clinicId, id });
      await (current.step === 1 ? markManualSentAction(f) : markManualFollowupAction(f));
      router.refresh();
    });
  }, [current, next, props.clinicId, router]);

  // Atajos: Enter abre el chat, → pasa al siguiente (para mandar diez en un minuto).
  useEffect(() => {
    if (mode !== "manual") return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(target.tagName)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        open();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (current) setSkipped((s) => new Set(s).add(current.id));
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, open, next, current]);

  const mark = (id: string, outcome: string) =>
    startTransition(async () => {
      await setOutcomeAction(form({ clinic_id: props.clinicId, campaign_id: props.campaignId, id, outcome }));
      router.refresh();
    });

  const pilotToggle = (on: boolean) =>
    startTransition(async () => {
      await setPilotAction(form({ clinic_id: props.clinicId, id: props.campaignId, pilot: on ? "1" : "0" }));
      router.refresh();
    });

  const segClass = (on: boolean) =>
    `flex-1 rounded-xl px-3.5 py-2 text-left text-sm font-semibold ${on ? "bg-white text-brand-950 shadow-sm" : "text-brand-900/65 hover:text-brand-900"}`;

  return (
    <section aria-labelledby="t-lote" className="overflow-hidden rounded-2xl border border-brand-900/10 bg-[#f5f7fc]">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-brand-900/10 bg-white px-4 py-4 sm:px-6">
        <div>
          <h1 id="t-lote" className="font-display text-2xl text-brand-950">
            {props.title}
          </h1>
          <p className="mt-1 text-sm text-brand-900/65">{props.subtitle}</p>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={Boolean(props.pilot)} disabled={pending} onChange={(e) => pilotToggle(e.target.checked)} className="mt-1" />
          <span>
            <b className="text-brand-950">Piloto de {props.pilotSize} pacientes</b>
            <span className="block text-xs text-brand-900/65">Ves cómo responden antes de mandarle al resto.</span>
          </span>
        </label>
      </header>

      <div className="px-4 pt-4 sm:px-6">
        <div role="radiogroup" aria-label="Cómo se manda" className="flex flex-col gap-1.5 rounded-2xl bg-[#e8ecf5] p-1.5 sm:flex-row">
          <button type="button" role="radio" aria-checked={mode === "sofi"} onClick={() => setMode("sofi")} className={segClass(mode === "sofi")}>
            Con Sofi, automático
            <span className="block text-xs font-normal">Sale por la línea conectada, con pausas. Si responden, los atiende Sofi.</span>
          </button>
          <button type="button" role="radio" aria-checked={mode === "manual"} onClick={() => setMode("manual")} className={segClass(mode === "manual")}>
            Desde mi WhatsApp, de a uno
            <span className="block text-xs font-normal">Se abre el chat con el mensaje escrito. Vos tocás enviar.</span>
          </button>
        </div>
      </div>

      {props.pilot?.done && (
        <div className="mx-4 mt-4 rounded-xl bg-sun-100 px-4 py-3 text-sm text-sun-700 sm:mx-6">
          Terminó el piloto: ya les escribiste a {props.pilot.contacted}. Mirá cómo respondieron en los resultados antes de seguir.{" "}
          <button type="button" onClick={() => pilotToggle(false)} className="font-semibold underline underline-offset-2">
            Seguir con el resto
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 p-4 sm:p-6 lg:grid-cols-[330px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          {props.sent.length > 0 && (
            <>
              <p className="text-xs font-semibold uppercase tracking-wider text-brand-900/60">Enviados desde tu WhatsApp</p>
              <ol className="flex flex-col gap-2" aria-label="Enviados desde tu WhatsApp">
                {props.sent.map((s) => (
                  <li key={s.id} className="flex flex-col gap-2.5 rounded-xl border border-brand-900/10 bg-white p-3 text-sm">
                    <span className="flex items-center gap-3">
                      <span className="grid size-8 place-items-center rounded-full bg-emerald/15 text-xs font-bold text-emerald-700" aria-hidden>
                        {initials(s.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        {shortName(s.name)}
                        <span className="block text-xs text-brand-900/60">
                          {s.step > 1 ? `Seguimiento ${s.step}` : "Enviado"} {s.at}
                        </span>
                      </span>
                    </span>
                    <span role="group" aria-label={`Qué pasó con ${shortName(s.name)}`} className="flex flex-wrap gap-1.5">
                      {OUTCOMES.map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          disabled={pending}
                          aria-pressed={s.outcome === key}
                          onClick={() => mark(s.id, key)}
                          className={`min-h-9 rounded-full border px-3 text-xs font-medium ${s.outcome === key ? "border-emerald-700 bg-emerald/15 font-semibold text-emerald-700" : "border-brand-900/15 bg-white text-brand-950 hover:bg-brand-50"}`}
                        >
                          {label}
                        </button>
                      ))}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
          <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-brand-900/60">Este lote</p>
          {props.items.length ? (
            <ol aria-label="Pacientes del lote" className="flex flex-col gap-2">
              {props.items.map((i) => {
                const isCurrent = mode === "manual" && current?.id === i.id;
                const isDone = done.has(i.id);
                return (
                  <li key={i.id} aria-current={isCurrent ? "step" : undefined}>
                    <button
                      type="button"
                      onClick={() => setCurrentId(i.id)}
                      className={`flex w-full items-center gap-3 rounded-xl bg-white p-3 text-left text-sm ${isCurrent ? "border-2 border-brand-600" : "border border-brand-900/10"} ${excluded.has(i.id) ? "opacity-50" : ""}`}
                    >
                      <span className="grid size-8 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-800" aria-hidden>
                        {initials(i.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={isCurrent ? "font-semibold" : ""}>{shortName(i.name)}</span>
                        <span className="block truncate text-xs text-brand-900/60">{i.step > 1 ? `Seguimiento ${i.step}` : i.reason}</span>
                      </span>
                      {isDone && <span className="rounded-full bg-emerald/15 px-2 py-0.5 text-xs font-semibold text-emerald-700">Enviado</span>}
                      {!i.links && <span className="text-xs text-sun-700">Sin celular</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="rounded-xl border border-dashed border-brand-900/15 p-4 text-sm text-brand-900/65">
              {props.pilot?.done ? "El piloto está completo." : "No queda nadie por escribirle en esta campaña."}
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4 rounded-2xl border border-brand-900/10 bg-white p-5">
          {mode === "sofi" ? (
            <form action={sofiAction} className="flex flex-col gap-4">
              <input type="hidden" name="clinic_id" value={props.clinicId} />
              <input type="hidden" name="id" value={props.campaignId} />
              <h2 className="text-lg font-bold text-brand-950">Mandarlo con Sofi</h2>
              <p className="text-sm text-brand-900/70">
                Sofi les escribe por la línea conectada, con pausas entre mensaje y mensaje. Si responden, los atiende ella y queda en Conversaciones.
              </p>
              {props.items.length > 0 && (
                <fieldset className="flex flex-col gap-1.5 text-sm">
                  <legend className="mb-1 font-medium text-brand-900">Incluir en el lote</legend>
                  {props.items
                    .filter((i) => i.step === 1)
                    .map((i) => (
                      <label key={i.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          name="recipient"
                          value={i.id}
                          checked={!excluded.has(i.id)}
                          onChange={(e) =>
                            setExcluded((s) => {
                              const n = new Set(s);
                              if (e.target.checked) n.delete(i.id);
                              else n.add(i.id);
                              return n;
                            })
                          }
                        />
                        {i.name} <span className="text-xs text-brand-900/60">· {i.reason}</span>
                      </label>
                    ))}
                </fieldset>
              )}
              {props.sofiProblem && <p className="rounded-xl bg-sun-100 px-3 py-2 text-sm text-sun-700">{props.sofiProblem} Podés mandarlo desde tu WhatsApp.</p>}
              <div className="flex flex-wrap items-center gap-3">
                <button disabled={sofiPending || Boolean(props.sofiProblem) || !chosen.some((i) => i.step === 1)} className={`${buttonClass} disabled:opacity-50`}>
                  {sofiPending ? "Mandando…" : `Mandar ${chosen.filter((i) => i.step === 1).length} con Sofi`}
                </button>
                <span aria-live="polite" className={`text-sm ${sofiState?.ok === false ? "text-red-600" : "text-brand-700"}`}>
                  {!sofiPending && sofiState?.message}
                </span>
              </div>
            </form>
          ) : current ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-brand-950">{current.name}</h2>
                  <p className="mt-1 text-sm text-brand-900/65">
                    {current.step > 1 ? `Seguimiento ${current.step} · ` : ""}
                    {current.reason} · {current.phoneMasked}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm text-brand-900/70">
                  <input
                    type="checkbox"
                    checked={!excluded.has(current.id)}
                    onChange={(e) =>
                      setExcluded((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.delete(current.id);
                        else n.add(current.id);
                        return n;
                      })
                    }
                  />
                  Incluir en el lote
                </label>
              </div>
              <div className="rounded-xl bg-[#e9f2e6] p-4">
                <p className="ml-auto max-w-[85%] whitespace-pre-line rounded-xl rounded-br-sm bg-[#dcf8c6] px-3.5 py-3 text-[15px] leading-normal text-brand-950">{current.message}</p>
              </div>
              <p className="text-sm text-brand-900/65">
                Si te contesta en este chat, la respuesta llega a tu WhatsApp, no a Sofi: marcá qué pasó a la izquierda para que cuente en los resultados.
              </p>
              <div className="mt-auto flex flex-wrap gap-2.5">
                <button type="button" onClick={open} className={`${buttonClass} flex-1 !bg-[#15803d] hover:!bg-[#166534]`}>
                  Abrir chat en WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSkipped((s) => new Set(s).add(current.id));
                    next();
                  }}
                  className={secondaryButtonClass}
                >
                  Saltear
                </button>
                <Link href={`/panel/campanas?campana=${props.campaignId}#campana`} className={secondaryButtonClass}>
                  Editar mensaje
                </Link>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-start gap-3">
              <h2 className="text-lg font-bold text-brand-950">Lote terminado</h2>
              <p className="text-sm text-brand-900/70">Marcá a la izquierda qué contestó cada uno. Cuando quieras, seguí con el próximo lote de {props.lotSize}.</p>
              <button type="button" onClick={() => (setDone(new Set()), setSkipped(new Set()), router.refresh())} className={secondaryButtonClass}>
                Traer el próximo lote
              </button>
            </div>
          )}
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-brand-900/10 bg-white px-4 py-3.5 text-sm text-brand-900/70 sm:px-6">
        <span>
          Horario de envío: {props.windowLabel}
          {!props.inWindow && <b className="text-sun-700"> (ahora está fuera de horario)</b>}
          {props.usage && (
            <>
              {" "}
              · hoy van{" "}
              <b className="text-brand-950">
                {props.usage.sent} de {props.usage.cap}
              </b>{" "}
              mensajes desde esta línea
            </>
          )}
        </span>
        {mode === "manual" && (
          <span className="hidden sm:inline">
            Teclado: <b className="text-brand-950">Enter</b> abre el chat · <b className="text-brand-950">→</b> pasa al siguiente
          </span>
        )}
      </footer>
    </section>
  );
}
