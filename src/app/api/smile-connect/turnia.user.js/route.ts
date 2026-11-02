import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getPanelClinic, logClinicChange } from "@/lib/panel-clinic";
import { buildSmileConnectUserscript, ensureSmileConnectToken } from "@/lib/smile-connect";

export const dynamic = "force-dynamic";

function resolveBaseUrl(request: Request): string {
  const configured = env.appUrl()?.trim().replace(/\/$/, "");
  if (configured && !configured.includes("localhost")) return configured;
  return new URL(request.url).origin.replace(/\/$/, "");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const clinic = await getPanelClinic();
  const requested = url.searchParams.get("clinic_id");
  if (requested && requested !== clinic.id) {
    return NextResponse.redirect(new URL("/panel/configuracion/calendario?google=clinica-cambiada", request.url));
  }

  const { token } = await ensureSmileConnectToken(clinic.id);
  await logClinicChange(clinic.id, "Calendario");

  const endpointUrl = `${resolveBaseUrl(request)}/api/smile-connect/sync`;
  const script = buildSmileConnectUserscript({
    endpointUrl,
    secret: token,
    clinicName: clinic.name,
  });

  const headers: Record<string, string> = {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "no-store",
  };
  if (url.searchParams.get("download") === "1") {
    headers["Content-Disposition"] = 'attachment; filename="smile-connect-turnia.user.js"';
  }

  return new NextResponse(script, { status: 200, headers });
}
