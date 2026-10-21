import { NextResponse } from "next/server";
import { getConversacion } from "@/content/conversaciones";
import { isConfigured } from "@/lib/env";
import { leerAudio, leerSync } from "@/lib/web-audios";

// Sirve los audios de las demos generados desde el panel: /api/audios/<slug>.mp3
// (con soporte de Range, para poder adelantar) y /api/audios/<slug>.json.

const CACHE = "public, max-age=60, s-maxage=600, stale-while-revalidate=86400";

export async function GET(request: Request, { params }: RouteContext<"/api/audios/[archivo]">) {
  const { archivo } = await params;
  const m = /^([a-z0-9-]+)\.(mp3|json)$/.exec(archivo);
  if (!m || !getConversacion(m[1]) || !isConfigured().database) return new NextResponse(null, { status: 404 });
  const [, slug, ext] = m;

  try {
    if (ext === "json") {
      const fila = await leerSync(slug);
      if (!fila) return NextResponse.json({ error: "Audio no generado" }, { status: 404, headers: { "Cache-Control": "public, s-maxage=60" } });
      return NextResponse.json(fila.sync, { headers: { "Cache-Control": CACHE, ETag: `"${slug}-${Date.parse(fila.creado)}"` } });
    }

    const fila = await leerAudio(slug);
    if (!fila) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "public, s-maxage=60" } });
    const total = fila.mp3.length;
    const base = {
      "Content-Type": "audio/mpeg",
      "Accept-Ranges": "bytes",
      "Cache-Control": CACHE,
      ETag: `"${slug}-${Date.parse(fila.creado)}"`,
    };
    const rango = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
    if (rango && (rango[1] || rango[2])) {
      let inicio = rango[1] ? Number(rango[1]) : total - Number(rango[2]);
      let fin = rango[1] && rango[2] ? Number(rango[2]) : total - 1;
      inicio = Math.max(0, inicio);
      fin = Math.min(fin, total - 1);
      if (inicio > fin) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
      return new NextResponse(new Uint8Array(fila.mp3.subarray(inicio, fin + 1)), {
        status: 206,
        headers: { ...base, "Content-Range": `bytes ${inicio}-${fin}/${total}`, "Content-Length": String(fin - inicio + 1) },
      });
    }
    return new NextResponse(new Uint8Array(fila.mp3), { headers: { ...base, "Content-Length": String(total) } });
  } catch (e) {
    // Si la tabla todavía no existe (falta correr schema.sql), la web muestra el guion.
    console.error("audios: no se pudo leer", slug, e);
    return new NextResponse(null, { status: 404 });
  }
}
