import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// Protege el panel: sin sesión válida, redirige al login.
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/panel/login")) return NextResponse.next();
  if (verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const url = new URL("/panel/login", request.url);
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/panel/:path*"],
};
