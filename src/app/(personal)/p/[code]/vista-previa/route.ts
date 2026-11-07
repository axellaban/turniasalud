import { after } from "next/server";
import { demoPreviewImage, ensureDemoPreviews } from "@/lib/sales/demo-preview";

export const dynamic = "force-dynamic";

/** La imagen de la vista previa de su link en WhatsApp (src/lib/sales/demo-preview.ts). */
export async function GET(request: Request, { params }: RouteContext<"/p/[code]/vista-previa">) {
  const { code } = await params;
  const image = await demoPreviewImage(code);
  if (!image) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!image.fresh) after(() => ensureDemoPreviews([code]));
  // La dirección lleva la versión (?v=): la actual no cambia nunca y queda en la CDN.
  const cache = image.fresh && new URL(request.url).searchParams.has("v") ? "public, max-age=31536000, s-maxage=31536000, immutable" : "public, max-age=0, s-maxage=60";
  // Las guardadas antes del 29/10 son PNG: salen así hasta que se rearman.
  const type = image.image[0] === 0x89 ? "image/png" : "image/jpeg";
  return new Response(new Uint8Array(image.image), {
    headers: { "Content-Type": type, "Content-Length": String(image.image.length), "Cache-Control": cache },
  });
}
