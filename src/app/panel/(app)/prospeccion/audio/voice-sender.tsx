"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Field, Notice, buttonClass, dangerButtonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import { sendVoiceAction, testVoiceAction, uploadVoiceAction, type VoiceResult } from "./actions";

/** Pausa al azar entre audios: de 3 a 6 minutos, como alguien que los manda a mano. */

export function UploadVoice() {
  const [state, action, pending] = useActionState(uploadVoiceAction, undefined);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok && state.id) router.replace(`/panel/prospeccion/audio?audio=${state.id}`);
  }, [state, router]);
  return (
    <form action={action} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field label="Nombre">
        <input name="label" required maxLength={80} placeholder="No abrieron · v1" className={inputClass} />
      </Field>
      <Field label="Archivo">
        <input name="audio" type="file" required accept="audio/*,.opus,.ogg,.m4a,.mp3,.webm" className="text-sm" />
      </Field>
      <button disabled={pending} className={buttonClass}>{pending ? "Subiendo…" : "Subir audio"}</button>
      {state && !state.ok && <Notice tone="error" className="sm:col-span-3">{state.message}</Notice>}
    </form>
  );
}

type Person = { id: string; name: string; phone: string; greeting: string; touches: number; sent: boolean; needsReview: boolean };
type RowState = { kind: "ok" | "error" | "sending"; message: string };

