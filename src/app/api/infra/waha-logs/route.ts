import { NextResponse } from "next/server";
import { z } from "zod";
import { easypanelConfig, ingestWahaLogs, radarTokenFingerprint, verifyRadarSecret } from "@/lib/infra-radar";

export const dynamic = "force-dynamic";

// El lector de logs que corre en el VPS (servicio waha-radar de Easypanel) manda acá las líneas de
// cada WAHA. Firma con una clave derivada de EASYPANEL_API_TOKEN. Se guardan solo advertencias,
// errores y cambios de estado, sin teléfonos.
const bodySchema = z.object({
  service: z.string().regex(/^[a-z0-9_-]+\/[a-z0-9_-]+$/),
  lines: z.array(z.object({
    at: z.string().max(40).nullish(),
    level: z.string().max(10).nullish(),
    text: z.string().max(4000),
  })).max(500),
});

export async function POST(request: Request) {
  // Distingue «falta cargar la variable en Vercel» de «la clave no coincide».
  if (!easypanelConfig()) return NextResponse.json({ error: "Radar sin configurar: faltan EASYPANEL_API_URL o EASYPANEL_API_TOKEN" }, { status: 503 });
  // Con el largo y la huella del token se ve si el de Vercel es el mismo que el del lector, sin mostrarlo.
  if (!verifyRadarSecret(request.headers.get("authorization"))) return NextResponse.json({ error: "No autorizado", token: radarTokenFingerprint() }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  return NextResponse.json({ ok: true, ...(await ingestWahaLogs(parsed.data.service, parsed.data.lines)) });
}
