import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { htmlToText, isPrivateAddress, metaRefreshTarget, rankLinks, scrapeSite, ScrapeError } from "./scraper";

const transport = vi.hoisted(() => ({ lookups: [] as import("node:net").LookupFunction[] }));
vi.mock("undici", async (importOriginal) => {
  const original = await importOriginal<typeof import("undici")>();
  return { ...original, Agent: class extends original.Agent {
    constructor(options: ConstructorParameters<typeof original.Agent>[0]) {
      super(options);
      if (options?.connect && typeof options.connect === "object" && "lookup" in options.connect && options.connect.lookup) transport.lookups.push(options.connect.lookup);
    }
  } };
});

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
  it("tolera teléfonos con escapes incompletos", () => {
    expect(htmlToText('<a href="tel:+54%">Llamar</a>').text).toContain("Teléfono: +54%");
  });
});

describe("metaRefreshTarget", () => {
  it("sigue las redirecciones viejas con meta refresh solo si la página está vacía", () => {
    expect(metaRefreshTarget(`<html><head><meta http-equiv="Refresh" content="0;url=http://www.sg.com.ar"></head><body></body></html>`)).toBe("http://www.sg.com.ar");
    expect(metaRefreshTarget(`<meta http-equiv="refresh" content="300"><p>${"Contenido real ".repeat(40)}</p>`)).toBeNull();
    expect(metaRefreshTarget("<p>Hola</p>")).toBeNull();
  });
});

describe("rankLinks", () => {
  it("un link con escapes mal formados no aborta la lectura del sitio", () => {
    expect(rankLinks(new URL("https://clinica.com/"), ["/contacto%", "/equipo"]).length).toBe(2);
  });
  it("se queda con el mismo sitio, sin archivos, y lee primero lo útil para dar turnos", () => {
    const base = new URL("https://www.odontosur.com.ar/");
    const ranked = rankLinks(base, [
      "/blog/2024/consejos", "/contacto", "https://odontosur.com.ar/profesionales", "https://otro.com/x", "/folleto.pdf",
      "/contacto#mapa", "/servicios/implantes?utm_source=ig", "mailto:x@y.com", "/wp-admin/", "/a/b/c/d", "/institucional/donar",
    ]);
    expect(ranked).toEqual([
      "https://www.odontosur.com.ar/contacto",
      "https://odontosur.com.ar/profesionales",
      "https://www.odontosur.com.ar/servicios/implantes",
      "https://www.odontosur.com.ar/a/b/c/d",
      "https://www.odontosur.com.ar/institucional/donar",
      "https://www.odontosur.com.ar/blog/2024/consejos",
    ]);
  });
});

describe("isPrivateAddress", () => {
  it("bloquea redes internas y deja pasar internet", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1", "192.0.2.1", "198.51.100.2", "203.0.113.1", "2001:db8::1", "2002:7f00:1::", "64:ff9b::7f00:1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "200.45.1.10", "2800:3f0:4002:80b::200e"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe("scrapeSite", () => {
  beforeEach(() => { transport.lookups = []; });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });
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

  it("sigue la redirección de la home a otro dominio, pero no la de una página interna", async () => {
    const pages: Record<string, () => Response> = {
      "https://viejo.com.ar/": () => page(`</head><meta http-equiv="refresh" content="0;url=https://nuevo.com.ar/">`),
      "https://nuevo.com.ar/": () => page(`<a href="/alumnos">Alumnos</a><a href="/turnos">Turnos</a><p>Sanatorio Nuevo</p>`, "Sanatorio Nuevo"),
      "https://nuevo.com.ar/alumnos": () => new Response(null, { status: 301, headers: { location: "https://campus.otro.com/" } }),
      "https://campus.otro.com/": () => page("<p>Campus virtual</p>"),
      "https://nuevo.com.ar/turnos": () => page("<p>Pedí tu turno al 4000-0000</p>"),
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => pages[String(input)]?.() ?? new Response("", { status: 404 })));
    const site = await scrapeSite("viejo.com.ar", { resolve: publicDns });
    expect(site.url).toBe("https://nuevo.com.ar/");
    expect(site.pages.map((p) => p.url)).toEqual(["https://nuevo.com.ar/", "https://nuevo.com.ar/turnos"]);
    expect(site.text).not.toContain("Campus virtual");
  });

  it("no sigue redirecciones ni dominios que apuntan a la red interna", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://intranet.empresa.com/" } })));
    const dns = async (host: string) => (host === "intranet.empresa.com" ? ["10.0.0.8"] : ["200.45.1.10"]);
    await expect(scrapeSite("https://clinica.com", { resolve: dns })).rejects.toBeInstanceOf(ScrapeError);
    await expect(scrapeSite("https://interno.com", { resolve: async () => ["127.0.0.1"] })).rejects.toThrow(/no permitida/);
    await expect(scrapeSite("https://no-existe.com", { resolve: async () => [] })).rejects.toThrow(/No existe/);
  });
  it("conecta a la IP pública validada sin volver a consultar un DNS que cambió", async () => {
    const dns = vi.fn().mockResolvedValueOnce(["200.45.1.10"]).mockResolvedValue(["127.0.0.1"]);
    vi.stubGlobal("fetch", vi.fn(async () => {
      const result = await new Promise((resolve) => {
        transport.lookups.at(-1)!("clinica.com", { all: true }, (error, addresses) => resolve({ error, addresses }));
      });
      expect(result).toEqual({ error: null, addresses: [{ address: "200.45.1.10", family: 4 }] });
      return page("Consultorio");
    }));
    await scrapeSite("clinica.com", { resolve: dns });
    expect(dns).toHaveBeenCalledOnce();
  });

  it("corta un HTML sin Content-Length al superar el límite de bytes", async () => {
    const cancel = vi.fn();
    let chunks = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { chunks++; controller.enqueue(new Uint8Array(700_000)); },
      cancel,
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "content-type": "text/html" } })));
    await expect(scrapeSite("clinica.com", { resolve: publicDns })).rejects.toBeInstanceOf(ScrapeError);
    expect(cancel).toHaveBeenCalledOnce();
    expect(chunks).toBeLessThanOrEqual(4);
  });

  it("el plazo incluye un DNS que nunca responde", async () => {
    vi.useFakeTimers();
    // AbortSignal.timeout usa el reloj nativo de Node, fuera de los fake timers.
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), ms);
      return controller.signal;
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = expect(scrapeSite("clinica.com", { resolve: () => new Promise(() => {}) })).rejects.toBeInstanceOf(ScrapeError);
    await vi.advanceTimersByTimeAsync(8001);
    await result;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("las redirecciones comparten el plazo de la página en lugar de reiniciarlo", async () => {
    vi.useFakeTimers();
    // AbortSignal.timeout usa el reloj nativo de Node, fuera de los fake timers.
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), ms);
      return controller.signal;
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return new Response(null, { status: 302, headers: { location: "https://clinica.com/otra" } });
    }));
    const result = expect(scrapeSite("clinica.com", { resolve: publicDns })).rejects.toBeInstanceOf(ScrapeError);
    await vi.advanceTimersByTimeAsync(8001);
    await result;
  });

});
