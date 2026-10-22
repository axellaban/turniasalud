import { describe, expect, it } from "vitest";
import { demoRequestText, findWebsite, parseCommand, parseDemoRequest, parseModeChoice } from "./flow";
import { normalizeWebsite } from "./website";

describe("normalizeWebsite", () => {
  it("acepta lo que escribe la gente y lo deja como URL", () => {
    expect(normalizeWebsite("miclinica.com.ar")).toBe("https://miclinica.com.ar/");
    expect(normalizeWebsite(" https://www.Odonto-Sur.com/turnos#x ")).toBe("https://www.odonto-sur.com/turnos");
    expect(normalizeWebsite("http://consultorio.ar/.")).toBe("http://consultorio.ar/");
  });

  it("rechaza direcciones que no son una web pública", () => {
    for (const bad of ["", "hola", "localhost", "http://127.0.0.1", "http://10.0.0.5/admin", "https://[::1]/", "intranet.local",
      "https://user:pass@clinica.com", "https://clinica.com:8080", "ftp://clinica.com", "file:///etc/passwd", "mi clinica.com"]) {
      expect(normalizeWebsite(bad), bad).toBeNull();
    }
  });
});

describe("pedido de demo por WhatsApp", () => {
  it("reconoce el mensaje que arma la landing", () => {
    expect(parseDemoRequest(demoRequestText("https://miclinica.com.ar/"))).toEqual({ website: "https://miclinica.com.ar/" });
  });

  it("reconoce variantes escritas a mano y no confunde emails con webs", () => {
    expect(parseDemoRequest("Hola! quiero probar Turnia, mi web es www.dentalpalermo.com.ar")).toEqual({ website: "https://www.dentalpalermo.com.ar/" });
    expect(parseDemoRequest("¿Hacen la prueba de covid? Lo vi en www.otraclinica.com")).toBeNull();
    expect(parseDemoRequest("Demo porfa: info@clinica.com, la web es clinica.com/inicio")).toEqual({ website: "https://clinica.com/inicio" });
    expect(findWebsite("escribime a turnos@clinica.com")).toBeNull();
    expect(parseDemoRequest("hola, quiero un turno")).toBeNull();
    expect(parseDemoRequest("quiero probar la demo")).toBeNull();
    expect(parseDemoRequest("vi la demo en clinica.com")).toEqual({ website: "https://clinica.com/" });
  });

  it("entiende la opción elegida por número o por palabra", () => {
    expect(parseModeChoice("1")).toBe("llamada");
    expect(parseModeChoice("2️⃣")).toBe("audio");
    expect(parseModeChoice("3.")).toBe("chat");
    expect(parseModeChoice("la opción 2")).toBeNull();
    expect(parseModeChoice("opcion 2")).toBe("audio");
    expect(parseModeChoice("Llamada de voz")).toBe("llamada");
    expect(parseModeChoice("prefiero que me llamen")).toBe("llamada");
    expect(parseModeChoice("nota de voz")).toBe("audio");
    expect(parseModeChoice("audios de whatsapp")).toBe("audio");
    expect(parseModeChoice("*Chat*")).toBe("chat");
    expect(parseModeChoice("hola")).toBeNull();
    expect(parseModeChoice("")).toBeNull();
  });

  it("entiende MENU y SALIR sin pisar mensajes comunes", () => {
    expect(parseCommand("MENU")).toBe("menu");
    expect(parseCommand("Menú")).toBe("menu");
    expect(parseCommand("salir")).toBe("salir");
    expect(parseCommand("Terminar.")).toBe("salir");
    expect(parseCommand("quiero salir el martes")).toBeNull();
  });
});
