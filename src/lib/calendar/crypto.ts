import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Cifrado de los tokens de Google (AES-256-GCM). La clave sale de GOOGLE_TOKEN_KEY o,
// si no está, de SESSION_SECRET: cambiar esa variable obliga a reconectar las cuentas.

function key(): Buffer {
  const base = process.env.GOOGLE_TOKEN_KEY || process.env.SESSION_SECRET || process.env.AGENT_TOOLS_SECRET;
  if (!base) throw new Error("Falta GOOGLE_TOKEN_KEY (o SESSION_SECRET) para guardar la conexión con Google.");
  return createHash("sha256").update(`turnia-calendar:${base}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

export function decryptSecret(sealed: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Token cifrado inválido.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
