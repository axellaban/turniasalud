import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { connectWithCode, GoogleError, OAUTH_COOKIE, readOAuthState } from "@/lib/calendar/google";
import { getPanelUser } from "@/lib/panel-clinic";
import { SheetsApiError } from "@/lib/sheets/google-sheets";
import { connectTurniaSheet, TURNIA_SHEET_SUBJECT } from "@/lib/sheets/turnia-sheet";

export const dynamic = "force-dynamic";

// Vuelta de Google: verifica el estado, que quien vuelve pueda administrar esa clínica (o, para
// la planilla de Turnia, que sea Axel), canjea el código y guarda la conexión cifrada.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const nonce = (await cookies()).get(OAUTH_COOKIE)?.value;
  const subject = readOAuthState(url.searchParams.get("state") ?? "", nonce);
  const sheet = subject === TURNIA_SHEET_SUBJECT;
  const back = (result: string) => {
    const page = sheet ? "/panel/prospeccion/planilla" : "/panel/configuracion/calendario";
    const res = NextResponse.redirect(new URL(`${page}?google=${result}`, request.url));
    res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/google" });
    return res;
  };
  if (url.searchParams.get("error")) return back("cancelado");
  const code = url.searchParams.get("code");
  if (!subject || !code) return back("vencido");
  const user = await getPanelUser();
  if (sheet) {
    if (user.role !== "admin") return back("vencido");
    try {
      await connectTurniaSheet(code);
      return back("conectado");
    } catch (e) {
      console.error("Google Sheets: no se pudo conectar", e instanceof Error ? e.message : e);
      if (e instanceof SheetsApiError && e.disabled) return back("sin-api");
      return back(e instanceof GoogleError && e.message.includes("permiso") ? "sin-permiso" : "error");
    }
  }
  const clinicId = subject;
  if (user.role === "clinic" && user.clinicId !== clinicId) return back("vencido");
  try {
    await connectWithCode(clinicId, code);
    return back("conectado");
  } catch (e) {
    console.error("Google Calendar: no se pudo conectar", e instanceof Error ? e.message : e);
    return back(e instanceof GoogleError && e.message.includes("permiso") ? "sin-permiso" : "error");
  }
}
