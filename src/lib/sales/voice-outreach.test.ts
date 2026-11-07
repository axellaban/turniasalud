import { afterEach, describe, expect, it, vi } from "vitest";
import { AXEL_WHATSAPP } from "./contacto-axel";
import { voiceChannelStatus } from "./voice-outreach";

const config = (host: string, phone: string) => JSON.stringify({
  url: `https://${host}.example`,
  apiKey: "clave-de-prueba",
  session: "default",
  phone,
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("líneas de audio de prospección", () => {
  it("no usa la línea personal cuando se selecciona el 5483 sin conexión", async () => {
    vi.stubEnv("WAHA_PROSPECCION", config("personal", "5492236000022"));
    vi.stubEnv("WAHA_PROSPECCION_5483", undefined);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    expect(await voiceChannelStatus("5483")).toEqual({ configured: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("consulta el servidor del emisor elegido y verifica el número vinculado", async () => {
    vi.stubEnv("WAHA_PROSPECCION", config("personal", "5492236000022"));
    vi.stubEnv("WAHA_PROSPECCION_5483", config("prospeccion", AXEL_WHATSAPP));
    const fetch = vi.fn(async () => Response.json({ status: "WORKING", me: { id: "5492236000022@c.us" } }));
    vi.stubGlobal("fetch", fetch);

    expect(await voiceChannelStatus("5483")).toMatchObject({ configured: true, ok: false });
    expect(fetch).toHaveBeenLastCalledWith("https://prospeccion.example/api/sessions/default", expect.anything());
    expect(await voiceChannelStatus("0022")).toMatchObject({ configured: true, ok: true });
    expect(fetch).toHaveBeenLastCalledWith("https://personal.example/api/sessions/default", expect.anything());

    fetch.mockImplementation(async () => Response.json({ status: "WORKING", me: { id: `${AXEL_WHATSAPP}@c.us` } }));
    expect(await voiceChannelStatus("5483")).toMatchObject({ configured: true, ok: true });
  });
});
