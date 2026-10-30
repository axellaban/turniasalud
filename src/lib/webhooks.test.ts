import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "./elevenlabs";
import { detectChannel, mergeMemory, type PostCallPayload } from "./conversations";
import { sourceFromChannel } from "./agent/service";

function signed(body: string, secret: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v0=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify({ type: "post_call_transcription", data: {} });

  it("acepta firmas válidas", () => {
    expect(verifyWebhookSignature(body, signed(body, "s3cr3t"), "s3cr3t")).toBe(true);
  });

  it("rechaza otro secreto, cuerpo alterado o timestamp viejo", () => {
    expect(verifyWebhookSignature(body, signed(body, "otro"), "s3cr3t")).toBe(false);
    expect(verifyWebhookSignature(body + " ", signed(body, "s3cr3t"), "s3cr3t")).toBe(false);
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(verifyWebhookSignature(body, signed(body, "s3cr3t", old), "s3cr3t")).toBe(false);
    expect(verifyWebhookSignature(body, null, "s3cr3t")).toBe(false);
  });

  it("rechaza timestamps futuros o no numéricos aunque la firma coincida", () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    expect(verifyWebhookSignature(body, signed(body, "s3cr3t", future), "s3cr3t")).toBe(false);
    const invalid = `t=NaN,v0=${createHmac("sha256", "s3cr3t").update(`NaN.${body}`).digest("hex")}`;
    expect(verifyWebhookSignature(body, invalid, "s3cr3t")).toBe(false);
  });
});

describe("mergeMemory", () => {
  it("agrega sin duplicar y recorta", () => {
    expect(mergeMemory(null, "Prefiere mañanas.")).toBe("Prefiere mañanas.");
    expect(mergeMemory("Prefiere mañanas.", "Prefiere mañanas.")).toBe("Prefiere mañanas.");
    expect(mergeMemory("A.", null)).toBe("A.");
    expect(mergeMemory("x".repeat(790), "nuevo dato importante", 800)!.length).toBeLessThanOrEqual(801);
  });

  it("anota el día en que lo contó y no repite lo mismo otro día", () => {
    expect(mergeMemory(null, "Dice que «se le salió un pedacito de muela».", 800, "30 de oct de 2026")).toBe(
      "[30 de oct de 2026] Dice que «se le salió un pedacito de muela».",
    );
    const previa = "Prefiere mañanas. [2 de mar de 2026] Le duele una muela de abajo.";
    expect(mergeMemory(previa, "Le duele una muela de abajo.", 800, "30 de oct de 2026")).toBe(previa);
    expect(mergeMemory(previa, "Pide turno los martes.", 800, "30 de oct de 2026")).toBe(`${previa} [30 de oct de 2026] Pide turno los martes.`);
  });
});

describe("canales", () => {
  const base: PostCallPayload = { agent_id: "a", conversation_id: "c" };
  it("detecta WhatsApp, teléfono y web", () => {
    expect(detectChannel({ ...base, metadata: { whatsapp: {} } }, "5491155550001")).toBe("whatsapp");
    expect(detectChannel({ ...base, metadata: { phone_call: { type: "twilio" } } }, "5491155550001")).toBe("telefono");
    expect(detectChannel(base, "web-1234")).toBe("web");
  });

  it("asigna el origen del turno", () => {
    expect(sourceFromChannel("whatsapp", "549")).toBe("whatsapp");
    expect(sourceFromChannel("twilio", "549")).toBe("telefono");
    expect(sourceFromChannel(undefined, "web-1")).toBe("web");
  });
});
