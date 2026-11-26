import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), sql: vi.fn(), notify: vi.fn() }));
vi.mock("@/lib/panel-clinic", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/db", () => ({ sql: mocks.sql }));
vi.mock("@/lib/n8n", () => ({ notifyN8n: mocks.notify }));
import { testAxelEmail } from "./alert-actions";

describe("prueba de email desde Sistema", () => {
  beforeEach(() => {
    mocks.admin.mockReset().mockResolvedValue(undefined);
    mocks.sql.mockReset().mockResolvedValue([{ key: "ficticio" }]);
    mocks.notify.mockReset().mockResolvedValue(true);
  });
  it("exige al administrador antes de consultar o enviar", async () => {
    mocks.admin.mockRejectedValueOnce(new Error("No autorizado"));
    await expect(testAxelEmail()).rejects.toThrow("No autorizado");
    expect(mocks.sql).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it("no repite el mensaje si ya se pidió una prueba este minuto", async () => {
    mocks.sql.mockResolvedValueOnce([]);
    expect(await testAxelEmail()).toMatchObject({ ok: false });
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it("manda solo un aviso técnico identificado y no afirma que fue entregado", async () => {
    expect(await testAxelEmail()).toMatchObject({ ok: true, message: expect.stringContaining("todavía no confirma la entrega") });
    expect(mocks.notify).toHaveBeenCalledWith("axel.aviso", { texto: expect.stringContaining("TURNIA-EMAIL-") });
    expect(mocks.notify.mock.calls[0][1].texto).toContain("No es una caída real");
  });
  it("si n8n lo rechaza informa el fallo y permite volver a intentar", async () => {
    mocks.notify.mockResolvedValueOnce(false);
    expect(await testAxelEmail()).toMatchObject({ ok: false, message: expect.stringContaining("no aceptó") });
    expect(mocks.sql).toHaveBeenCalledTimes(2);
  });
});
