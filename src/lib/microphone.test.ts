import { afterEach, describe, expect, it, vi } from "vitest";
import { requestMicrophone } from "./microphone";

describe("permiso de micrófono", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("libera todos los tracks antes de iniciar el SDK o consultar un token", async () => {
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    const getUserMedia = vi.fn(async () => ({ getTracks: () => tracks }));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    await requestMicrophone();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
  });
  it("propaga el rechazo del permiso sin continuar", async () => {
    const error = new DOMException("denied", "NotAllowedError");
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(error) } });
    await expect(requestMicrophone()).rejects.toBe(error);
  });
});
