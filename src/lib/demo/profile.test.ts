import { describe, expect, it } from "vitest";
import { fallbackProfile, manualProfile, sanitizeProfile, type DemoProfile } from "./profile";
import { normalizeManualClinic } from "./website";

const site = {
  url: "https://www.odontosur.com.ar/",
  pages: [{ url: "https://www.odontosur.com.ar/", title: "Odonto Sur | Implantes y ortodoncia", text: "" }],
  text: "Teléfono: +54 11 4242-0000\nOdontología integral, implantes dentales y ortodoncia.\nDatos estructurados: {\"streetAddress\": \"Av. Alsina 123\"}",
};

describe("perfil de la demo", () => {
  it("sin modelo arma un perfil básico con lo que se ve en la web", () => {
    const p = fallbackProfile(site);
    expect(p.nombre).toBe("Odonto Sur");
    expect(p.especialidad).toBe("Odontología");
    expect(p.telefono).toBe("+54 11 4242-0000");
    expect(p.direccion).toBe("Av. Alsina 123");
    expect(p.prestaciones.map((t) => t.especialidad)).toEqual(["Odontología", "Odontología"]);
    expect(p.preguntas_frecuentes).toContain("implantes dentales");
  });

  it("no usa títulos genéricos como nombre", () => {
    const home = { ...site, pages: [{ ...site.pages[0], title: "Home" }], text: "Odontología" };
    expect(fallbackProfile(home).nombre).toBe("odontosur.com.ar");
    expect(fallbackProfile({ ...home, text: "Nombre del sitio: Odonto Sur SRL\nOdontología" }).nombre).toBe("Odonto Sur SRL");
  });

  it("corrige horarios, días, duraciones y precios imposibles que pueda devolver el modelo", () => {
    const raw: DemoProfile = {
      nombre: "  Odonto   Sur ",
      especialidad: "Odontología",
      descripcion: "Clínica",
      direccion: "",
      telefono: null,
      horario_texto: null,
      horarios: [
        { dia: 1, desde: "9:00", hasta: "18:00" },
        { dia: 7, desde: "09:00", hasta: "12:00" },
        { dia: 2, desde: "18:00", hasta: "09:00" },
        { dia: 3, desde: "mañana", hasta: "tarde" },
      ],
      coberturas: ["OSDE", "OSDE", " "],
      profesionales: [{ nombre: "Dra. Ana", especialidad: "", dias: [1, 9, 1], bio: null }, { nombre: "", especialidad: "x", dias: [], bio: null }],
      prestaciones: [{ nombre: "Limpieza", especialidad: "Odontología", duracion_min: 3, precio: -5, indicaciones: null, primera_vez: false }],
      preguntas_frecuentes: "",
      politicas: "",
    };
    const p = sanitizeProfile(raw, site);
    expect(p.nombre).toBe("Odonto Sur");
    expect(p.direccion).toBeNull();
    expect(p.horarios).toEqual([{ dia: 1, desde: "09:00", hasta: "18:00" }]);
    expect(p.coberturas).toEqual(["OSDE"]);
    expect(p.profesionales).toEqual([{ nombre: "Dra. Ana", especialidad: "Odontología", dias: [1], bio: null }]);
    expect(p.prestaciones[0]).toMatchObject({ duracion_min: 10, precio: null });
    expect(p.politicas).toBeNull();
  });

  it("sin web arma la ficha con el nombre, la dirección y turnos de la especialidad", () => {
    const p = manualProfile({ nombre: "Consultorio Arroyo", direccion: "Córdoba 3380, Mar del Plata", especialidad: "Odontología" });
    expect(p).toMatchObject({ nombre: "Consultorio Arroyo", especialidad: "Odontología", direccion: "Córdoba 3380, Mar del Plata", profesionales: [], coberturas: [] });
    expect(p.prestaciones.map((t) => t.nombre)).toEqual(["Consulta de primera vez", "Limpieza dental", "Control", "Urgencia odontológica"]);
    // La especialidad también se deduce del nombre; si no se reconoce, queda la que escribió la persona.
    expect(manualProfile({ nombre: "Odontología Sur", direccion: null, especialidad: null }).especialidad).toBe("Odontología");
    expect(manualProfile({ nombre: "Centro Norte", direccion: null, especialidad: "Fonoaudiología" }).especialidad).toBe("Fonoaudiología");
  });

  it("valida el consultorio sin web que llega del formulario o del link", () => {
    expect(normalizeManualClinic({ nombre: "  Consultorio   Arroyo ", direccion: "Córdoba 3380", especialidad: 5 })).toEqual({
      nombre: "Consultorio Arroyo",
      direccion: "Córdoba 3380",
      especialidad: null,
    });
    expect(normalizeManualClinic({ nombre: "ab" })).toBeNull();
    expect(normalizeManualClinic({ nombre: "https://miclinica.com.ar" })).toBeNull();
    expect(normalizeManualClinic({ nombre: "x".repeat(121) })).toBeNull();
  });
});
