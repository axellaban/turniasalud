import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseWahaEvent, phoneFromJid, verifyWahaHmac, type WahaEvent } from "./waha";
import { summarizeReply, toWhatsAppText } from "./channel";
import { OPT_OUT_FOOTER, renderTemplate, templateKeyFor } from "./whatsapp";
import { detectChannel } from "./conversations";
import { sourceFromChannel } from "./agent/service";

describe("verifyWahaHmac", () => {
  it("coincide con el ejemplo de la documentación de WAHA", () => {
    const body = '{"event":"message","session":"default","engine":"WEBJS"}';
    const expected =
      "208f8a55dde9e05519e898b10b89bf0d0b3b0fdf11fdbf09b6b90476301b98d8097c462b2b17a6ce93b6b47a136cf2e78a33a63f6752c2c1631777076153fa89";
    expect(verifyWahaHmac(body, expected, "sha512", "my-secret-key")).toBe(true);
    expect(verifyWahaHmac(body, expected.toUpperCase(), null, "my-secret-key")).toBe(true);
  });

  it("rechaza otra clave, cuerpo alterado, algoritmo desconocido o sin firma", () => {
    const body = JSON.stringify({ event: "message" });
    const sig = createHmac("sha512", "clave").update(body).digest("hex");
    expect(verifyWahaHmac(body, sig, "sha512", "clave")).toBe(true);
    expect(verifyWahaHmac(body, sig, "sha512", "otra")).toBe(false);
    expect(verifyWahaHmac(body + " ", sig, "sha512", "clave")).toBe(false);
    expect(verifyWahaHmac(body, sig, "md5", "clave")).toBe(false);
    expect(verifyWahaHmac(body, null, "sha512", "clave")).toBe(false);
    expect(verifyWahaHmac(body, sig, "sha512", "")).toBe(false);
    const sha256 = createHmac("sha256", "clave").update(body).digest("hex");
    expect(verifyWahaHmac(body, sha256, "sha256", "clave")).toBe(true);
  });
});

describe("parseWahaEvent", () => {
  const msg = (payload: WahaEvent["payload"], extra: Partial<WahaEvent> = {}): WahaEvent => ({
    event: "message",
    session: "default",
    payload: { id: "false_5491155550001@c.us_ABC", from: "5491155550001@c.us", fromMe: false, body: "Hola", hasMedia: false, ...payload },
    ...extra,
  });

  it("toma texto de un chat individual", () => {
    expect(parseWahaEvent(msg({}), "default")).toEqual({
      kind: "message",
      id: "false_5491155550001@c.us_ABC",
      chatId: "5491155550001@c.us",
      phone: "5491155550001",
      text: "Hola",
      audio: null,
      otherMedia: false,
      media: null,
    });
  });

  it("ignora mensajes propios, grupos, estados, canales, otros eventos y otras sesiones", () => {
    expect(parseWahaEvent(msg({ fromMe: true }))).toMatchObject({ kind: "ignore" });
    expect(parseWahaEvent(msg({ from: "120363@g.us" }))).toMatchObject({ kind: "ignore", reason: "grupo" });
    expect(parseWahaEvent(msg({ from: "status@broadcast" }))).toMatchObject({ kind: "ignore", reason: "estado" });
    expect(parseWahaEvent(msg({ from: "1203@newsletter" }))).toMatchObject({ kind: "ignore" });
    expect(parseWahaEvent(msg({}, { event: "message.ack" }))).toMatchObject({ kind: "ignore" });
    expect(parseWahaEvent(msg({}, { session: "otra" }), "default")).toMatchObject({ kind: "ignore", reason: "otra sesión" });
    expect(parseWahaEvent(msg({ body: "  " }))).toMatchObject({ kind: "ignore", reason: "mensaje vacío" });
  });

  it("reconoce audios y otros adjuntos", () => {
    const audio = parseWahaEvent(msg({ body: "", hasMedia: true, media: { url: "http://localhost:3000/api/files/a.oga", mimetype: "audio/ogg; codecs=opus" } }));
    expect(audio).toMatchObject({ kind: "message", text: "", audio: { url: "http://localhost:3000/api/files/a.oga" }, otherMedia: false });
    const photo = parseWahaEvent(msg({ body: "mi credencial", hasMedia: true, media: { url: null, mimetype: "image/jpeg" } }));
    expect(photo).toMatchObject({ kind: "message", text: "mi credencial", audio: null, otherMedia: true, media: { url: null, mimetype: "image/jpeg" } });
  });

  it("chats @lid: usa el teléfono de los datos del motor si viene, si no lo deja para buscarlo", () => {
    const withAlt = parseWahaEvent(msg({ from: "123456789@lid", _data: { key: { remoteJidAlt: "5491155550002@s.whatsapp.net" } } }));
    expect(withAlt).toMatchObject({ kind: "message", chatId: "123456789@lid", phone: "5491155550002" });
    const hidden = parseWahaEvent(msg({ from: "123456789@lid" }));
    expect(hidden).toMatchObject({ kind: "message", chatId: "123456789@lid", phone: null });
  });

  it("phoneFromJid solo acepta IDs de teléfono", () => {
    expect(phoneFromJid("5491155550001@c.us")).toBe("5491155550001");
    expect(phoneFromJid("5491155550001:12@s.whatsapp.net")).toBe("5491155550001");
    expect(phoneFromJid("123@lid")).toBeNull();
    expect(phoneFromJid(undefined)).toBeNull();
  });
});

