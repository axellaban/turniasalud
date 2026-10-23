import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";

/** Secciones solo del administrador: un consultorio vuelve al inicio sin llegar a cargarlas. */
const ADMIN_ONLY = ["/panel/clinicas", "/panel/demos", "/panel/sistema"];

// La demo usa minutos de ElevenLabs: requiere la misma sesión que el panel.
// La revocación de un acceso se verifica en cada página contra la base.
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path.startsWith("/panel/login")) return NextResponse.next();
  const session = readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) {
    if (session.role !== "admin" && ADMIN_ONLY.some((p) => path === p || path.startsWith(`${p}/`))) return NextResponse.redirect(new URL("/panel", request.url));
    return NextResponse.next();
  }
  const url = new URL("/panel/login", request.url);
  url.searchParams.set("next", path);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/panel/:path*", "/demo/:path*"],
};
