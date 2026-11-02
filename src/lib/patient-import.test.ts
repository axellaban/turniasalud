import { describe, expect, it } from "vitest";
import { buildImport, detectMapping, matchExisting, matchService, parseDate, parsePhone, parseSex, parseTable, readPhone, similarNames, suggestAreaCode } from "./patient-import";

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
    // Ningún código de área empieza con 15 o con 10: es un celular local sin el código.
    expect(parsePhone("15 4555-0123")).toBeNull();
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
    const result = buildImport(table, detectMapping(table.headers), { today: TODAY });
    expect(result.rows).toBe(6);
    // Jorge no tiene un celular que sirva: entra igual, sin celular y con el número en las notas.
    expect(result.patients.map((p) => p.phone)).toEqual(["5491155550001", null, "5491155550003", "5491155550004"]);
    expect(result.patients[1]).toMatchObject({ full_name: "Jorge Pérez", notes: "Celular en la planilla, que no sirve para WhatsApp: «4444-5555»." });
    expect(result.withoutPhone).toBe(1);
    const maria = result.patients[0];
    expect(maria).toMatchObject({ full_name: "María González", next_control_at: "2026-09-10", next_control_reason: "control de limpieza dental" });
    expect(maria.visits).toEqual([
      { visited_at: "2026-03-10", service: "Limpieza dental", professional: "Dra. Paz" },
      { visited_at: "2025-09-12", service: "Limpieza dental", professional: "Dra. Paz" },
    ]);
    // La de Jorge también cuenta: su ficha entra aunque no tenga celular.
    expect(result.visits).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.problems).toEqual([
      { line: 5, reason: "Celular no válido: «4444-5555». Entra sin celular." },
      { line: 6, reason: "La visita del 15/12/2026 es futura: no se cuenta." },
      { line: 7, reason: "Fecha de visita no válida: «hace un año»" },
    ]);
  });

  it("no repite «control» en el motivo del próximo control", () => {
    const table = parseTable("Paciente;Celular;Prestación;Próximo control\nAna;11 5555 0003;Control de ortodoncia;10/11/2026");
    expect(buildImport(table, detectMapping(table.headers), { today: TODAY }).patients[0].next_control_reason).toBe("Control de ortodoncia");
  });

  it("completa el código de área de los números locales y lo sugiere por el resto de la planilla", () => {
    expect(readPhone("4555-0123", "11")).toEqual({ phone: "5491145550123", completed: true });
    expect(readPhone("15 4555-0123", "011")).toEqual({ phone: "5491145550123", completed: true });
    expect(readPhone("495-1234", "223")).toEqual({ phone: "5492234951234", completed: true });
    expect(readPhone("11 5555-0001", "223")).toEqual({ phone: "5491155550001", completed: false });
    // Con un dígito de menos o de más no se adivina.
    expect(readPhone("115550123", "11")).toEqual({ phone: null, completed: false });
    expect(readPhone("1111", "11")).toEqual({ phone: null, completed: false });
    expect(readPhone("4555-0123", null)).toEqual({ phone: null, completed: false });
    const table = parseTable(["Paciente;Celular", ...Array.from({ length: 6 }, (_, i) => `P${i};11 5555-000${i}`), "Q;351 555-0001"].join("\n"));
    expect(suggestAreaCode(table, detectMapping(table.headers))).toBe("11");
  });

  it("entiende el sexo y reconoce sexo y dirección en los encabezados", () => {
    expect([parseSex("Femenino"), parseSex("M"), parseSex("Otro"), parseSex("varón"), parseSex(""), parseSex("?")]).toEqual(["femenino", "masculino", "otro", "masculino", null, null]);
    expect(detectMapping(["Paciente", "Celular", "Edad", "Sexo", "Dirección"])).toEqual(["full_name", "phone", null, "sex", "address"]);
  });

  it("sabe cuándo dos nombres son la misma persona escrita de dos maneras", () => {
    for (const [a, b] of [
      ["Norma Ricci", "Norma Riccis"],
      ["Testa Juan Ignacio", "Ignacio Testa"],
      ["Enrique Bouret", "Henrique Bourret"],
      ["Luciana Tolketine", "Luciana Tolquentine"],
      ["Rosana Pantolini", "Roxana Pontolini"],
      ["Christian Lodovico", "Cristian Lodovico"],
    ]) expect(similarNames(a, b), `${a} = ${b}`).toBe(true);
    for (const [a, b] of [
      ["Miguel Arrieta", "Susana Arrieta"],
      ["Ariana Sosti", "Marisa Sosti"],
      ["Mariano Pérez", "Mariana Pérez"],
      ["Dana Velo", "Velo Roy"],
      ["Gabriela Ponzio", "Pedro Antonio Ponzio"],
      ["Norma", "Norma Riccis"],
    ]) expect(similarNames(a, b), `${a} ≠ ${b}`).toBe(false);
  });

  it("una familia con un mismo celular queda en fichas aparte y la misma persona repetida se junta", () => {
    const table = parseTable(
      [
        "Paciente;Celular;DNI;Fecha de nacimiento;Sexo;Email;Dirección;Última visita;Profesional",
        "Valeria Ostini;11 5555-0707;27000111;15/03/1981;Femenino;valeria@example.com;Calle Falsa 123;10/07/2026;Dr. Gómez",
        "Tobías Quiroga;11 5555-0707;53000222;09/05/2014;Masculino;;;22/07/2026;Dr. Gómez",
        "Sol Quiroga;11 5555-0707;48000333;;Femenino;;;;Dra. Paz",
        "Norma Ricci;11 5555-0808;6000444;11/06/1950;Femenino;normaricci@example.com;;20/08/2026;",
        "Norma Riccis;11 5555-0808;;;Femenino;normaric@example.com;;;",
        "Rita Solano;;;;Femenino;rita@hotmail;;;",
      ].join("\n"),
    );
    const mapping = detectMapping(table.headers);
    const result = buildImport(table, mapping, { today: TODAY });
    expect(result.patients.map((p) => p.full_name)).toEqual(["Valeria Ostini", "Tobías Quiroga", "Sol Quiroga", "Norma Ricci", "Rita Solano"]);
    expect(result.patients[0]).toMatchObject({ phone: "5491155550707", sex: "femenino", address: "Calle Falsa 123", birth_date: "1981-03-15" });
    expect(result.patients[1]).toMatchObject({ phone: "5491155550707", dni: "53000222", sex: "masculino", visits: [{ visited_at: "2026-07-22", service: "", professional: "Dr. Gómez" }] });
    // Sin fecha de visita, el profesional queda en las notas.
    expect(result.patients[2].notes).toBe("Profesional: Dra. Paz.");
    expect(result.patients[3]).toMatchObject({ email: "normaricci@example.com", lines: [5, 6], notes: "También figura como: Norma Riccis.\nOtro mail: normaric@example.com." });
    expect(result.patients[4]).toMatchObject({ phone: null, email: null, notes: "Mail en la planilla, mal escrito: «rita@hotmail»." });
    expect(result.shared).toEqual([
      {
        phone: "5491155550707",
        rows: [
          { line: 2, name: "Valeria Ostini", detail: "DNI 27000111 · nació el 15/03/1981 · vino el 10/07/2026", sameAs: null },
          { line: 3, name: "Tobías Quiroga", detail: "DNI 53000222 · nació el 09/05/2014 · vino el 22/07/2026", sameAs: null },
          { line: 4, name: "Sol Quiroga", detail: "DNI 48000333", sameAs: null },
        ],
      },
      {
        phone: "5491155550808",
        rows: [
          { line: 5, name: "Norma Ricci", detail: "DNI 6000444 · nació el 11/06/1950 · vino el 20/08/2026", sameAs: null },
          { line: 6, name: "Norma Riccis", detail: "sin DNI ni fecha", sameAs: 5 },
        ],
      },
    ]);

    // El consultorio lo corrige: Norma Riccis es otra persona y Abril es la misma que Bautista (por ejemplo).
    const fixed = buildImport(table, mapping, { today: TODAY, sameAs: { 6: 0, 4: 3 } });
    expect(fixed.patients.map((p) => p.full_name)).toEqual(["Valeria Ostini", "Tobías Quiroga", "Norma Ricci", "Norma Riccis", "Rita Solano"]);
    expect(fixed.shared[0].rows[2].sameAs).toBe(3);
  });

  it("encuentra las fichas que ya estaban por DNI, por celular y nombre o por nombre sin celular", () => {
    const table = parseTable(
      ["Paciente;Celular;DNI", "Valeria Ostini;11 5555-0707;27000111", "Tobías Quiroga;11 5555-0707;", "Lucas Benítez;;", "Nueva Persona;11 5555-0909;"].join("\n"),
    );
    const { patients } = buildImport(table, detectMapping(table.headers), { today: TODAY });
    const existing = [
      { id: "ceci", phone: "5491199990000", full_name: "Cecilia P.", dni: "27000111", birth_date: null, sex: null },
      { id: "bau", phone: "5491155550707", full_name: "Tobías Quiroga", dni: null, birth_date: null, sex: null },
      { id: "lucas", phone: null, full_name: "lucas benítez", dni: null, birth_date: null, sex: null },
      // Una ficha provisoria de WhatsApp (sin nombre) con el celular de una familia: no se le asigna a nadie.
      { id: "wa", phone: "5491155550707", full_name: null, dni: null, birth_date: null, sex: null },
    ];
    expect(matchExisting(patients, existing)).toEqual(["ceci", "bau", "lucas", null]);
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
