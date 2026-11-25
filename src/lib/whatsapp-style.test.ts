import { describe, expect, it } from "vitest";
import { confirmationBubbles, splitBubbles, toWhatsAppText, typingMs, withArticle, withoutFormulas } from "./whatsapp-style";

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

  it("saca las fórmulas de cierre del final y el «Con gusto» del principio (casos reales)", () => {
    expect(toWhatsAppText("De nada, María. ¡Que tenga un lindo día!")).toBe("De nada, María.");
    expect(toWhatsAppText("Le confirmo el turno del jueves 3/12.\n\n¿Necesita algo más?")).toBe("Le confirmo el turno del jueves 3/12.");
    expect(toWhatsAppText("Perfecto, Franco. Tráigalas el día de la consulta. ¿Necesita algo más?")).toBe("Perfecto, Franco. Tráigalas el día de la consulta.");
    expect(toWhatsAppText("De nada, María. Cuando pueda, cuénteme si tiene radiografías. ¡Hasta pronto!")).toBe("De nada, María. Cuando pueda, cuénteme si tiene radiografías.");
    expect(toWhatsAppText("Su pedido quedó registrado. ¿Tiene alguna otra consulta?")).toBe("Su pedido quedó registrado.");
    expect(toWhatsAppText("Con gusto le busco un turno. Qué necesita hacerse?")).toBe("Le busco un turno. Qué necesita hacerse?");
    expect(toWhatsAppText("Con gusto. Para no equivocarme: es para la lista de espera?")).toBe("Para no equivocarme: es para la lista de espera?");
    expect(toWhatsAppText("Quedó anotada. Quedamos a disposición.")).toBe("Quedó anotada.");
    expect(toWhatsAppText("Sí, con gusto. Para no quedarse sin lugar, le reservo uno de esos turnos.")).toBe("Sí. Para no quedarse sin lugar, le reservo uno de esos turnos.");
  });

  it("no toca una fórmula que es todo el mensaje ni la que está dentro de otra frase", () => {
    expect(withoutFormulas("Que tenga un buen día!")).toBe("Que tenga un buen día!");
    expect(withoutFormulas("Con gusto!")).toBe("Con gusto!");
    expect(withoutFormulas("Si necesita algo más, me escribe por acá.")).toBe("Si necesita algo más, me escribe por acá.");
    expect(withoutFormulas("De nada, nos vemos el martes 🙂")).toBe("De nada, nos vemos el martes 🙂");
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
