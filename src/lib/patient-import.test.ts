import { describe, expect, it } from "vitest";
import { buildImport, detectMapping, matchService, parseDate, parsePhone, parseTable } from "./patient-import";

const TODAY = new Date("2026-10-25T12:00:00Z");

describe("importación de pacientes", () => {
  it("lee celdas pegadas de Excel, CSV con punto y coma y comillas", () => {
    expect(parseTable("Nombre\tCelular\nAna\t11 5555 0001\n")).toEqual({ headers: ["Nombre", "Celular"], rows: [["Ana", "11 5555 0001"]] });
    const csv = '﻿Apellido y nombre;Teléfono;Notas\r\n"Pérez; Jorge";011 15 5555-0002;"Dijo ""volver"" en marzo"\r\n\r\n';
    expect(parseTable(csv)).toEqual({ headers: ["Apellido y nombre", "Teléfono", "Notas"], rows: [["Pérez; Jorge", "011 15 5555-0002", 'Dijo "volver" en marzo']] });
    expect(parseTable("nombre,celular\nLucas,1155550004").rows).toEqual([["Lucas", "1155550004"]]);
  });

  it("reconoce los encabezados habituales sin confundir datos parecidos", () => {
    expect(detectMapping(["Paciente", "Tel. celular", "DNI", "Obra social", "Última visita", "Tratamiento", "Próximo control"])).toEqual([
      "full_name", "phone", "dni", "coverage", "last_visit", "service", "next_control",
    ]);
    expect(detectMapping(["Nombre", "Apellido", "WhatsApp"])).toEqual(["first_name", "last_name", "phone"]);
    // Solo "Nombre" es el nombre completo; la fecha de alta no es una visita.
    expect(detectMapping(["Nombre", "Celular", "Fecha de alta", "Fecha de nacimiento"])).toEqual(["full_name", "phone", null, "birth_date"]);
  });

  it("entiende fechas argentinas, ISO, de dos dígitos y números de serie de Excel", () => {
    expect(parseDate("31/12/2025", TODAY)).toBe("2025-12-31");
    expect(parseDate("3-2-25", TODAY)).toBe("2025-02-03");
    expect(parseDate("1/5/98", TODAY)).toBe("1998-05-01");
    expect(parseDate("2026-01-15 10:30", TODAY)).toBe("2026-01-15");
    expect(parseDate("12/31/2025", TODAY)).toBe("2025-12-31");
    expect(parseDate("45658", TODAY)).toBe("2025-01-01");
    expect(parseDate("31/02/2025", TODAY)).toBeNull();
    expect(parseDate("ayer", TODAY)).toBeNull();
  });

  it("toma el primer celular válido y descarta números sin código de área", () => {
    expect(parsePhone("011 15 5555-0001 / 4444-5555")).toBe("5491155550001");
    expect(parsePhone("+54 9 351 555-0001")).toBe("5493515550001");
    expect(parsePhone("4444-5555")).toBeNull();
    expect(parsePhone("")).toBeNull();
  });

  it("junta las filas de un mismo paciente y cada fecha queda como una visita", () => {
    const table = parseTable(
      [
        "Paciente;Celular;Fecha;Prestación;Profesional;Próximo control",
        "María González;11 5555-0001;10/03/2026;Limpieza dental;Dra. Paz;",
        "María González;+54 9 11 5555 0001;12/09/2025;Limpieza dental;Dra. Paz;",
        "María González;1155550001;10/03/2026;Limpieza dental;Dra. Paz;10/09/2026",
        "Jorge Pérez;4444-5555;01/01/2026;Consulta;;",
        "Ana Romero;11 5555 0003;15/12/2026;Lunares;;",
        "Lucas Díaz;11 5555 0004;hace un año;;;",
      ].join("\n"),
    );
    const result = buildImport(table, detectMapping(table.headers), TODAY);
    expect(result.rows).toBe(6);
    expect(result.patients.map((p) => p.phone)).toEqual(["5491155550001", "5491155550003", "5491155550004"]);
    const maria = result.patients[0];
    expect(maria).toMatchObject({ full_name: "María González", next_control_at: "2026-09-10", next_control_reason: "control de limpieza dental" });
    expect(maria.visits).toEqual([
      { visited_at: "2026-03-10", service: "Limpieza dental", professional: "Dra. Paz" },
      { visited_at: "2025-09-12", service: "Limpieza dental", professional: "Dra. Paz" },
    ]);
    expect(result.visits).toBe(2);
    expect(result.problems).toEqual([
      { line: 5, reason: "Celular no válido: «4444-5555»" },
      { line: 6, reason: "La visita del 15/12/2026 es futura: no se cuenta." },
      { line: 7, reason: "Fecha de visita no válida: «hace un año»" },
    ]);
  });

  it("no repite «control» en el motivo del próximo control", () => {
    const table = parseTable("Paciente;Celular;Prestación;Próximo control\nAna;11 5555 0003;Control de ortodoncia;10/11/2026");
    expect(buildImport(table, detectMapping(table.headers), TODAY).patients[0].next_control_reason).toBe("Control de ortodoncia");
  });

  it("une prestaciones importadas con las de la clínica solo si no hay dudas", () => {
    const types = [
      { id: "a", name: "Limpieza dental" },
      { id: "b", name: "Control de ortodoncia" },
      { id: "c", name: "Ortodoncia (primera vez)" },
    ];
    expect(matchService("LIMPIEZA DENTAL", types)?.id).toBe("a");
    expect(matchService("limpieza", types)?.id).toBe("a");
    expect(matchService("ortodoncia", types)).toBeNull();
    expect(matchService("Blanqueamiento", types)).toBeNull();
  });
});
