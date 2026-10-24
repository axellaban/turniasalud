import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Sesión del panel: cookie firmada con HMAC. El administrador entra con
// PANEL_PASSWORD; cada consultorio puede tener un código propio que solo abre
// su clínica (clinic_access). La revocación se verifica contra la base.

export const SESSION_COOKIE = "turnia_session";
const MAX_AGE_SECS = 60 * 60 * 24 * 14;

function secret(): string {
  const value = process.env.SESSION_SECRET || process.env.AGENT_TOOLS_SECRET;
  if (!value) throw new Error("Falta SESSION_SECRET (o AGENT_TOOLS_SECRET) para firmar la sesión.");
  return value;
}

// Las sesiones de administrador quedan atadas a la contraseña vigente: al cambiar
// PANEL_PASSWORD en Vercel se cierran todas las sesiones abiertas con la anterior.
function passwordFingerprint(): string {
  return createHash("sha256").update(`turnia-panel:${process.env.PANEL_PASSWORD ?? ""}`).digest("hex").slice(0, 16);
}

function sign(payload: string): string {
  const bound = payload.startsWith("panel.") ? `${payload}|${passwordFingerprint()}` : payload;
  return createHmac("sha256", secret()).update(bound).digest("base64url");
}

export type SessionClaims = { role: "admin" } | { role: "clinic"; accessId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signed(payload: string): string {
  return `${payload}.${sign(payload)}`;
}

/** Sesión de administrador (mismo formato de siempre: las sesiones abiertas siguen valiendo). */
export function createSessionToken(now = Date.now()): string {
  return signed(`panel.${Math.floor(now / 1000) + MAX_AGE_SECS}`);
}

/** Sesión de un consultorio: solo ve su clínica. */
export function createClinicSessionToken(accessId: string, now = Date.now()): string {
  if (!UUID.test(accessId)) throw new Error("Acceso inválido.");
  return signed(`clinic.${accessId}.${Math.floor(now / 1000) + MAX_AGE_SECS}`);
}

export function readSessionToken(token: string | undefined | null, now = Date.now()): SessionClaims | null {
  if (!token) return null;
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return null;
  const payload = token.slice(0, lastDot);
  const signature = token.slice(lastDot + 1);
  const parts = payload.split(".");
  const claims: SessionClaims | null =
    parts[0] === "panel" && parts.length === 2 ? { role: "admin" }
    : parts[0] === "clinic" && parts.length === 3 && UUID.test(parts[1]) ? { role: "clinic", accessId: parts[1] }
    : null;
  const expires = parts[parts.length - 1];
  if (!claims || !/^\d+$/.test(expires) || Number(expires) * 1000 < now) return null;
  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return null;
  }
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? claims : null;
}

/** Firma y vencimiento válidos, de cualquier rol. Un acceso revocado se rechaza al consultar la base. */
export function verifySessionToken(token: string | undefined | null, now = Date.now()): boolean {
  return readSessionToken(token, now) !== null;
}

export function isAdminSessionToken(token: string | undefined | null, now = Date.now()): boolean {
  return readSessionToken(token, now)?.role === "admin";
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

const PANEL_SECTIONS = ["agenda", "conversaciones", "tareas", "pacientes", "campanas", "configuracion", "clinicas", "demos", "sistema", "comercial"];

/** Destino después de ingresar: una sección real del panel o la demo; si no, el inicio. */
export function safeNext(value: unknown): string {
  const next = typeof value === "string" ? value : "";
  if (next === "/demo" || next === "/panel") return next;
  const section = /^\/panel\/([a-z]+)(?:[/?]|$)/.exec(next)?.[1];
  return section && PANEL_SECTIONS.includes(section) ? next : "/panel";
}

/**
 * Un formulario de otro sitio no puede iniciar ni cerrar la sesión: si el navegador
 * manda Origin, tiene que ser este mismo sitio. Sin Origin (clientes viejos) se acepta.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return [request.headers.get("x-forwarded-host"), request.headers.get("host"), new URL(request.url).host].some((h) => h === host);
  } catch {
    return false;
  }
}
