import { recordOpen } from "@/lib/sales/outreach";
import { queueTurniaSheetSync } from "@/lib/sheets/turnia-sheet";

export const dynamic = "force-dynamic";

/** La página de su demo avisa que la abrieron (solo navegadores: los robots de vista previa no corren JavaScript). */
export async function POST(_request: Request, { params }: RouteContext<"/api/p/[code]">) {
  const { code } = await params;
  if (await recordOpen(code).catch(() => false)) queueTurniaSheetSync();
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
