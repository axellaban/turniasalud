import { NextResponse } from "next/server";
import { authorizationUrl, createOAuthState, googleConfigured, OAUTH_COOKIE } from "@/lib/calendar/google";
import { getPanelClinic, getPanelUser } from "@/lib/panel-clinic";
import { SHEETS_SCOPES, TURNIA_SHEET_SUBJECT } from "@/lib/sheets/turnia-sheet";

export const dynamic = "force-dynamic";

// Panel → «Conectar Google Calendar» (o, con ?para=planilla, la planilla de Turnia): manda a la
// pantalla de permisos de Google con un estado firmado (para quién + vencimiento) atado a una
// cookie de este navegador.
export async function GET(request: Request) {
  const sheet = new URL(request.url).searchParams.get("para") === "planilla";
  const back = new URL(sheet ? "/panel/prospeccion/planilla" : "/panel/configuracion/calendario", request.url);
  if (!googleConfigured()) return NextResponse.redirect(new URL("?google=sin-configurar", back));
  let subject: string;
  if (sheet) {
    if ((await getPanelUser()).role !== "admin") return NextResponse.redirect(new URL("/panel", request.url));
    subject = TURNIA_SHEET_SUBJECT;
  } else {
    const clinic = await getPanelClinic();
    const requested = new URL(request.url).searchParams.get("clinic_id");
    if (requested && requested !== clinic.id) return NextResponse.redirect(new URL("?google=clinica-cambiada", back));
    subject = clinic.id;
  }
  const { state, nonce } = createOAuthState(subject);
  const res = NextResponse.redirect(sheet ? authorizationUrl(state, SHEETS_SCOPES) : authorizationUrl(state));
  res.cookies.set(OAUTH_COOKIE, nonce, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/google", maxAge: 600 });
  return res;
}
