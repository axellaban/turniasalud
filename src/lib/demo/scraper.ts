import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { normalizeWebsite } from "./website";

export { normalizeWebsite };

// Lee la web de un consultorio para la demo del lead magnet: arranca en la
// home, sigue los links del mismo sitio (primero contacto, profesionales,
// especialidades, coberturas…) y devuelve el texto de cada página.
// Cualquiera puede pegar una URL, así que no se visitan direcciones internas.

export const MAX_PAGES = 20;
const PAGE_TIMEOUT_MS = 8000;
const TOTAL_BUDGET_MS = 35000;
const MAX_HTML_BYTES = 2_000_000;
const MAX_REDIRECTS = 4;
/** Tope de texto por página, para que una sola página enorme no tape a las demás. */
const MAX_PAGE_CHARS = 12_000;
const CONCURRENCY = 4;
/** Tope de texto que se le pasa al modelo (≈ 25.000 tokens). */
export const MAX_TEXT_CHARS = 90_000;

export type ScrapedPage = { url: string; title: string; text: string };
export type ScrapeResult = { url: string; pages: ScrapedPage[]; text: string };
export type Resolver = (hostname: string) => Promise<string[]>;

export class ScrapeError extends Error {}

/** Direcciones que no son internet pública (red local, loopback, metadata de la nube…). */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x);
  }
  return true;
}

const defaultResolver: Resolver = async (hostname) => (await lookup(hostname, { all: true })).map((r) => r.address);

async function assertPublic(url: URL, resolve: Resolver): Promise<void> {
  if (!normalizeWebsite(url.toString())) throw new ScrapeError(`Dirección no permitida: ${url.hostname}`);
  const addresses = await resolve(url.hostname).catch(() => []);
  if (!addresses.length) throw new ScrapeError(`No existe el dominio ${url.hostname}`);
  if (addresses.some(isPrivateAddress)) throw new ScrapeError(`Dirección no permitida: ${url.hostname}`);
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", aacute: "á", eacute: "é", iacute: "í", oacute: "ó",
  uacute: "ú", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", ntilde: "ñ", Ntilde: "Ñ", uuml: "ü",
  Uuml: "Ü", iexcl: "¡", iquest: "¿", ordm: "º", ordf: "ª", deg: "°", middot: "·", ndash: "–", mdash: "—", hellip: "…",
  laquo: "«", raquo: "»", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", bull: "•", copy: "©", reg: "®",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code] ?? m;
  });
}

/** Texto legible, título y links de una página. Puro. Conserva los datos estructurados (JSON-LD) y los tel:/mailto:. */
export function htmlToText(html: string): { title: string; text: string; links: string[] } {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const extras: string[] = [];
  const siteName = /<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1];
  if (siteName?.trim()) extras.push(`Nombre del sitio: ${decodeEntities(siteName.trim())}`);
  const description = /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1];
  if (description) extras.push(decodeEntities(description));
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = m[1].trim();
    if (raw && raw.length < 20_000) extras.push(`Datos estructurados: ${raw.replace(/\s+/g, " ")}`);
  }

  const links: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#][^"']*)["'][^>]*>/gi)) {
    const href = decodeEntities(m[1].trim());
    if (/^tel:/i.test(href)) extras.push(`Teléfono: ${decodeURIComponent(href.slice(4)).trim()}`);
    else if (/^mailto:/i.test(href)) extras.push(`Email: ${href.slice(7).split("?")[0]}`);
    else if (/^https?:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(href)) extras.push(`WhatsApp: ${href}`);
    else links.push(href);
  }

  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|h[1-6]|tr|section|article|header|footer|nav|main|aside|ul|ol|table|dd|dt|address|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<(td|th)\b[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ");
  const lines = decodeEntities(body)
    .split("\n")
    .map((l) => l.replace(/[ \t |]+/g, " ").replace(/^\s*\|?\s*|\s*\|?\s*$/g, "").trim())
    .filter(Boolean);
  return { title, text: [...extras, ...lines].join("\n"), links: [...new Set(links)] };
}

const PRIORITY = [
  /contact/, /turno/, /profesional/, /equipo/, /staff/, /medic/, /doctor/, /dra?[-_.]/, /especialidad/, /servicio/,
  /tratamiento/, /prestacion/, /practica/, /obras?[-_]?social/, /cobertura/, /prepaga/, /convenio/, /nosotros/,
  /quienes/, /horario/, /sede/, /ubicacion/, /donde/, /precio/, /arancel/, /faq/, /pregunta/, /estudio/, /paciente/,
];
/** Secciones que no ayudan a atender pacientes: van al final de la cola. */
const LOW_VALUE = /\/(blog|novedades|noticias|news|prensa|eventos?|cursos?|docencia|investigacion|alumni|donar|donacion|donaciones|trabaj|empleo|rrhh|carrera|beneficios|extranet|intranet|portal|autogestion|category|categoria|20\d\d)/;
const SKIP = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|rar|mp4|mp3|webm|docx?|xlsx?|pptx?|css|js|xml|json)(\?|$)|\/(wp-(admin|json|login)|feed|cart|carrito|checkout|login|tag|author)\b/i;

