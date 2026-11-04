import { describe, expect, it } from "vitest";
import {
  HEALTH_FORM_MARKER,
  HEALTH_QUESTIONS,
  addressLine,
  dentalHistory,
  healthFormTemplate,
  isHealthFormText,
  mergeHealthForm,
  missingForCompletion,
  positiveAnswers,
  splitFullName,
  splitHealthFormMessage,
  type HealthFormPatient,
} from "./health-form";

const known: HealthFormPatient = {
  full_name: "María Laura Fernández",
  dni: "30111222",
  birth_date: "1984-03-12",
  email: "ml@ejemplo.com",
  phone: "5491100009001",
  coverage: "OSDE",
  coverage_plan: "210",
  member_number: "61 234567 8 01",
  address: null,
  sex: "femenino",
};

describe("ficha de salud", () => {
  it("tiene las 32 preguntas de la hoja, sin ids repetidos", () => {
    expect(HEALTH_QUESTIONS).toHaveLength(32);
    expect(new Set(HEALTH_QUESTIONS.map((q) => q.id)).size).toBe(32);
  });

  it("la plantilla omite lo que ya sabemos y empieza con la marca", () => {
    const text = healthFormTemplate({}, known);
    expect(text.startsWith(HEALTH_FORM_MARKER)).toBe(true);
    expect(text).not.toMatch(/Apellido:|DNI:|Fecha de nacimiento:|Mail:|Cobertura/);
    expect(text).toContain("Domicilio (calle y número):");
    expect(text).toContain("Localidad:");
    expect(text).toContain("Embarazo (de cuántos meses):");
    expect(text).toContain("- de endodoncia (de conductos):");
    expect(text).toContain("¿Desea conocer las normas de bioseguridad del consultorio?:");
  });

  it("pide los datos que faltan y no le pregunta por embarazo a un hombre", () => {
    const text = healthFormTemplate({}, { ...known, full_name: null, birth_date: null, email: null, sex: "masculino" });
    expect(text).toContain("Apellido:\nNombres:");
    expect(text).toContain("Fecha de nacimiento:");
    expect(text).toContain("Mail:");
    expect(text).not.toContain("Embarazo");
  });

  it("después de una respuesta parcial, la plantilla trae solo lo que falta", () => {
    const data = mergeHealthForm({}, { hipertension: "SI", diabetes: "no", calle: "Av. Colón", localidad: "Mar del Plata" });
    expect(data.respuestas).toEqual({ hipertension: "si", diabetes: "no" });
    const text = healthFormTemplate(data, known);
    expect(text).not.toContain("Hipertensión");
    expect(text).not.toContain("Diabetes");
    expect(text).not.toContain("Domicilio");
    expect(text).toContain("Anemia:");
  });

  it("resto_no completa con NO lo que no marcó y la ficha queda completa", () => {
    const partial = mergeHealthForm({}, { anticoagulantes: "sí", otros: "Enalapril" });
    expect(missingForCompletion(partial, known)).toContain("Domicilio");
    const data = mergeHealthForm(partial, { resto_no: true, calle: "Av. Colón", numero: "2450", localidad: "Mar del Plata" });
    expect(Object.keys(data.respuestas ?? {})).toHaveLength(32);
    expect(data.respuestas?.anticoagulantes).toBe("si");
    expect(data.respuestas?.anemia).toBe("no");
    expect(data.bioseguridad).toBe("no");
    expect(data.otros).toBe("Enalapril");
    expect(missingForCompletion(data, known)).toEqual([]);
  });

  it("con el domicilio de la ficha del paciente no se lo vuelve a pedir", () => {
    const data = mergeHealthForm({}, { resto_no: true });
    expect(missingForCompletion(data, { ...known, address: "Rivadavia 100, Miramar" })).toEqual([]);
  });

  it("un tratamiento odontológico puntual marca también la pregunta general", () => {
    const data = mergeHealthForm({}, { endodoncia: "si", proteticos: "si", resto_no: true });
    expect(data.respuestas?.tratamientos_odontologicos).toBe("si");
    expect(dentalHistory(data)).toBe("de endodoncia y protéticos");
    expect(positiveAnswers(data)).toEqual([]);
  });

  it("muestra enfermedades con su detalle", () => {
    const data = mergeHealthForm({}, { embarazo: "si", embarazo_meses: "4", hepatitis: "si", hepatitis_cual: "B" });
    expect(positiveAnswers(data)).toEqual(["Embarazo (4)", "Hepatitis (B)"]);
  });

  it("separa la plantilla del resto del mensaje del agente", () => {
    const template = healthFormTemplate({}, known);
    const reply = `Listo, María: tu consulta quedó confirmada.\nPodés adelantarte completando la ficha por acá.\n\n${template}`;
    expect(splitHealthFormMessage(reply)).toEqual(["Listo, María: tu consulta quedó confirmada.\nPodés adelantarte completando la ficha por acá.", template]);
    expect(splitHealthFormMessage("Hola, ¿en qué te ayudo?")).toEqual(["Hola, ¿en qué te ayudo?"]);
    expect(splitHealthFormMessage(template)).toEqual([template]);
    // Aunque el modelo le saque el emoji o le ponga negrita.
    expect(splitHealthFormMessage("Te la dejo abajo.\n*FICHA DE SALUD*\nAnemia:")).toEqual(["Te la dejo abajo.", "*FICHA DE SALUD*\nAnemia:"]);
    expect(isHealthFormText(template)).toBe(true);
    expect(isHealthFormText("Listo: confirmado.")).toBe(false);
  });

  it("apellido y nombres: lo declarado o el último nombre como apellido", () => {
    expect(splitFullName({ apellido: "Pérez García", nombres: "Ana" }, "Ana Pérez García")).toEqual({ apellido: "Pérez García", nombres: "Ana" });
    expect(splitFullName({}, "María Laura Fernández")).toEqual({ apellido: "Fernández", nombres: "María Laura" });
    expect(splitFullName({}, null)).toEqual({ apellido: "", nombres: "" });
  });

  it("arma el domicilio para la ficha del paciente", () => {
    expect(addressLine({ calle: "Av. Colón", numero: "2450", piso: "3", dpto: "B", localidad: "Mar del Plata" })).toBe("Av. Colón 2450, piso 3 B, Mar del Plata");
    expect(addressLine({ localidad: "Miramar" })).toBeNull();
  });
});
