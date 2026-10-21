import { describe, expect, it } from "vitest";
import { inicioDeLinea, leerSincronizacion, lineaActiva } from "./reproductor-sync";
import { CONVERSACIONES, estimarSegundos, formatearTiempo, getConversacion } from "@/content/conversaciones";

const segmentos = [
  { linea: 0, inicio: 0.2, fin: 3.1 },
  { linea: 1, inicio: 3.6, fin: 6 },
  { linea: 2, inicio: 6.4, fin: 9.8 },
];

describe("lineaActiva", () => {
  it("devuelve -1 antes del primer segmento", () => {
    expect(lineaActiva(segmentos, 0)).toBe(-1);
  });

  it("marca la línea que está sonando", () => {
    expect(lineaActiva(segmentos, 0.2)).toBe(0);
    expect(lineaActiva(segmentos, 4)).toBe(1);
    expect(lineaActiva(segmentos, 9)).toBe(2);
  });

  it("mantiene la última línea en los silencios y al final", () => {
    expect(lineaActiva(segmentos, 3.3)).toBe(0);
    expect(lineaActiva(segmentos, 60)).toBe(2);
  });

  it("no falla sin segmentos", () => {
    expect(lineaActiva([], 5)).toBe(-1);
  });
});

describe("leerSincronizacion", () => {
  it("acepta el formato del generador y ordena por inicio", () => {
    const sync = leerSincronizacion(
      { duracion: 10, segmentos: [segmentos[2], segmentos[0], segmentos[1]], version: 1 },
      3,
    );
    expect(sync?.segmentos.map((s) => s.linea)).toEqual([0, 1, 2]);
    expect(sync?.duracion).toBe(10);
  });

  it("descarta segmentos de líneas que no existen o mal formados", () => {
    const sync = leerSincronizacion(
      { duracion: 10, segmentos: [segmentos[0], { linea: 7, inicio: 1, fin: 2 }, { linea: 1, inicio: 5, fin: 4 }, null] },
      3,
    );
    expect(sync?.segmentos).toEqual([segmentos[0]]);
  });

  it("rechaza datos inválidos", () => {
    expect(leerSincronizacion(null, 3)).toBeNull();
    expect(leerSincronizacion({ duracion: 0, segmentos: [segmentos[0]] }, 3)).toBeNull();
    expect(leerSincronizacion({ duracion: 10, segmentos: [] }, 3)).toBeNull();
    expect(leerSincronizacion("<html>", 3)).toBeNull();
  });
});

describe("inicioDeLinea", () => {
  it("encuentra el inicio o null", () => {
    expect(inicioDeLinea(segmentos, 1)).toBe(3.6);
    expect(inicioDeLinea(segmentos, 5)).toBeNull();
  });
});

describe("guiones", () => {
  it("formatea tiempos como mm:ss", () => {
    expect(formatearTiempo(0)).toBe("00:00");
    expect(formatearTiempo(225.7)).toBe("03:45");
  });

  it("tiene los 7 guiones con slugs únicos, alternando agente y paciente", () => {
    expect(CONVERSACIONES.map((c) => c.slug)).toEqual([
      "home",
      "pediatria",
      "clinica-medica",
      "ginecologia-obstetricia",
      "dermatologia",
      "gastroenterologia",
      "cardiologia",
    ]);
    for (const c of CONVERSACIONES) {
      expect(c.lineas[0].quien).toBe("agente");
      for (let i = 1; i < c.lineas.length; i++) expect(c.lineas[i].quien).not.toBe(c.lineas[i - 1].quien);
      for (const l of c.lineas) {
        expect(l.texto.trim().length).toBeGreaterThan(0);
        expect(l.texto.length).toBeLessThan(1800);
      }
    }
  });

  it("estima entre 2 y 5 minutos por guion", () => {
    for (const c of CONVERSACIONES) {
      const s = estimarSegundos(c.lineas);
      expect(s, c.slug).toBeGreaterThan(120);
      expect(s, c.slug).toBeLessThan(300);
      expect(c.duracionEstimada).toBe(formatearTiempo(s));
    }
    expect(getConversacion("pediatria")?.titulo).toBe("Pediatría");
    expect(getConversacion("nada")).toBeUndefined();
  });
});
