import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/panel/login", request.url), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