export function VoiceSender({
  noteId,
  noteLabel,
  audioUrl,
  defaultText,
  ready,
  dailyLimit,
  batchSize,
  pauseMin,
  pauseMax,
  remainingToday,
  people,
}: {
  noteId: string;
  noteLabel: string;
  audioUrl: string;
  defaultText: string;
  ready: boolean;
  dailyLimit: number;
  batchSize: number;
  pauseMin: number;
  pauseMax: number;
  remainingToday: number;
  people: Person[];
}) {
  const router = useRouter();
  const [text, setText] = useState(defaultText);
  const [seconds, setSeconds] = useState(15);
  const [testPhone, setTestPhone] = useState("");
  const [test, setTest] = useState<VoiceResult & { pending?: boolean }>();
  const pendingPeople = people.filter((p) => !p.sent);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(pendingPeople.slice(0, Math.min(batchSize, remainingToday)).map((p) => p.id)));
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [log, setLog] = useState<string>("");
  const stop = useRef(false);

  // Cuánto dura la grabación, para mostrar «grabando audio…» un rato parecido.
  useEffect(() => {
    const audio = new Audio(audioUrl);
    const onMeta = () => Number.isFinite(audio.duration) && setSeconds(Math.round(audio.duration));
    audio.addEventListener("loadedmetadata", onMeta);
    return () => audio.removeEventListener("loadedmetadata", onMeta);
  }, [audioUrl]);

  // No cerrar la pestaña en medio de la cola: la cola vive acá.
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const preview = (p: Person) => text.replace(/\{saludo\}/g, p.greeting).replace(/\{link\}/g, "turnia…/p/…");

  async function sendTest() {
    setTest({ ok: true, message: "Mandando…", pending: true });
    setTest(await testVoiceAction(noteId, testPhone, text.replace(/\{saludo\}/g, "Axel").replace(/\{link\}/g, "https://turniasalud.vercel.app"), seconds));
  }

  async function wait(total: number) {
    for (let left = total; left > 0 && !stop.current; left--) {
      setCountdown(left);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setCountdown(0);
  }

  async function run() {
    if (count > Math.min(batchSize, remainingToday)) return;
    stop.current = false;
    setRunning(true);
    const queue = pendingPeople.filter((p) => selected.has(p.id) && rows[p.id]?.kind !== "ok");
    let errors = 0;
    for (let i = 0; i < queue.length && !stop.current; i++) {
      const p = queue[i];
      setRows((r) => ({ ...r, [p.id]: { kind: "sending", message: "Mandando…" } }));
      const result = await sendVoiceAction(noteId, p.id, text, seconds);
      setRows((r) => ({ ...r, [p.id]: { kind: result.ok ? "ok" : "error", message: result.message } }));
      setLog(result.message);
      errors = result.ok ? 0 : errors + 1;
      // Dos errores seguidos suelen ser WAHA o el tope del día: mejor frenar y mirar.
      if (errors >= 2) {
        setLog(`Frené después de dos errores seguidos: ${result.message}`);
        break;
      }
      if (i < queue.length - 1) await wait(Math.round(pauseMin + Math.random() * (pauseMax - pauseMin)));
    }
    setRunning(false);
    router.refresh();
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const count = pendingPeople.filter((p) => selected.has(p.id) && rows[p.id]?.kind !== "ok").length;

  return (
    <div className="mt-4 space-y-5">
      <Field label="Texto que va antes del audio (opcional)" hint="{saludo} es su nombre y {link} su demo. Vacío: solo el audio.">
        <textarea rows={2} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} disabled={running} className={inputClass} />
      </Field>

      <div className="rounded-xl bg-brand-50/60 p-3">
        <p className="text-sm font-semibold text-brand-950">Probalo primero con vos</p>
        <p className="text-xs text-brand-900/65">Te llega «{noteLabel}» como lo va a recibir cada uno. No cuenta en el embudo.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="Tu celular (223 6123456)" className={`${inputClass} max-w-xs`} />
          <button type="button" onClick={sendTest} disabled={!ready || !testPhone || test?.pending || running} className={secondaryButtonClass}>
            Mandármelo
          </button>
        </div>
        {test && !test.pending && <Notice tone={test.ok ? "success" : "error"} className="mt-2">{test.message}</Notice>}
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-brand-900/75">
            {pendingPeople.length} sin este audio · elegidos {count} · quedan {remainingToday} hoy
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={running} onClick={() => setSelected(new Set(pendingPeople.slice(0, Math.min(batchSize, remainingToday)).map((p) => p.id)))} className={secondaryButtonClass}>
              Los primeros {Math.min(batchSize, remainingToday, pendingPeople.length)}
            </button>
            <button type="button" disabled={running} onClick={() => setSelected(new Set())} className={secondaryButtonClass}>
              Ninguno
            </button>
          </div>
        </div>
        <ul className="mt-3 max-h-[28rem] divide-y divide-brand-900/10 overflow-y-auto rounded-xl ring-1 ring-brand-900/10">
          {people.map((p) => {
            const row = rows[p.id];
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <input type="checkbox" aria-label={`Mandarle a ${p.name}`} checked={!p.sent && selected.has(p.id)} disabled={p.sent || running} onChange={() => toggle(p.id)} />
                <span className="min-w-40 font-medium text-brand-950">{p.name}</span>
                <span className="text-xs text-brand-900/60">{p.phone} · {p.touches} de 3 mensajes</span>
                <span className="ml-auto text-xs">
                  {p.needsReview ? <span>Revisá el envío en WhatsApp</span>
                    : p.sent ? <span className="text-emerald-700">Audio registrado o reservado</span>
                    : row ? <span className={row.kind === "error" ? "text-red-700" : row.kind === "ok" ? "text-emerald-700" : "text-brand-700"}>{row.message}</span>
                    : <span className="text-brand-900/50">{text ? `«${preview(p).slice(0, 50)}»` : ""}</span>}
                </span>
              </li>
            );
          })}
          {people.length === 0 && <li className="px-3 py-4 text-sm text-brand-900/60">No hay nadie en este grupo.</li>}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {running ? (
          <button type="button" onClick={() => (stop.current = true)} className={dangerButtonClass}>Frenar</button>
        ) : (
          <button type="button" onClick={run} disabled={!ready || count === 0 || count > Math.min(batchSize, remainingToday)} className={buttonClass}>
            Mandar a {count}, de a uno
          </button>
        )}
        {countdown > 0 && <span className="text-sm text-brand-900/70">Próximo en {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")} · dejá esta pestaña abierta</span>}
        {!running && log && <span className="text-sm text-brand-900/70">{log}</span>}
      </div>
      <p className="text-xs text-brand-900/60">
        Cada tanda tiene hasta {batchSize} contactos. Entre envíos espera de {Math.round(pauseMin)} a {Math.round(pauseMax)} segundos. De 8 a 21 h de Buenos Aires, hasta {dailyLimit} por día. Dejá la pestaña abierta durante la tanda.
      </p>
    </div>
  );
}
