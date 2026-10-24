import { describe, expect, it } from "vitest";
import { busyFromEvents, eventIdFor, shortName } from "./sync";

describe("busyFromEvents", () => {
  const tz = "America/Argentina/Buenos_Aires";
  it("un evento de todo el día ocupado bloquea el día entero en la zona de la clínica", () => {
    expect(busyFromEvents([{ start: { date: "2026-11-02" }, end: { date: "2026-11-03" } }], "p", tz)).toEqual([
      { professional_id: "p", starts_at: "2026-11-02T03:00:00.000Z", ends_at: "2026-11-03T03:00:00.000Z" },
    ]);
  });
  it("ignora los disponibles, los cancelados, los rechazados, los de Turnia y los mal formados", () => {
    const t = { start: { dateTime: "2026-11-02T13:00:00Z" }, end: { dateTime: "2026-11-02T14:00:00Z" } };
    expect(busyFromEvents([
      { ...t, transparency: "transparent" },
      { ...t, status: "cancelled" },
      { ...t, attendees: [{ self: true, responseStatus: "declined" }, { responseStatus: "accepted" }] },
      { ...t, extendedProperties: { private: { turnia_appointment_id: "a" } } },
      { start: { dateTime: "2026-11-02T14:00:00Z" }, end: { dateTime: "2026-11-02T13:00:00Z" } },
      { start: {} },
    ], "p", tz)).toEqual([]);
    expect(busyFromEvents([{ ...t, attendees: [{ self: true, responseStatus: "accepted" }] }], "p", tz)).toHaveLength(1);
  });
});

describe("eventos", () => {
  it("el id del evento sale del turno y usa solo caracteres que Google acepta", () => {
    const id = eventIdFor("0A1B2C3D-0000-4000-8000-00000000ABCD");
    expect(id).toBe("turnia0a1b2c3d00004000800000000000abcd");
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
  });
  it("en el calendario va el nombre corto del paciente", () => {
    expect(shortName("Juan Carlos Pérez")).toBe("Juan P.");
    expect(shortName("María")).toBe("María");
    expect(shortName(null)).toBe("Paciente");
    expect(shortName("  ")).toBe("Paciente");
  });
});
