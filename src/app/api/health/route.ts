import { NextResponse } from "next/server";
import { isConfigured } from "@/lib/env";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Monitoreo público: dice qué está configurado y si la base responde, sin
// exponer datos ni mensajes de error internos.
export async function GET() {
  const configured = isConfigured();
  let database: "ok" | "error" | "sin_configurar" = "sin_configurar";
  let clinics = 0;
  if (configured.database) {
    try {
      const [row] = await Promise.race([
        sql<Array<{ clinics: number }>>`select count(*)::int as clinics from clinics`,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
      ]);
      database = "ok";
      clinics = row.clinics;
    } catch (e) {
      console.error("health: la base no respondió", e);
      database = "error";
    }
  }
  const ok = database === "ok";
  return NextResponse.json(
    { ok, service: "turnia-salud", database, clinics, configured },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
