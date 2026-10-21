import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NEON_TOKEN_AUDIENCE, neonPublicJwks, neonServerToken } from "./neon-auth";

describe("autenticación del servidor con Neon", () => {
  beforeEach(() => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    vi.stubEnv("NEON_SERVER_PRIVATE_KEY", Buffer.from(privateKey.export({ format: "pem", type: "pkcs8" })).toString("base64"));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("publica solamente la clave pública y permite verificar la firma", () => {
    const jwks = neonPublicJwks();
    expect(Object.keys(jwks.keys[0]).sort()).toEqual(["alg", "e", "kid", "kty", "n", "use"]);
    const token = neonServerToken();
    const [header, payload, signature] = token.split(".");
    const key = createPublicKey({ key: jwks.keys[0], format: "jwk" });
    expect(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), key, Buffer.from(signature, "base64url"))).toBe(true);
    expect(verify("RSA-SHA256", Buffer.from(`${header}.${payload}x`), key, Buffer.from(signature, "base64url"))).toBe(false);
  });

  it("limita el token al rol del servidor, la audiencia de Turnia y cinco minutos", () => {
    const [, payload] = neonServerToken(1800000000000).split(".");
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({
      sub: "turnia-server", role: "turnia_server", aud: NEON_TOKEN_AUDIENCE,
      iat: 1800000000, exp: 1800000300,
    });
  });

  it("falla si falta la clave privada", () => {
    vi.stubEnv("NEON_SERVER_PRIVATE_KEY", "");
    expect(() => neonServerToken()).toThrow("Falta NEON_SERVER_PRIVATE_KEY");
  });
});
