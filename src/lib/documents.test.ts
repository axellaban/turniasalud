import { describe, expect, it } from "vitest";
import { documentForAgent, readableMimetype, type Lectura } from "./documents";

const vacia: Lectura = {
  tipo: "otro", legible: true, cobertura: null, plan: null, numero_afiliado: null, titular: null,
  practica: null, profesional: null, fecha: null, diagnostico: null, medicamentos: null, resumen: "",
};

describe("documentForAgent", () => {
  it("credencial: los datos entre comillas y que los confirme antes de guardarlos", () => {
    const text = documentForAgent({ ...vacia, tipo: "credencial", cobertura: "OSDE", plan: "210", numero_afiliado: "61 234567 8 01", titular: "Juan Carlos Montes" }, "mi credencial");
    expect(text).toBe("(foto de la credencial) cobertura: «OSDE», plan: «210», número de afiliado: «61 234567 8 01», titular: «Juan Carlos Montes». Confirmalos con el paciente antes de guardarlos con registrar_paciente.\nmi credencial");
  });

  it("orden, receta y estudio: qué dice y qué hacer con cada uno", () => {
    expect(documentForAgent({ ...vacia, tipo: "orden", practica: "Endodoncia pieza 36", profesional: "Dr. Mininni", fecha: "12/10/2026" }))
      .toBe("(foto de una orden o derivación) pide: «Endodoncia pieza 36», firma: «Dr. Mininni», fecha: «12/10/2026». Seguí las indicaciones de la clínica para órdenes y derivaciones.");
    expect(documentForAgent({ ...vacia, tipo: "receta", medicamentos: "Amoxicilina 500" })).toContain("No des indicaciones sobre medicación");
    expect(documentForAgent({ ...vacia, tipo: "estudio", practica: "Radiografía panorámica" })).toContain('No lo interpretes: si quiere que lo vea un profesional, creá una tarea de tipo "resultados".');
  });

  it("si no se lee, pide otra foto; lo leído se recorta y no rompe el formato", () => {
    expect(documentForAgent({ ...vacia, tipo: "credencial", legible: false })).toContain("Pedile otra con buena luz");
    const largo = documentForAgent({ ...vacia, tipo: "credencial", cobertura: `OSDE\n\n${"x".repeat(500)}` });
    expect(largo).not.toContain("\n");
    expect(largo.length).toBeLessThan(400);
    expect(documentForAgent({ ...vacia, tipo: "credencial" })).toContain("no se leen datos");
  });

  it("acepta fotos y PDF; no audios ni videos", () => {
    expect(readableMimetype("image/jpeg")).toBe(true);
    expect(readableMimetype("image/png")).toBe(true);
    expect(readableMimetype("application/pdf")).toBe(true);
    expect(readableMimetype("video/mp4")).toBe(false);
    expect(readableMimetype("audio/ogg")).toBe(false);
  });
});
