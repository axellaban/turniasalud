import { describe, expect, it, vi } from "vitest";
import { busyFromFree, fitsFree, freeRanges, smileBirthDay, smileClient, smileErrorText, SmileApiError, smileEmail, smileIdNumber, smilePhone, smileSex, smileText, splitName } from "./smile-connect-api";

// Conversiones puras de la API de Smile Connect: celdas libres → tramos, lo ocupado, nombres y teléfonos.

const t = (hhmm: string) => Date.parse(`2026-12-02T${hhmm}:00Z`);
const cell = (pro: number, a: string, b: string) => ({ start: `2026-12-02T${a}:00.000Z`, end: `2026-12-02T${b}:00.000Z`, professionalId: pro });

describe("diagnóstico de un conflicto de Smile Connect", () => {
  it("identifica la operación y la referencia de un 500 sin guardar la consulta ni las credenciales", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "internal_error", request_id: "req-ficticio-500" } }, { status: 500 })));
    try {
      let caught: unknown;
      try { await smileClient("clave-ficticia").request("/appointments", { method: "POST", query: { paciente: "privado" }, body: {} }); } catch (e) { caught = e; }
      expect(caught).toMatchObject({ status: 500, operation: { method: "POST", path: "/appointments" } });
      const text = smileErrorText(caught);
      expect(text).toContain("POST /appointments");
      expect(text).toContain("req-ficticio-500");
      expect(text).not.toMatch(/privado|clave-ficticia/);
    } finally { vi.unstubAllGlobals(); }
  });
  it("conserva el código, el motivo y la referencia del proveedor al rechazar un cambio", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "slot_conflict", message: "The selected room is not available", request_id: "req-ficticio-123" } }, { status: 409 })));
    try {
      await expect(smileClient("clave-ficticia").request("/appointments/42", { method: "PATCH", body: {} })).rejects.toMatchObject({ status: 409, code: "slot_conflict", requestId: "req-ficticio-123" });
      const text = smileErrorText(new SmileApiError("The selected room is not available", 409, "slot_conflict", null, "req-ficticio-123"));
      expect(text).toContain("slot_conflict");
      expect(text).toContain("selected room is not available");
      expect(text).toContain("req-ficticio-123");
      expect(text.length).toBeLessThanOrEqual(300);
      expect(text).not.toContain("turno cambió recién");
    } finally { vi.unstubAllGlobals(); }
  });

  it("no muestra una clave que el proveedor incluya accidentalmente en su mensaje", () => {
    const text = smileErrorText(new SmileApiError("conflict sc_live_ficticia.secreto-ficticio Bearer secreto-ficticio", 409, "conflict"));
    expect(text).not.toContain("secreto-ficticio");
    expect(text).toContain("[clave]");
  });
});

describe("disponibilidad de Smile Connect", () => {
  it("une las celdas de 5 minutos en tramos por profesional", () => {
    const free = freeRanges([cell(334, "14:00", "14:05"), cell(334, "14:05", "14:10"), cell(335, "15:00", "15:05"), cell(334, "14:30", "14:35")]);
    expect(free.get(334)).toEqual([[t("14:00"), t("14:10")], [t("14:30"), t("14:35")]]);
    expect(free.get(335)).toEqual([[t("15:00"), t("15:05")]]);
  });

  it("lo ocupado es todo lo que no está libre en el día", () => {
    const free: Array<[number, number]> = [[t("14:00"), t("15:00")], [t("16:00"), t("17:00")]];
    expect(busyFromFree(free, t("12:00"), t("18:00"))).toEqual([[t("12:00"), t("14:00")], [t("15:00"), t("16:00")], [t("17:00"), t("18:00")]]);
    expect(busyFromFree([], t("12:00"), t("18:00"))).toEqual([[t("12:00"), t("18:00")]]);
    expect(fitsFree(free, t("14:15"), t("14:45"))).toBe(true);
    expect(fitsFree(free, t("14:45"), t("15:15"))).toBe(false);
  });
});

describe("datos para crear un paciente en Smile Connect", () => {
  it("separa nombre y apellido (los dos obligatorios)", () => {
    expect(splitName("María José García")).toEqual({ name: "María José", surname: "García" });
    expect(splitName("Juana")).toEqual({ name: "Juana", surname: "Sin apellido" });
    expect(splitName("  ")).toEqual({ name: "Paciente", surname: "Sin apellido" });
  });

  it("pasa el celular de WhatsApp al número nacional sin el 9", () => {
    expect(smilePhone("5492235551234")).toEqual({ phone_country_code: "54", phone_number: "2235551234" });
    expect(smilePhone("541155550000")).toEqual({ phone_country_code: "54", phone_number: "1155550000" });
    expect(smilePhone("12025550100")).toBeNull();
    expect(smilePhone(null)).toBeNull();
  });
});

describe("datos del paciente que acepta Smile Connect", () => {
  it("deja afuera el mail o el documento que la API rechazaría", () => {
    expect(smileEmail("ana.perez@mail.com")).toBe("ana.perez@mail.com");
    expect(smileEmail(" ana@mail.com.ar ")).toBe("ana@mail.com.ar");
    for (const bad of ["ana@mail", "ana..perez@mail.com", ".ana@mail.com", "ana perez@mail.com", "ana@mail.c", "", null]) expect(smileEmail(bad)).toBeUndefined();
    expect(smileIdNumber("30111222")).toBe("30111222");
    expect(smileIdNumber("x".repeat(51))).toBeUndefined();
    expect(smileIdNumber(null)).toBeUndefined();
  });
});

describe("ficha completa de un paciente nuevo en Smile Connect", () => {
  it("manda la fecha de nacimiento solo si es real y no futura", () => {
    const now = new Date("2026-11-26T12:00:00Z");
    expect(smileBirthDay("1985-01-02", now)).toBe("1985-01-02");
    expect(smileBirthDay("1985-01-02T00:00:00Z", now)).toBe("1985-01-02");
    expect(smileBirthDay("1985-02-30", now)).toBeUndefined();
    expect(smileBirthDay("2027-01-01", now)).toBeUndefined();
    expect(smileBirthDay("02/01/1985", now)).toBeUndefined();
    expect(smileBirthDay(null, now)).toBeUndefined();
  });

  it("pasa el sexo de la ficha al de Smile Connect y recorta los textos", () => {
    expect(smileSex("femenino")).toBe("female");
    expect(smileSex("masculino")).toBe("male");
    expect(smileSex("otro")).toBe("other");
    expect(smileSex(null)).toBeUndefined();
    expect(smileText("  Av.   Colón 1234 ", 200)).toBe("Av. Colón 1234");
    expect(smileText("x".repeat(300), 200)).toHaveLength(200);
    expect(smileText("   ", 200)).toBeUndefined();
  });
});
