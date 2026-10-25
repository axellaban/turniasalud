import { recordOpen } from "@/lib/sales/outreach";

export const dynamic = "force-dynamic";

/** La página de su demo avisa que la abrieron (solo navegadores: los robots de vista previa no corren JavaScript). */
export async function POST(_request: Request, { params }: RouteContext<"/api/p/[code]">) {
  const { code } = await params;
  await recordOpen(code).catch(() => false);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
