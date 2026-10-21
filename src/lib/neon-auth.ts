import "server-only";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";

const KEY_ID = "turnia-server-v1";
export const NEON_TOKEN_AUDIENCE = "turnia-data-api";

function privateKey() {
  const encoded = process.env.NEON_SERVER_PRIVATE_KEY;
  if (!encoded) throw new Error("Falta NEON_SERVER_PRIVATE_KEY para conectar la base de datos.");
  return createPrivateKey(Buffer.from(encoded, "base64").toString("utf8"));
}

/** Solo publica la parte pública de la clave; Neon la usa para verificar al servidor. */
export function neonPublicJwks() {
  const key = createPublicKey(privateKey()).export({ format: "jwk" });
  return { keys: [{ kty: key.kty, n: key.n, e: key.e, kid: KEY_ID, alg: "RS256", use: "sig" }] };
}

/** Credencial de cinco minutos, usada únicamente entre el servidor y Neon. */
export function neonServerToken(now = Date.now()): string {
  const issuedAt = Math.floor(now / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KEY_ID })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: "turnia-server",
    role: "turnia_server",
    aud: NEON_TOKEN_AUDIENCE,
    iat: issuedAt,
    exp: issuedAt + 300,
  })).toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey()).toString("base64url");
  return `${header}.${payload}.${signature}`;
}
