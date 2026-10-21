import { afterEach, describe, expect, it, vi } from "vitest";
import { htmlToText, isPrivateAddress, rankLinks, scrapeSite, ScrapeError } from "./scraper";

describe("htmlToText", () => {
  it("saca el texto, los teléfonos, los mails y los datos estructurados, sin scripts ni estilos", () => {
    const html = `<html><head><title>Odonto Sur &amp; Asociados | Inicio</title>
      <meta name="description" content="Clínica odontológica en Banfield">
      <style>.x{color:red}</style>
      <script type="application/ld+json">{"@type":"Dentist","address":{"streetAddress":"Av. Alsina 123"}}</script>
      <script>var secreto = 1;</script></head>
      <body><nav><a href="/equipo">Equipo</a> <a href="tel:+54 11 4242-0000">Llamanos</a> <a href="mailto:hola@odontosur.com.ar?subject=x">Mail</a></nav>
      <h1>Bienvenidos</h1><p>Atendemos OSDE y Swiss&nbsp;Medical.</p><ul><li>Implantes</li><li>Ortodoncia</li></ul>
      <a href="https://wa.me/5491142420000">WhatsApp</a></body></html>`;
    const { title, text, links } = htmlToText(html);
    expect(title).toBe("Odonto Sur & Asociados | Inicio");
    expect(text).toContain("Clínica odontológica en Banfield");
    expect(text).toContain('"streetAddress":"Av. Alsina 123"');
    expect(text).toContain("Teléfono: +54 11 4242-0000");
    expect(text).toContain("Email: hola@odontosur.com.ar");
    expect(text).toContain("WhatsApp: https://wa.me/5491142420000");
    expect(text).toContain("Atendemos OSDE y Swiss Medical.");
    expect(text.split("\n")).toContain("Implantes");
    expect(text).not.toContain("secreto");
    expect(text).not.toContain("color:red");
    expect(links).toEqual(["/equipo"]);
  });
});

describe("rankLinks", () => {
  it("se queda con el mismo sitio, sin archivos, y lee primero lo útil para dar turnos", () => {
    const base = new URL("https://www.odontosur.com.ar/");
    const ranked = rankLinks(base, [
      "/blog/2024/consejos", "/contacto", "https://odontosur.com.ar/profesionales", "https://otro.com/x", "/folleto.pdf",
      "/contacto#mapa", "/servicios/implantes?utm_source=ig", "mailto:x@y.com", "/wp-admin/", "/a/b/c/d",
    ]);
    expect(ranked).toEqual([
      "https://www.odontosur.com.ar/contacto",
      "https://odontosur.com.ar/profesionales",
      "https://www.odontosur.com.ar/servicios/implantes",
      "https://www.odontosur.com.ar/a/b/c/d",
      "https://www.odontosur.com.ar/blog/2024/consejos",
    ]);
  });
});

describe("isPrivateAddress", () => {
  it("bloquea redes internas y deja pasar internet", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "200.45.1.10", "2800:3f0:4002:80b::200e"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe("scrapeSite", () => {
  afterEach(() => vi.unstubAllGlobals());
  const page = (body: string, title = "Clínica") => new Response(`<html><head><title>${title}</title></head><body>${body}</body></html>`, { headers: { "content-type": "text/html" } });
  const publicDns = async () => ["200.45.1.10"];

  it("recorre el sitio, no repite el pie de página y no sale del dominio", async () => {
    const pages: Record<string, Response | (() => Response)> = {
      "https://clinica.com/": () => page(`<a href="/contacto">Contacto</a><a href="https://otro.com/">otro</a><footer>Av. Siempreviva 742</footer>`, "Clínica Sur"),
      "https://clinica.com/contacto": () => page(`<p>Turnos al 4242-0000</p><a href="/equipo">Equipo</a><footer>Av. Siempreviva 742</footer>`, "Contacto"),
      "https://clinica.com/equipo": () => page(`<p>Dra. Ana Pérez, odontóloga</p><footer>Av. Siempreviva 742</footer>`, "Equipo"),
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const res = pages[url];
      if (!res) throw new Error(`fetch inesperado ${url}`);
      return typeof res === "function" ? res() : res;
    });
    vi.stubGlobal("fetch", fetchMock);
    const site = await scrapeSite("clinica.com", { resolve: publicDns });
    expect(site.pages.map((p) => p.url)).toEqual(["https://clinica.com/", "https://clinica.com/contacto", "https://clinica.com/equipo"]);
    expect(site.text.match(/Siempreviva/g)).toHaveLength(1);
    expect(site.text).toContain("Dra. Ana Pérez");
    expect(fetchMock.mock.calls.map(([u]) => String(u))).not.toContain("https://otro.com/");
  });

  it("no sigue redirecciones ni dominios que apuntan a la red interna", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://intranet.empresa.com/" } })));
    const dns = async (host: string) => (host === "intranet.empresa.com" ? ["10.0.0.8"] : ["200.45.1.10"]);
    await expect(scrapeSite("https://clinica.com", { resolve: dns })).rejects.toBeInstanceOf(ScrapeError);
    await expect(scrapeSite("https://interno.com", { resolve: async () => ["127.0.0.1"] })).rejects.toThrow(/no permitida/);
    await expect(scrapeSite("https://no-existe.com", { resolve: async () => [] })).rejects.toThrow(/No existe/);
  });
});
