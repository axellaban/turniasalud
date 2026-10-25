import { describe, expect, it } from "vitest";
import { demoExample, dentalServices, servicesPhrase } from "./dental-services";

describe("tratamientos del odontólogo", () => {
  it("reconoce los de Doctoralia, en orden de peso y sin repetir", () => {
    const s = dentalServices("Prótesis odontológica, Ortodoncia, Implantes odontológicos, Estomatología, Rehabilitación oral");
    expect(s.map((x) => x.key)).toEqual(["implantes", "ortodoncia", "protesis"]);
    expect(servicesPhrase(s)).toBe("implantes, ortodoncia y prótesis");
    expect(servicesPhrase(dentalServices("Endodoncia"))).toBe("endodoncia");
    expect(dentalServices("Odontología")).toEqual([]);
    expect(dentalServices(null)).toEqual([]);
  });

  it("arma el ejemplo sobre su tratamiento principal, con su nombre y sin precios", () => {
    const implantes = demoExample(dentalServices("Ortodoncia, Implantes odontológicos"), "la Dra. Moreta", "del Consultorio Moreta");
    expect(implantes.paciente).toBe("Hola, ¿hacen implantes? Quería una evaluación.");
    expect(implantes.agente).toBe("¡Hola! Sí. Tengo el martes a las 10:30 para la evaluación con la Dra. Moreta. ¿Te lo reservo?");
    expect(demoExample(dentalServices("Odontopediatría"), "la Dra. Moreta", "del Consultorio Moreta").agente).toContain("la Dra. Moreta atiende odontopediatría");
    const general = demoExample([], "el Dr. Capris", "del Consultorio Odontológico Capris");
    expect(general.agente).toBe("¡Hola! Soy Sofi, del Consultorio Odontológico Capris. Tengo el martes a las 10:30 o el jueves a las 16 con el Dr. Capris. ¿Cuál te queda mejor?");
    expect(demoExample([], "el Dr. Capris", "del Consultorio Odontológico Capris", true).agente).toBe("¡Hola! Sí: el martes a las 10:30 con el Dr. Capris. ¿Te lo reservo?");
    // La vista previa de WhatsApp corta en 150 caracteres: la versión corta entra entera aun con nombres largos.
    for (const key of ["Implantes", "Ortodoncia", "Estética dental", "Endodoncia", "Odontopediatría", "Prótesis"]) {
      expect(demoExample(dentalServices(key), "la Dra. María de los Ángeles Alem Baraibar", "del Consultorio", true).agente.length).toBeLessThanOrEqual(150);
      expect(demoExample(dentalServices(key), "x", "y").agente).not.toMatch(/\$|precio/i);
    }
  });
});
