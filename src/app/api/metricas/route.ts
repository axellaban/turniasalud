import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { turniaMetrics } from "@/lib/sales/metrics";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function authorized(request: Request): boolean {
  const secret = process.env.METRICS_SECRET;
  if (!secret || secret.length < 32) return false;
  const a = Buffer.from(request.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

// GET /api/metricas — totales y series por día para el tablero de Chapa Labs. Sin datos personales.
// De servidor a servidor: Authorization: Bearer $METRICS_SECRET. Opcional ?desde=&hasta= (AAAA-MM-DD).
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const from = params.get("desde");
  const to = params.get("hasta");
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) return NextResponse.json({ error: "Fechas inválidas (AAAA-MM-DD)." }, { status: 400 });
  try {
    const metrics = await turniaMetrics({ from, to });
    return NextResponse.json(
      { producto: "turnia", generadoEn: new Date().toISOString(), desde: from, hasta: to, ...metrics },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    console.error("metrics_error", e instanceof Error ? e.message.slice(0, 120) : "unknown");
    return NextResponse.json({ error: "No pudimos calcular las métricas." }, { status: 500 });
  }
}