/** Links internos que vale la pena leer, los más útiles primero. Puro. */
export function rankLinks(base: URL, hrefs: string[]): string[] {
  const site = base.hostname.replace(/^www\./, "");
  const out = new Map<string, number>();
  for (const href of hrefs) {
    if (/^(javascript|data|mailto|tel|whatsapp):/i.test(href)) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.hostname.replace(/^www\./, "") !== site) continue;
    if (SKIP.test(url.pathname)) continue;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/.test(key)) url.searchParams.delete(key);
    const path = decodeURIComponent(url.pathname).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    let score = path.split("/").filter(Boolean).length * 2 + (url.search ? 3 : 0);
    if (PRIORITY.some((re) => re.test(path))) score -= 10;
    if (LOW_VALUE.test(path)) score += 12;
    const key = url.toString();
    out.set(key, Math.min(out.get(key) ?? Infinity, score));
  }
  return [...out.entries()].sort((a, b) => a[1] - b[1]).map(([u]) => u);
}

/** Destino de un <meta http-equiv="refresh"> en una página casi vacía (si no, null). Puro. */
export function metaRefreshTarget(html: string): string | null {
  const tag = /<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/i.exec(html)?.[0];
  if (!tag) return null;
  const target = /content=["']?\s*\d*\s*;?\s*url\s*=\s*['"]?([^"'>\s]+)/i.exec(tag)?.[1];
  if (!target) return null;
  // Solo si la página no tiene contenido propio (si no, es un refresco de la misma página).
  return htmlToText(html).text.length < 300 ? decodeEntities(target) : null;
}

/** fetch con control de cada redirección (no puede saltar a una IP interna). */
async function fetchPage(start: string, resolve: Resolver): Promise<{ url: string; html: string } | null> {
  let url = new URL(start);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url, resolve);
    const res = await fetch(url, {
      redirect: "manual",
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TurniaDemoBot/1.0; +https://turniasalud.vercel.app/probar-demo)",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "es-AR,es;q=0.9",
      },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) return null;
    if (!/html/i.test(res.headers.get("content-type") ?? "text/html")) return null;
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_HTML_BYTES) return null;
    const html = (await res.text()).slice(0, MAX_HTML_BYTES);
    // Algunas webs viejas redirigen con <meta http-equiv="refresh" content="0;url=…">.
    const refresh = metaRefreshTarget(html);
    if (refresh) {
      url = new URL(refresh, url);
      continue;
    }
    return { url: url.toString(), html };
  }
  return null;
}

/**
 * Recorre el sitio (hasta MAX_PAGES páginas o TOTAL_BUDGET_MS) y junta el
 * texto sin repetir encabezados ni pies de página. Falla si no se pudo leer la home.
 */
export async function scrapeSite(website: string, opts: { resolve?: Resolver; maxPages?: number } = {}): Promise<ScrapeResult> {
  const start = normalizeWebsite(website);
  if (!start) throw new ScrapeError("La dirección no parece una web.");
  const resolve = opts.resolve ?? defaultResolver;
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  const home = await fetchPage(start, resolve).catch((e) => {
    if (e instanceof ScrapeError) throw e;
    throw new ScrapeError(`No pudimos abrir ${new URL(start).hostname}.`);
  });
  if (!home) throw new ScrapeError(`No pudimos abrir ${new URL(start).hostname}.`);
  const base = new URL(home.url);
  const site = base.hostname.replace(/^www\./, "");

  const pages: ScrapedPage[] = [];
  const visited = new Set<string>([start, home.url]);
  const seenLines = new Set<string>();
  let queue: string[] = [];

  const add = (url: string, html: string) => {
    const parsed = htmlToText(html);
    // Menús, encabezados y pies se repiten en todas las páginas: van una sola vez.
    const fresh = parsed.text.split("\n").filter((l) => {
      const key = l.toLowerCase();
      if (seenLines.has(key)) return false;
      seenLines.add(key);
      return true;
    });
    if (fresh.length) pages.push({ url, title: parsed.title, text: fresh.join("\n").slice(0, MAX_PAGE_CHARS) });
    queue = rankLinks(base, [...queue, ...parsed.links]).filter((u) => !visited.has(u));
  };
  add(home.url, home.html);

  while (queue.length && pages.length < maxPages && Date.now() < deadline) {
    const batch = queue.splice(0, Math.min(CONCURRENCY, maxPages - pages.length));
    batch.forEach((u) => visited.add(u));
    const results = await Promise.all(batch.map((u) => fetchPage(u, resolve).catch(() => null)));
    for (const r of results) {
      if (!r || (visited.has(r.url) && !batch.includes(r.url))) continue;
      // Un link interno que redirige a otro sitio (subdominios de docencia, portales) no cuenta.
      if (new URL(r.url).hostname.replace(/^www\./, "") !== site) continue;
      visited.add(r.url);
      add(r.url, r.html);
    }
  }

  let text = "";
  for (const p of pages) {
    const block = `### ${p.title || p.url}\nURL: ${p.url}\n${p.text}\n\n`;
    if (text.length + block.length > MAX_TEXT_CHARS) {
      text += block.slice(0, Math.max(0, MAX_TEXT_CHARS - text.length));
      break;
    }
    text += block;
  }
  return { url: base.toString(), pages, text: text.trim() };
}