describe("respuestas del Custom Channel", () => {
  it("une las respuestas del turno y detecta el cierre", () => {
    const r = summarizeReply({
      conversation_id: "conv_1",
      status: "completed",
      data: [
        { type: "agent_response", event: { agent_response: "Listo, te reservé el turno.", response_id: "r1" } },
        { type: "agent_response", event: { agent_response: "¿Algo más?", response_id: "r2" } },
        { type: "agent_tool_response", event: { tool_name: "end_call", tool_type: "system", status: "success" } },
      ],
    });
    expect(r).toEqual({ text: "Listo, te reservé el turno.\n\n¿Algo más?", ended: true, responseIds: ["r1", "r2"] });
    const errored = summarizeReply({ conversation_id: "c", status: "completed", data: [{ type: "agent_tool_response", event: { tool_name: "end_call", status: "error" } }] });
    expect(errored).toEqual({ text: "", ended: false, responseIds: [] });
  });

  it("pasa el Markdown al formato de WhatsApp", () => {
    expect(toWhatsAppText("Tu turno es el **martes 11/11** a las 10.\n## Dirección\n[Mapa](https://maps.example/x)")).toBe(
      "Tu turno es el *martes 11/11* a las 10.\nDirección\nMapa: https://maps.example/x",
    );
  });
});

describe("textos de WhatsApp por WAHA", () => {
  it("arma el texto de cada template y suma la baja solo en los mensajes no pedidos", () => {
    expect(renderTemplate("recordatorio", ["María", "martes 11/11 10:00 con Dra. Ruiz"], { optOutFooter: true })).toBe(
      "¡Hola María! Te recordamos tu turno el martes 11/11 10:00 con Dra. Ruiz. ¿Nos confirmás si venís? Si no podés, respondé este mensaje y lo reprogramamos.",
    );
    const recall = renderTemplate("recall", ["Jorge", "limpieza dental"], { optOutFooter: true });
    expect(recall).toBe(`¡Hola Jorge! Ya es momento de tu limpieza dental. ¿Querés que te busquemos un turno?\n\n${OPT_OUT_FOOTER}`);
    expect(renderTemplate("recall", ["Jorge", "limpieza dental"])).not.toContain("BAJA");
    expect(templateKeyFor("no_show")).toBe("no_show");
    expect(templateKeyFor("otra_cosa")).toBe("personalizada");
  });

  it("el Custom Channel cuenta como WhatsApp", () => {
    expect(sourceFromChannel("custom_channel", "5491155550001")).toBe("whatsapp");
    expect(detectChannel({ agent_id: "a", conversation_id: "c", conversation_initiation_client_data: { dynamic_variables: { system__channel: "custom_channel" } } }, "5491155550001")).toBe("whatsapp");
  });
});
