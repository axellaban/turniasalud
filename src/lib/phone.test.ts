import { describe, expect, it } from "vitest";
import { displayPhone, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it.each([
    ["+54 9 11 5555-0001", "5491155550001"],
    ["+54 11 5555-0001", "5491155550001"],
    ["011 15 5555-0001", "5491155550001"],
    ["11 5555 0001", "5491155550001"],
    ["0351 15 555-0001", "5493515550001"],
    ["5491155550001", "5491155550001"],
    ["web-abc123", "web-abc123"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it("devuelve vacío para valores vacíos", () => {
    expect(normalizePhone(undefined)).toBe("");
    expect(normalizePhone("   ")).toBe("");
  });
});

describe("displayPhone", () => {
  it("formatea celulares argentinos", () => {
    expect(displayPhone("5491155550001")).toBe("+54 9 11 5555-0001");
  });
});
