import { describe, expect, it } from "vitest";
import { parseFolds, serializeFolds } from "./folds";

describe("secciones plegadas de «Para hoy»", () => {
  it("lee y escribe lo que dejó el administrador", () => {
    expect(parseFolds("esperan:0,seguimientos:1")).toEqual({ esperan: false, seguimientos: true });
    expect(serializeFolds({ esperan: false, seguimientos: true })).toBe("esperan:0,seguimientos:1");
    expect(parseFolds(serializeFolds({ esperan: true }))).toEqual({ esperan: true });
  });

  it("sin cookie o con basura, usa lo de siempre", () => {
    expect(parseFolds(undefined)).toEqual({});
    expect(parseFolds("")).toEqual({});
    expect(parseFolds("esperan:x,:1,seguimientos")).toEqual({});
  });
});
