import { describe, expect, it } from "vitest";
import { computeSlots, expandBlocks, isOpenAt, isSlotFree, type ScheduleBlock } from "./slots";
import { zonedTimeToUtc } from "./time";

const TZ = "America/Argentina/Buenos_Aires";
const PRO = "pro-1";
// Lunes 9 a 11 → con turnos de 30 min hay 4 opciones: 9:00, 9:30, 10:00, 10:30
const schedules: ScheduleBlock[] = [{ professional_id: PRO, weekday: 1, start_time: "09:00", end_time: "11:00" }];
// Domingo 26/10/2025 a la noche: el lunes 27/10 está todo disponible.
const now = zonedTimeToUtc(2025, 10, 26, 20, 0, TZ);

describe("computeSlots", () => {
  it("genera turnos en hora argentina (UTC-3)", () => {
    const slots = computeSlots({
      schedules,
      busy: [],
      durationMin: 30,
      fromKey: "2025-10-27",
      toKey: "2025-10-27",
      timeZone: TZ,
      now,
      perDayPerProfessional: 10,
    });
    expect(slots.map((s) => s.starts_at)).toEqual([
      "2025-10-27T12:00:00.000Z",
      "2025-10-27T12:30:00.000Z",
      "2025-10-27T13:00:00.000Z",
      "2025-10-27T13:30:00.000Z",
    ]);
    expect(slots[0].label).toContain("lunes");
    expect(slots[0].label).toContain("09:00");
  });

  it("saltea los horarios ocupados", () => {
    const slots = computeSlots({
      schedules,
      busy: [{ professional_id: PRO, starts_at: "2025-10-27T12:30:00.000Z", ends_at: "2025-10-27T13:00:00.000Z" }],
      durationMin: 30,
      fromKey: "2025-10-27",
      toKey: "2025-10-27",
      timeZone: TZ,
      now,
      perDayPerProfessional: 10,
    });
    expect(slots.map((s) => s.starts_at)).not.toContain("2025-10-27T12:30:00.000Z");
    expect(slots).toHaveLength(3);
  });

  it("respeta la anticipación mínima", () => {
    const slots = computeSlots({
      schedules,
      busy: [],
      durationMin: 30,
      fromKey: "2025-10-27",
      toKey: "2025-10-27",
      timeZone: TZ,
      now: zonedTimeToUtc(2025, 10, 27, 9, 15, TZ),
      minLeadMinutes: 60,
      perDayPerProfessional: 10,
    });
    expect(slots.map((s) => s.starts_at)).toEqual(["2025-10-27T13:30:00.000Z"]);
  });

  it("filtra por franja horaria", () => {
    const afternoon: ScheduleBlock[] = [{ professional_id: PRO, weekday: 1, start_time: "12:00", end_time: "14:00" }];
    const slots = computeSlots({
      schedules: afternoon,
      busy: [],
      durationMin: 60,
      fromKey: "2025-10-27",
      toKey: "2025-10-27",
      timeZone: TZ,
      now,
      partOfDay: "tarde",
    });
    expect(slots.map((s) => s.starts_at)).toEqual(["2025-10-27T16:00:00.000Z"]);
  });

  it("limita turnos por día para dar variedad de fechas", () => {
    const slots = computeSlots({
      schedules,
      busy: [],
      durationMin: 30,
      fromKey: "2025-10-27",
      toKey: "2025-11-10",
      timeZone: TZ,
      now,
      perDayPerProfessional: 2,
      limit: 4,
    });
    expect(slots).toHaveLength(4);
    const days = new Set(slots.map((s) => s.starts_at.slice(0, 10)));
    expect(days.size).toBe(2);
  });
});

describe("bloqueos de agenda", () => {
  // Feriado de 00:00 a 24:00 hora argentina del lunes 27/10.
  const feriado = [{ professional_id: PRO, starts_at: "2025-10-27T03:00:00.000Z", ends_at: "2025-10-28T03:00:00.000Z" }];

  it("no ofrece turnos en un día bloqueado", () => {
    const slots = computeSlots({
      schedules, busy: [], blocked: feriado, durationMin: 30, fromKey: "2025-10-27", toKey: "2025-11-03", timeZone: TZ, now, perDayPerProfessional: 10,
    });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.starts_at.startsWith("2025-11-03"))).toBe(true);
  });

  it("un bloqueo sin profesional aplica a todos los de la clínica", () => {
    const expanded = expandBlocks([{ professional_id: null, starts_at: "a", ends_at: "b" }, { professional_id: "pro-2", starts_at: "c", ends_at: "d" }], [PRO, "pro-2"]);
    expect(expanded).toEqual([
      { professional_id: PRO, starts_at: "a", ends_at: "b" },
      { professional_id: "pro-2", starts_at: "a", ends_at: "b" },
      { professional_id: "pro-2", starts_at: "c", ends_at: "d" },
    ]);
  });

  it("sabe si la clínica está atendiendo, salvo feriados", () => {
    expect(isOpenAt(schedules, [], new Date("2025-10-27T12:30:00.000Z"), TZ)).toBe(true);
    expect(isOpenAt(schedules, [], new Date("2025-10-27T14:00:00.000Z"), TZ)).toBe(false);
    expect(isOpenAt(schedules, feriado, new Date("2025-10-27T12:30:00.000Z"), TZ)).toBe(false);
  });

  it("rechaza reservar en un bloqueo con un motivo propio", () => {
    const result = isSlotFree(schedules, [], new Date("2025-10-27T12:30:00.000Z"), 30, TZ, feriado);
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("feriado") });
  });
});

describe("isSlotFree", () => {
  it("acepta un horario dentro de la agenda y libre", () => {
    expect(isSlotFree(schedules, [], new Date("2025-10-27T12:30:00.000Z"), 30, TZ)).toEqual({ ok: true });
  });

  it("rechaza horarios fuera de agenda", () => {
    const result = isSlotFree(schedules, [], new Date("2025-10-27T14:00:00.000Z"), 30, TZ);
    expect(result.ok).toBe(false);
  });

  it("rechaza horarios superpuestos", () => {
    const result = isSlotFree(
      schedules,
      [{ professional_id: PRO, starts_at: "2025-10-27T12:15:00.000Z", ends_at: "2025-10-27T12:45:00.000Z" }],
      new Date("2025-10-27T12:30:00.000Z"),
      30,
      TZ,
    );
    expect(result.ok).toBe(false);
  });
});
