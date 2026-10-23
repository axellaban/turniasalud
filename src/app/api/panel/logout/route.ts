import { NextResponse } from "next/server";
import { SESSION_COOKIE, sameOrigin } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const response = NextResponse.redirect(new URL("/panel/login", request.url), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
