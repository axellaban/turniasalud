import { describe, expect, it } from "vitest";
import { assignLanes, mergeSpans, occupancy, subtractSpans, visibleHours } from "./agenda-layout";

const h = (hour: number, minute = 0) => hour * 60 + minute;

describe("assignLanes", () => {
  it("los turnos que no se tocan usan todo el ancho", () => {
    const out = assignLanes([{ start: h(9), end: h(10) }, { start: h(10), end: h(11) }]);
    expect(out.map((o) => [o.lane, o.lanes])).toEqual([[0, 1], [0, 1]]);
  });

  it("los superpuestos van lado a lado y reusan el carril que se libera", () => {
    const out = assignLanes([
      { start: h(9), end: h(10), id: "a" },
      { start: h(9, 30), end: h(10, 30), id: "b" },
      { start: h(10), end: h(11), id: "c" },
    ]);
    const by = Object.fromEntries(out.map((o) => [o.id, [o.lane, o.lanes]]));
    expect(by).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2] });
  });
});

describe("intervalos", () => {
  it("une y resta", () => {
    expect(mergeSpans([{ start: 10, end: 20 }, { start: 15, end: 30 }, { start: 40, end: 50 }])).toEqual([{ start: 10, end: 30 }, { start: 40, end: 50 }]);
    expect(subtractSpans([{ start: 0, end: 100 }], [{ start: 20, end: 30 }, { start: 90, end: 120 }])).toEqual([{ start: 0, end: 20 }, { start: 30, end: 90 }]);
  });
});

describe("occupancy", () => {
  it("minutos con turno sobre minutos de atención, sin lo bloqueado", () => {
    const open = [{ start: h(9), end: h(13) }];
    expect(occupancy(open, [], [{ start: h(9), end: h(10) }])).toBe(0.25);
    expect(occupancy(open, [{ start: h(11), end: h(13) }], [{ start: h(9), end: h(10) }])).toBe(0.5);
    // Un turno fuera del horario no suma; dos superpuestos cuentan una vez.
    expect(occupancy(open, [], [{ start: h(8), end: h(9, 30) }, { start: h(9), end: h(9, 30) }])).toBe(0.125);
    expect(occupancy([], [], [])).toBeNull();
    expect(occupancy(open, [{ start: 0, end: h(24) }], [])).toBeNull();
  });
});

describe("visibleHours", () => {
  it("redondea a horas enteras y usa un horario por defecto", () => {
    expect(visibleHours([{ start: h(8, 30), end: h(12, 15) }, { start: h(16), end: h(19, 40) }])).toEqual({ start: h(8), end: h(20) });
    expect(visibleHours([])).toEqual({ start: h(8), end: h(20) });
  });
});
