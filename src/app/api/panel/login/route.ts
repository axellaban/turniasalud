import { NextResponse } from "next/server";
import { SESSION_COOKIE, createSessionToken, passwordMatches, safeNext, sessionCookieOptions } from "@/lib/session";

export const dynamic = "force-dynamic";

// El login es un POST de formulario común (no una Server Action): una pestaña
// abierta antes de un deploy sigue funcionando y nunca termina en un 404.

function back(request: Request, next: string, error: string) {
  const url = new URL("/panel/login", request.url);
  url.searchParams.set("next", next);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const next = safeNext(form?.get("next"));
  if (!process.env.PANEL_PASSWORD) return back(request, next, "config");
  if (!passwordMatches(String(form?.get("password") ?? ""))) return back(request, next, "password");
  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(SESSION_COOKIE, createSessionToken(), sessionCookieOptions);
  return response;
}
