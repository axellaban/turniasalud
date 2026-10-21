import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticated: true,
  query: vi.fn<(...args: unknown[]) => Promise<Array<{ id: string }>>>(),
  revalidate: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "session-test" }) }) }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("REDIRECT_LOGIN"); } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/session", () => ({ SESSION_COOKIE: "turnia_session", verifySessionToken: () => mocks.authenticated }));
vi.mock("@/lib/db", () => ({ sql: mocks.query }));

import { updateLead } from "@/app/panel/(app)/demos/actions";
import { isLeadStatus } from "@/lib/leads";

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ id: "00000000-0000-4000-8000-000000000001", status: "contactado", notes: "  Llamar mañana  ", ...overrides })) data.set(key, value);
  return data;
}

describe("Seguimiento privado de pedidos de demo", () => {
  beforeEach(() => {
    mocks.authenticated = true;
    mocks.query.mockReset().mockResolvedValue([{ id: "00000000-0000-4000-8000-000000000001" }]);
    mocks.revalidate.mockClear();
  });

  it("rechaza una mutación sin sesión antes de acceder a los datos", async () => {
    mocks.authenticated = false;
    await expect(updateLead(undefined, form())).rejects.toThrow("REDIRECT_LOGIN");
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("rechaza estados heredados del prototipo, ids inválidos y notas excesivas", async () => {
    expect(isLeadStatus("toString")).toBe(false);
    const invalidForms: Record<string, string>[] = [{ status: "__proto__" }, { id: "x' or true --" }, { notes: "x".repeat(2001) }];
    for (const invalid of invalidForms) {
      expect((await updateLead(undefined, form(invalid))).ok).toBe(false);
    }
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("guarda las notas como datos parametrizados y actualiza la bandeja", async () => {
    const result = await updateLead(undefined, form({ notes: "  No borrar: '); delete from leads; --  " }));
    expect(result.ok).toBe(true);
    expect(mocks.query.mock.calls[0].slice(1)).toEqual(["contactado", "No borrar: '); delete from leads; --", "00000000-0000-4000-8000-000000000001"]);
    expect(mocks.revalidate).toHaveBeenCalledWith("/panel/demos");
  });

  it("no informa éxito cuando el pedido no existe o falla la base", async () => {
    mocks.query.mockResolvedValueOnce([]);
    expect((await updateLead(undefined, form())).ok).toBe(false);
    mocks.query.mockRejectedValueOnce(new Error("detalle privado"));
    const result = await updateLead(undefined, form());
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain("detalle privado");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
