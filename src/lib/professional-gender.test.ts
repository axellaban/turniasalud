import { describe, expect, it } from "vitest";
import { professionalGender } from "./professional-gender";

describe("professionalGender", () => {
  it("usa lo cargado en el panel antes que el título", () => {
    expect(professionalGender({ full_name: "Dr. Pérez", gender: "mujer" })).toBe("mujer");
  });
  it("lo deduce del título del nombre", () => {
    expect(professionalGender({ full_name: "Dra. Ana Coldeira" })).toBe("mujer");
    expect(professionalGender({ full_name: "dra Ana" })).toBe("mujer");
    expect(professionalGender({ full_name: "Dr. Mariano Mininni" })).toBe("hombre");
    expect(professionalGender({ full_name: "DR Juan" })).toBe("hombre");
  });
  it("sin título ni dato no adivina por el nombre de pila", () => {
    expect(professionalGender({ full_name: "Lara Fernández" })).toBeNull();
    expect(professionalGender({ full_name: "Drago Ruiz" })).toBeNull();
  });
});
