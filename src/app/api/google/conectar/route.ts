import { NextResponse } from "next/server";
import { authorizationUrl, createOAuthState, googleConfigured, OAUTH_COOKIE } from "@/lib/calendar/google";
import { getPanelClinic } from "@/lib/panel-clinic";

export const dynamic = "force-dynamic";

// Panel → «Conectar Google Calendar»: manda a la pantalla de permisos de Google con un
// estado firmado (clínica + vencimiento) atado a una cookie de este navegador.
export async function GET(request: Request) {
  const back = new URL("/panel/configuracion/calendario", request.url);
  if (!googleConfigured()) return NextResponse.redirect(new URL("?google=sin-configurar", back));
  const clinic = await getPanelClinic();
  const requested = new URL(request.url).searchParams.get("clinic_id");
  if (requested && requested !== clinic.id) return NextResponse.redirect(new URL("?google=clinica-cambiada", back));
  const { state, nonce } = createOAuthState(clinic.id);
  const res = NextResponse.redirect(authorizationUrl(state));
  res.cookies.set(OAUTH_COOKIE, nonce, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/google", maxAge: 600 });
  return res;
}
