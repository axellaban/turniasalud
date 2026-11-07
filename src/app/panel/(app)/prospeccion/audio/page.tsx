import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/panel-clinic";
import { displayOutreachPhone } from "@/lib/sales/outreach-messages";
import { Card, Notice, PageHeader, Tabs, secondaryButtonClass, smallButtonClass } from "@/components/ui";
import {
  VOICE_DEFAULT_TEXT,
  VOICE_GROUPS,
  VOICE_GROUP_LABEL,
  listVoiceNotes,
  voiceCandidates,
  voiceChannelStatus,
  voiceGroupCounts,
  voiceSentToday,
  type VoiceGroup,
} from "@/lib/sales/voice-outreach";
import { voiceRules } from "@/lib/sales/voice-rules";
import { deleteVoiceAction } from "./actions";
import { UploadVoice, VoiceSender } from "./voice-sender";

export const metadata: Metadata = { title: "Mandar audio · Prospección · Panel" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function AudioPage({ searchParams }: PageProps<"/panel/prospeccion/audio">) {
  await requireAdmin();
  const params = await searchParams;
  const group = (VOICE_GROUPS as readonly string[]).includes(one(params.grupo) ?? "") ? (one(params.grupo) as VoiceGroup) : "no_abrio";
  const [status, notes, counts, sentToday, rules] = await Promise.all([voiceChannelStatus(), listVoiceNotes(), voiceGroupCounts(), voiceSentToday(), voiceRules()]);
  const note = notes.find((n) => n.id === one(params.audio)) ?? notes[0] ?? null;
  const candidates = await voiceCandidates(group, note?.id ?? null);
  const href = (extra: Record<string, string>) => `/panel/prospeccion/audio?${new URLSearchParams({ grupo: group, ...(note ? { audio: note.id } : {}), ...extra })}`;

  return (
    <>
      <PageHeader
        title="Mandar audio"
        description="Grabás una vez y sale como nota de voz desde tu número, de a uno y con pausas. Cada audio cuenta como uno de los tres mensajes."
        actions={<Link href="/panel/prospeccion" className={secondaryButtonClass}>Volver a Prospección</Link>}
      />

      {!status.configured ? (
        <Notice tone="warning" className="mt-4">
          Falta conectar tu número. Creá una sesión de WAHA <b>sin webhooks</b>, escaneá el QR con el WhatsApp con el que prospectás y cargá en Vercel
          {" "}<code>WAHA_PROSPECCION</code> = <code>{`{"url":"https://…","apiKey":"…","session":"default","phone":"549223…"}`}</code>. Mientras tanto podés subir el audio.
        </Notice>
      ) : status.ok ? (
        <Notice tone="success" className="mt-4">Conectado: sale desde el {status.me}. Hoy van {sentToday} de {rules.dailyLimit} audios.</Notice>
      ) : (
        <Notice tone="error" className="mt-4">{status.problem}</Notice>
      )}

      <Card className="mt-5">
        <h2 className="text-base font-semibold text-brand-950">1. El audio</h2>
        <p className="mt-1 text-sm text-brand-900/70">
          Lo mejor: grabalo como nota de voz en el chat con vos mismo, exportalo (Compartir → Guardar) y subí el <code>.opus</code> u <code>.ogg</code>. Sale idéntico. Un <code>.m4a</code> o <code>.mp3</code> también sirve si tu WAHA lo convierte: probalo primero con vos.
        </p>
        {notes.length > 0 && (
          <ul className="mt-4 space-y-2">
            {notes.map((n) => (
              <li key={n.id} className={`flex flex-wrap items-center gap-3 rounded-xl px-3 py-2 ring-1 ${n.id === note?.id ? "bg-brand-50 ring-brand-300" : "ring-brand-900/10"}`}>
                <Link href={href({ audio: n.id })} className="font-medium text-brand-950 underline-offset-2 hover:underline">{n.label}</Link>
                <span className="text-xs text-brand-900/60">{Math.round(n.size / 1024)} KB · enviado a {n.sent}</span>
                <audio controls preload="none" src={`/panel/prospeccion/audio/archivo/${n.id}`} className="h-8" />
                {n.sent === 0 && (
                  <form action={deleteVoiceAction}>
                    <input type="hidden" name="id" value={n.id} />
                    <button className={smallButtonClass}>Borrar</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <UploadVoice />
      </Card>

      <Card className="mt-5">
        <h2 className="text-base font-semibold text-brand-950">2. A quién</h2>
        <div className="mt-3">
          <Tabs current={href({})} items={VOICE_GROUPS.map((g) => ({ href: `/panel/prospeccion/audio?${new URLSearchParams({ grupo: g, ...(note ? { audio: note.id } : {}) })}`, label: VOICE_GROUP_LABEL[g], count: counts[g] }))} />
        </div>
        <p className="mt-2 text-xs text-brand-900/60">
          Solo quienes ya recibieron su demo, siguen sin responder, les queda alguno de los tres mensajes y no pidieron la baja. Quien respondió se atiende a mano.
        </p>
        {note ? (
          <VoiceSender
            key={`${note.id}-${group}`}
            noteId={note.id}
            noteLabel={note.label}
            audioUrl={`/panel/prospeccion/audio/archivo/${note.id}`}
            defaultText={VOICE_DEFAULT_TEXT[group]}
            ready={status.configured && status.ok}
            dailyLimit={rules.dailyLimit}
            batchSize={rules.batchSize}
            pauseMin={rules.pauseMinMinutes * 60}
            pauseMax={rules.pauseMaxMinutes * 60}
            remainingToday={Math.max(0, rules.dailyLimit - sentToday)}
            people={candidates.map((c) => ({ id: c.id, name: c.name, phone: displayOutreachPhone(c.phone), greeting: c.greeting || c.name.split(/\s+/)[0], touches: c.touches, sent: c.sent, needsReview: c.needs_review }))}
          />
        ) : (
          <p className="mt-4 text-sm text-brand-900/70">Subí un audio para armar la cola.</p>
        )}
      </Card>
    </>
  );
}
