import { createHmac, timingSafeEqual } from "node:crypto";

// Sesión del panel: cookie firmada con HMAC. Para el MVP hay un único usuario
// (la clínica) que entra con PANEL_PASSWORD.

export const SESSION_COOKIE = "turnia_session";
const MAX_AGE_SECS = 60 * 60 * 24 * 14;

function secret(): string {
  const value = process.env.SESSION_SECRET || process.env.AGENT_TOOLS_SECRET;
  if (!value) throw new Error("Falta SESSION_SECRET (o AGENT_TOOLS_SECRET) para firmar la sesión.");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSessionToken(now = Date.now()): string {
  const expires = Math.floor(now / 1000) + MAX_AGE_SECS;
  const payload = `panel.${expires}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined | null, now = Date.now()): boolean {
  if (!token) return false;
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return false;
  const payload = token.slice(0, lastDot);
  const signature = token.slice(lastDot + 1);
  const [scope, expires] = payload.split(".");
  if (scope !== "panel" || !expires || Number(expires) * 1000 < now) return false;
  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return false;
  }
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function passwordMatches(input: string): boolean {
  const expected = process.env.PANEL_PASSWORD;
  if (!expected) return false;
  const a = createHmac("sha256", "turnia").update(input).digest();
  const b = createHmac("sha256", "turnia").update(expected).digest();
  return timingSafeEqual(a, b);
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE_SECS,
};

/** Destino después de ingresar: solo rutas propias del panel o la demo. */
export function safeNext(value: unknown): string {
  const next = typeof value === "string" ? value : "";
  return next === "/demo" || next === "/panel" || (next.startsWith("/panel/") && !next.startsWith("/panel/login")) ? next : "/panel";
}
