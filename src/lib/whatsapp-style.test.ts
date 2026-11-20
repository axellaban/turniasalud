import { describe, expect, it } from "vitest";
import { confirmationBubbles, splitBubbles, toWhatsAppText, typingMs, withArticle } from "./whatsapp-style";

describe("texto de Sofi para WhatsApp", () => {
  it("saca las negritas, en Markdown o en el formato de WhatsApp", () => {
    expect(toWhatsAppText("Su turno es el **miércoles 2/12 a las 12:00** con el *Dr. Mininni*.")).toBe(
      "Su turno es el miércoles 2/12 a las 12:00 con el Dr. Mininni.",
    );
    expect(toWhatsAppText("*Radiografías:* tráigalas si las tiene. __Importante__")).toBe("Radiografías: tráigalas si las tiene. Importante");
  });

  it("saca los signos de apertura, que nadie escribe en el celular", () => {
    expect(toWhatsAppText("¡Hola, María! ¿Le sirve el martes?")).toBe("Hola, María! Le sirve el martes?");
  });

  it("no toca un asterisco suelto ni los links, y las viñetas quedan con guion", () => {
    expect(toWhatsAppText("Son 2 * 3 sesiones")).toBe("Son 2 * 3 sesiones");
    expect(toWhatsAppText("[Mapa](https://maps.app.goo.gl/x_y)\n* Traer DNI\n• Llegar 10 min antes")).toBe(
      "Mapa: https://maps.app.goo.gl/x_y\n- Traer DNI\n- Llegar 10 min antes",
    );
  });

  it("cada párrafo es una burbuja, hasta tres; lo que sobra va en la última", () => {
    expect(splitBubbles("Listo, quedó confirmado.\n\n📍 San Martín 357\n\nTe esperamos")).toEqual([
      "Listo, quedó confirmado.",
      "📍 San Martín 357",
      "Te esperamos",
    ]);
    expect(splitBubbles("Uno\n\nDos\n\nTres\n\nCuatro")).toEqual(["Uno", "Dos", "Tres\n\nCuatro"]);
    expect(splitBubbles("Una línea\nY otra en la misma burbuja")).toEqual(["Una línea\nY otra en la misma burbuja"]);
    expect(splitBubbles("Uno\n\nDos\n\nTres\n\nCuatro", 4)).toHaveLength(4);
  });

  it("escribe más tiempo una burbuja larga, con un tope", () => {
    expect(typingMs("Ok")).toBe(800);
    expect(typingMs("x".repeat(50))).toBe(1400);
    expect(typingMs("x".repeat(500))).toBe(2500);
  });
});

describe("confirmación de un turno verificado en Smile Connect", () => {
  it("en burbujas cortas, sin «tu» ni «su», con la dirección y el cierre", () => {
    expect(confirmationBubbles({
      startsAt: new Date("2026-12-03T13:00:00Z"),
      timeZone: "America/Argentina/Buenos_Aires",
      professional: "Dr. Mininni",
      typeName: "Consulta de implantes",
      address: "Av. Colón 1234, Mar del Plata",
      instructions: null,
    })).toEqual([
      "Listo, quedó confirmado el turno de consulta de implantes para el jueves 3/12 a las 10:00 con el Dr. Mininni.",
      "📍 Av. Colón 1234, Mar del Plata",
      "Nos vemos el jueves 🙂",
    ]);
  });

  it("el artículo del profesional", () => {
    expect(withArticle("Dra. Ruiz")).toBe("la Dra. Ruiz");
    expect(withArticle("Dr Guerra")).toBe("el Dr Guerra");
    expect(withArticle("Mariana López")).toBe("Mariana López");
  });
});
