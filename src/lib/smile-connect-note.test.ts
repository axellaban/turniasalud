import { describe, expect, it } from "vitest";
import {
  coverageNoteLine,
  healthLineOf,
  healthNoteLine,
  matchSmileService,
  SMILE_NOTES_MAX,
  smileAppointmentNote,
  withHealthLine,
  type SmileNoteInput,
} from "./smile-connect-note";

const base: SmileNoteInput = {
  prestacion: "Consulta de implantes",
  source: "whatsapp",
  agentName: "Sofi",
  coverage: "OSDE",
  patient: { coverage: "OSDE", coverage_plan: "310", member_number: "61234567801" },
  motivo: "se me movió un implante de abajo",
  health: { data: { respuestas: { alergia_medicamentos: "si", anticoagulantes: "si", diabetes: "no" }, otros: "hipotiroidismo" }, completed: true },
};

describe("nota del turno en Smile Connect", () => {
  it("lleva prestación, obra social con plan y afiliado, motivo y ficha de salud, en líneas", () => {
    expect(smileAppointmentNote(base)).toBe([
      "Consulta de implantes · Lo dio Sofi (Turnia)",
      "Obra social: OSDE · Plan: 310 · Afiliado: 61234567801",
      "Motivo: se me movió un implante de abajo",
      "Ficha de salud: Alergias a drogas o medicamentos; Toma anticoagulantes; Otros: hipotiroidismo",
    ].join("\n"));
  });

  it("dice lo que falta de la obra social, para que recepción lo pida", () => {
    expect(coverageNoteLine("OSDE", { coverage: "OSDE", coverage_plan: null, member_number: null }))
      .toBe("Obra social: OSDE · Plan: no lo dio · Afiliado: no lo dio");
    expect(coverageNoteLine(null, null)).toBe("Obra social: no la dio");
    expect(coverageNoteLine(null, { coverage: "Swiss Medical", coverage_plan: "SMG20", member_number: "80" }))
      .toBe("Obra social: Swiss Medical · Plan: SMG20 · Afiliado: 80");
    // «OSDE 210» ya trae el plan.
    expect(coverageNoteLine("OSDE 210", { coverage: "OSDE 210", coverage_plan: null, member_number: "1" })).toBe("Obra social: OSDE 210 · Afiliado: 1");
  });

  it("particular, o con otra cobertura que la de la ficha: no usa el plan ni el afiliado de la ficha", () => {
    expect(coverageNoteLine("Particular", base.patient)).toBe("Obra social: Particular");
    expect(coverageNoteLine("Galeno", base.patient)).toBe("Obra social: Galeno · Plan: no lo dio · Afiliado: no lo dio");
    expect(coverageNoteLine("osde", base.patient)).toBe("Obra social: osde · Plan: 310 · Afiliado: 61234567801");
  });

  it("sin ficha de salud no la menciona; incompleta lo dice; sin nada marcado también lo dice", () => {
    expect(smileAppointmentNote({ ...base, health: null })).not.toContain("Ficha de salud");
    expect(healthNoteLine({ data: {}, completed: false })).toBeNull();
    expect(healthNoteLine({ data: { respuestas: { asma: "si" } }, completed: false })).toBe("Ficha de salud (incompleta): Asma bronquial");
    expect(healthNoteLine({ data: { respuestas: { asma: "no" }, otros: "no" }, completed: true })).toBe("Ficha de salud: no marcó ninguna enfermedad ni medicación");
    expect(healthNoteLine({ data: { respuestas: { embarazo: "si" }, embarazo_meses: "5" }, completed: true })).toBe("Ficha de salud: Embarazo (5)");
  });

  it("el panel firma distinto y sin motivo no hay línea de motivo", () => {
    const note = smileAppointmentNote({ ...base, source: "panel", motivo: null, health: null });
    expect(note).toBe("Consulta de implantes · Lo cargó el consultorio en Turnia\nObra social: OSDE · Plan: 310 · Afiliado: 61234567801");
  });

  it("no pasa los 2000 caracteres: acorta el motivo y deja enteras la obra social y la ficha", () => {
    const note = smileAppointmentNote({ ...base, motivo: "x".repeat(5000) });
    expect(note.length).toBeLessThanOrEqual(SMILE_NOTES_MAX);
    expect(note).toContain("Obra social: OSDE · Plan: 310");
    expect(note.endsWith("Otros: hipotiroidismo")).toBe(true);
  });
});

describe("sumar la ficha de salud a una nota que ya está en Smile Connect", () => {
  const line = "Ficha de salud: Toma anticoagulantes";

  it("la agrega abajo sin tocar lo que escribió recepción", () => {
    expect(withHealthLine("Consulta · Lo dio Sofi (Turnia)\nTraer radiografía", line, null))
      .toBe(`Consulta · Lo dio Sofi (Turnia)\nTraer radiografía\n${line}`);
    expect(withHealthLine(null, line, null)).toBe(line);
  });

  it("reemplaza solo la línea que había escrito Turnia; si recepción la cambió, agrega la nueva", () => {
    const sent = "Ficha de salud (incompleta): Asma bronquial";
    expect(withHealthLine(`Consulta\n${sent}\nNota de recepción`, line, sent)).toBe(`Consulta\n${line}\nNota de recepción`);
    expect(withHealthLine("Consulta\nFicha de salud: revisar con el doctor", line, sent))
      .toBe(`Consulta\nFicha de salud: revisar con el doctor\n${line}`);
  });

  it("si ya está, o si no entra, no cambia nada", () => {
    expect(withHealthLine(`Consulta\n${line}`, line, null)).toBeNull();
    expect(withHealthLine("x".repeat(SMILE_NOTES_MAX - 5), line, null)).toBeNull();
  });

  it("encuentra la línea de la ficha dentro de una nota", () => {
    expect(healthLineOf(`Consulta\nObra social: OSDE\n${line}`)).toBe(line);
    expect(healthLineOf("Consulta")).toBeNull();
  });
});

describe("prestación de Smile Connect", () => {
  const services = [{ service_id: 12, name: "Limpieza" }, { service_id: 13, name: "Consulta de implantes" }, { service_id: 14, name: "Extracción" }];

  it("la que se llama igual, sin importar mayúsculas ni acentos; primero el nombre propio del turno", () => {
    expect(matchSmileService(services, ["Consulta de Implantes", "Consulta"])).toBe(13);
    expect(matchSmileService(services, [null, "extraccion"])).toBe(14);
  });

  it("sin coincidencia única no manda ninguna", () => {
    expect(matchSmileService(services, ["Consulta"])).toBeNull();
    expect(matchSmileService([...services, { service_id: 15, name: "LIMPIEZA" }], ["Limpieza"])).toBeNull();
    expect(matchSmileService(null, ["Limpieza"])).toBeNull();
  });
});
