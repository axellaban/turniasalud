import { requireAdmin } from "@/lib/panel-clinic";
import { voiceNoteAudio } from "@/lib/sales/voice-outreach";

export const dynamic = "force-dynamic";

/** La grabación subida, para escucharla en el panel antes de mandarla. Solo administradores. */
export async function GET(_request: Request, { params }: RouteContext<"/panel/prospeccion/audio/archivo/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const note = await voiceNoteAudio(id);
  if (!note) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(note.audio), {
    headers: { "Content-Type": note.mimetype, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
