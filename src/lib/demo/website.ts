// Validación de la web que deja el interesado. Pura: la usan la landing
// (navegador) y el servidor.

/** Normaliza lo que escribió la persona ("miclinica.com.ar", "https://…/") a una URL. Null si no es una web pública. */
export function normalizeWebsite(input: string | null | undefined): string | null {
  let value = (input ?? "").trim().replace(/[)\].,;!?¡¿"'»]+$/, "");
  if (!value || /\s/.test(value)) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  // Exige un dominio con extensión de letras: deja afuera IPs y nombres de red interna.
  if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host)) return null;
  if (/(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host)) return null;
  if (url.port && url.port !== "80" && url.port !== "443") return null;
  url.hash = "";
  return url.toString();
}

/** Consultorio sin web: la demo se arma con su nombre (y, si vienen en el link, dirección y especialidad). */
export type ManualClinic = { nombre: string; direccion: string | null; especialidad: string | null };

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean && clean.length <= max ? clean : null;
};

/** Valida lo que llega del formulario o del link. Null si no hay un nombre usable. Pura. */
export function normalizeManualClinic(input: { nombre?: unknown; direccion?: unknown; especialidad?: unknown }): ManualClinic | null {
  const nombre = text(input.nombre, 120);
  // Un nombre de verdad tiene letras; una dirección web no es un nombre.
  if (!nombre || nombre.length < 3 || !/\p{L}{2}/u.test(nombre) || /https?:\/\/|www\./i.test(nombre)) return null;
  return { nombre, direccion: text(input.direccion, 200), especialidad: text(input.especialidad, 80) };
}
