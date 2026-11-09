import { recordForward, recordOpen, recordTalkRequest } from "@/lib/sales/outreach";
import type { TalkPlace } from "@/lib/sales/outreach-places";
import { queueTurniaSheetSync } from "@/lib/sheets/turnia-sheet";

export const dynamic = "force-dynamic";

/**
 * La página de su demo avisa que la abrieron (solo navegadores: los robots de vista previa no corren
 * JavaScript). Con `?accion=whatsapp&donde=…`, que tocó «Escribirle a Axel»; con `?accion=reenviar`,
 * que tocó «Reenviárselo a los doctores».
 */
export async function POST(request: Request, { params }: RouteContext<"/api/p/[code]">) {
  const { code } = await params;
  const url = new URL(request.url);
  if (url.searchParams.get("accion") === "reenviar") {
    if (await recordForward(code).catch(() => false)) queueTurniaSheetSync();
  } else if (url.searchParams.get("accion") === "whatsapp") {
    await recordTalkRequest(code, (url.searchParams.get("donde") ?? "") as TalkPlace).catch(() => false);
  } else if (await recordOpen(code).catch(() => false)) queueTurniaSheetSync();
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
