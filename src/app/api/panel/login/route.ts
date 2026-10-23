import { NextResponse } from "next/server";
import { findClinicAccessByCode } from "@/lib/clinic-access";
import { SESSION_COOKIE, createClinicSessionToken, createSessionToken, passwordMatches, safeNext, sessionCookieOptions } from "@/lib/session";

export const dynamic = "force-dynamic";

// El login es un POST de formulario común (no una Server Action): una pestaña
// abierta antes de un deploy sigue funcionando y nunca termina en un 404.
// Acepta la contraseña del administrador o el código de acceso de un consultorio.

function back(request: Request, next: string, error: string) {
  const url = new URL("/panel/login", request.url);
  url.searchParams.set("next", next);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const next = safeNext(form?.get("next"));
  const password = String(form?.get("password") ?? "");
  let token: string;
  if (process.env.PANEL_PASSWORD && passwordMatches(password)) {
    token = createSessionToken();
  } else {
    let access;
    try {
      access = await findClinicAccessByCode(password);
    } catch (error) {
      console.error("login: no se pudo verificar el código", error instanceof Error ? error.message : error);
      return back(request, next, "unavailable");
    }
    if (!access) return back(request, next, process.env.PANEL_PASSWORD ? "password" : "config");
    token = createClinicSessionToken(access.id);
  }
  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return response;
}
