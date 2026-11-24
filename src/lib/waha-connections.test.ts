import { afterEach, describe, expect, it, vi } from "vitest";
import { currentWahaConnection, wahaConnections, withWahaConnection } from "./waha-connections";
import { chatIsActive, requireActiveWhatsapp } from "./messaging-settings";
import { wahaDownloadMedia, wahaSendText } from "./waha";

vi.mock("./db", () => ({ sql: vi.fn(() => { throw new Error("No debe consultar el selector general."); }) }));

const own = {
  id: "consultorio-a", clinicId: "11111111-1111-4111-8111-111111111111", phone: "5491111111111",
  url: "https://consultorio-a.test", apiKey: "clave-api-consultorio-a", webhookHmac: "hmac-consultorio-a",
  session: "default", enabled: true, revision: 3,
};

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("líneas WAHA propias", () => {
  it("corrige una sesión y sus credenciales conservando todas las demás líneas y su asignación", () => {
    const other = { ...own, id: "consultorio-b", clinicId: "22222222-2222-4222-8222-222222222222", phone: "5491122222222", url: "https://consultorio-b.test" };
    const before = { ...own, session: "otra-sesion" };
    vi.stubEnv("WAHA_CONNECTIONS", JSON.stringify([before, other]));
    vi.stubEnv("WAHA_CONNECTION_TRANSPORTS", JSON.stringify({ [own.id]: {
      url: "https://transporte-correcto.test", apiKey: "clave-del-transporte-correcto", session: "default", revision: 4,
    } }));
    const rows = wahaConnections();
    expect(rows[0]).toEqual({ ...own, url: "https://transporte-correcto.test", apiKey: "clave-del-transporte-correcto", revision: 4 });
    expect(rows[1]).toEqual(other);
    vi.stubEnv("WAHA_CONNECTION_TRANSPORTS", "{}");
    expect(wahaConnections()).toEqual([before, other]);
  });

  it("no permite crear líneas, cambiar su identidad o introducir un transporte inseguro", () => {
    vi.stubEnv("WAHA_CONNECTIONS", JSON.stringify([own]));
    for (const patch of [
      { desconocida: { session: "default" } },
      { [own.id]: { clinicId: "22222222-2222-4222-8222-222222222222" } },
      { [own.id]: { phone: "5491122222222" } },
      { [own.id]: { webhookHmac: "otro-secreto-de-firma" } },
      { [own.id]: { enabled: false } },
      { [own.id]: { url: "http://host.test" } },
    ]) {
      vi.stubEnv("WAHA_CONNECTION_TRANSPORTS", JSON.stringify(patch));
      expect(() => wahaConnections()).toThrow(/WAHA_CONNECTION_TRANSPORTS/);
    }
  });

  it("rechaza destinos y asignaciones ambiguas sin imprimir claves", () => {
    for (const entries of [[own, own], [{ ...own, url: "https://usuario:clave@host.test" }], [{ ...own, url: "http://host.test" }]]) {
      vi.stubEnv("WAHA_CONNECTIONS", JSON.stringify(entries));
      expect(() => wahaConnections()).toThrow(/WAHA_CONNECTIONS/);
      try { wahaConnections(); } catch (error) { expect(String(error)).not.toContain(own.apiKey); }
    }
  });

  it("mantiene aislados dos mensajes concurrentes y restablece el contexto", async () => {
    const other = { ...own, id: "consultorio-b", apiKey: "clave-api-consultorio-b", url: "https://consultorio-b.test" };
    const calls: Array<{ url: string; key: string | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, key: new Headers(init.headers).get("X-Api-Key") });
      return Response.json({ id: "sent" });
    }));
    await Promise.all([own, other].map((connection) => withWahaConnection(connection, async () => {
      await Promise.resolve();
      await wahaSendText("5491155551111@c.us", "Respuesta de prueba");
      expect(currentWahaConnection()?.id).toBe(connection.id);
    })));
    expect(calls).toEqual(expect.arrayContaining([
      { url: `${own.url}/api/sendText`, key: own.apiKey },
      { url: `${other.url}/api/sendText`, key: other.apiKey },
    ]));
    expect(currentWahaConnection()).toBeUndefined();
  });

  it("permite la línea propia y rechaza revisiones viejas, pausa y otro canal", async () => {
    await withWahaConnection(own, async () => {
      expect(await requireActiveWhatsapp()).toMatchObject({ active_channel: "whatsapp", revision: 3 });
      expect(await chatIsActive("5491155551111@c.us", 3)).toBe(true);
      expect(await chatIsActive("5491155551111@c.us", 2)).toBe(false);
      expect(await chatIsActive("telegram:123", 3)).toBe(false);
    });
    await withWahaConnection({ ...own, enabled: false }, async () => {
      await expect(requireActiveWhatsapp()).rejects.toThrow("pausado");
      expect(await chatIsActive("5491155551111@c.us", 3)).toBe(false);
    });
  });

  it("baja los archivos solo desde la instancia que recibió el mensaje", async () => {
    const mock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>().mockResolvedValue(new Response("archivo"));
    vi.stubGlobal("fetch", mock);
    await withWahaConnection(own, () => wahaDownloadMedia("http://localhost:3000/api/files/foto.jpeg"));
    expect(mock.mock.calls[0][0]).toBe(`${own.url}/api/files/foto.jpeg`);
  });
});
