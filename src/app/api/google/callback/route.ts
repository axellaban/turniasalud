import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { connectWithCode, GoogleError, OAUTH_COOKIE, readOAuthState } from "@/lib/calendar/google";
import { getPanelUser } from "@/lib/panel-clinic";

export const dynamic = "force-dynamic";

// Vuelta de Google: verifica el estado, que quien vuelve pueda administrar esa clínica,
// canjea el código y guarda la conexión cifrada.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (result: string) => {
    const res = NextResponse.redirect(new URL(`/panel/configuracion/calendario?google=${result}`, request.url));
    res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/google" });
    return res;
  };
  if (url.searchParams.get("error")) return back("cancelado");
  const nonce = (await cookies()).get(OAUTH_COOKIE)?.value;
  const clinicId = readOAuthState(url.searchParams.get("state") ?? "", nonce);
  const code = url.searchParams.get("code");
  if (!clinicId || !code) return back("vencido");
  const user = await getPanelUser();
  if (user.role === "clinic" && user.clinicId !== clinicId) return back("vencido");
  try {
    await connectWithCode(clinicId, code);
    return back("conectado");
  } catch (e) {
    console.error("Google Calendar: no se pudo conectar", e instanceof Error ? e.message : e);
    return back(e instanceof GoogleError && e.message.includes("permiso") ? "sin-permiso" : "error");
  }
}
