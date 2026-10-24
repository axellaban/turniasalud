import { describe, expect, it } from "vitest";
import { parseClockTime } from "./time";

describe("parseClockTime", () => {
  it("entiende las formas en que se escribe una hora", () => {
    expect(parseClockTime("9:15")).toBe("09:15");
    expect(parseClockTime("915")).toBe("09:15");
    expect(parseClockTime("1930")).toBe("19:30");
    expect(parseClockTime("9.15")).toBe("09:15");
    expect(parseClockTime("19 hs")).toBe("19:00");
    expect(parseClockTime("19")).toBe("19:00");
    expect(parseClockTime("7:29 p.m.")).toBe("19:29");
    expect(parseClockTime("12 am")).toBe("00:00");
    expect(parseClockTime("12:30 pm")).toBe("12:30");
  });

  it("rechaza lo que no es una hora", () => {
    expect(parseClockTime("")).toBeNull();
    expect(parseClockTime("25:00")).toBeNull();
    expect(parseClockTime("9:75")).toBeNull();
    expect(parseClockTime("13 pm")).toBeNull();
    expect(parseClockTime("mañana")).toBeNull();
  });
});
