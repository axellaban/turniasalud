import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CierreDemo } from "./axel";

describe("CierreDemo", () => {
  it("es una sola frase concreta, con su nombre y el de la agente", () => {
    const html = renderToStaticMarkup(createElement(CierreDemo, { consultorio: "Consultorio de Marcela Pescatori", saludo: "Marcela", codigo: "pescatori-e2ex4" }));
    expect(html).toContain("Marcela, escribime y en 15 minutos probamos a Sofi con los horarios, tratamientos y obras sociales de tu centro.");
    expect(html).toContain('data-cta="talk_axel"');
    // Sin nombre, arranca directo.
    expect(renderToStaticMarkup(createElement(CierreDemo, { consultorio: "Clínica X", agente: "Ana" }))).toContain("Escribime y en 15 minutos probamos a Ana con");
  });
});
