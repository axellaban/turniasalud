// Lectura de la lista de odontólogos (CSV o celdas pegadas) para la prospección. Pura: la usan
// la vista previa del navegador y la importación del servidor.

import { parseTable } from "@/lib/patient-import";
import { normalizeInstagram, outreachPhone } from "./outreach-messages";

export type OutreachImportRow = {
  line: number;
  code: string | null;
  name: string;
  greeting: string;
  title: string;
  business_name: string;
  zone: string;
  address: string;
  specialty: string;
  phone: string | null;
  phone_kind: "movil" | "fijo" | null;
  instagram: string | null;
  email: string | null;
  website: string | null;
  priority: number;
  signals: string;
  source: string;
  notes: string;
};

export type OutreachImportPreview = { rows: OutreachImportRow[]; problems: Array<{ line: number; reason: string }>; total: number };

export const MAX_OUTREACH_ROWS = 3000;

const key = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Encabezados que reconoce, con sus variantes más comunes.
const HEADERS: Record<string, keyof OutreachImportRow | "otros_telefonos" | "doctoralia"> = {
  codigo: "code",
  nombre: "name",
  "nombre completo": "name",
  profesional: "name",
  odontologo: "name",
  saludo: "greeting",
  "nombre de pila": "greeting",
  tratamiento: "title",
  titulo: "title",
  consultorio: "business_name",
  clinica: "business_name",
  centro: "business_name",
  zona: "zone",
  ciudad: "zone",
  localidad: "zone",
  direccion: "address",
  domicilio: "address",
  especialidad: "specialty",
  telefono: "phone",
  celular: "phone",
  whatsapp: "phone",
  "tipo telefono": "phone_kind",
  "tipo de telefono": "phone_kind",
  "otros telefonos": "otros_telefonos",
  instagram: "instagram",
  email: "email",
  mail: "email",
  "correo electronico": "email",
  web: "website",
  "sitio web": "website",
  pagina: "website",
  prioridad: "priority",
  senales: "signals",
  fuente: "source",
  notas: "notes",
  doctoralia: "doctoralia",
};

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

function website(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return /\./.test(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseOutreachImport(text: string): OutreachImportPreview {
  const table = parseTable(text);
  const columns: Array<string | null> = table.headers.map((h) => HEADERS[key(h)] ?? null);
  const problems: OutreachImportPreview["problems"] = [];
  const rows: OutreachImportRow[] = [];
  if (!columns.includes("name")) {
    return { rows, problems: [{ line: 1, reason: "Falta la columna «nombre»." }], total: table.rows.length };
  }
  table.rows.slice(0, MAX_OUTREACH_ROWS).forEach((cells, index) => {
    const line = index + 2;
    const get = (field: string) => {
      const i = columns.indexOf(field);
      return i >= 0 ? (cells[i] ?? "").trim() : "";
    };
    const name = get("name").replace(/\s+/g, " ");
    if (!name) return void problems.push({ line, reason: "Sin nombre." });
    const kindRaw = key(get("phone_kind"));
    const kind = kindRaw.startsWith("movil") || kindRaw.startsWith("celular") ? "movil" : kindRaw.startsWith("fijo") ? "fijo" : null;
    const phone = outreachPhone(get("phone"), kind);
    if (get("phone") && !phone) problems.push({ line, reason: `Teléfono que no se pudo leer: ${get("phone")}. Se importa sin teléfono.` });
    const instagram = normalizeInstagram(get("instagram"));
    const email = EMAIL.test(get("email")) ? get("email").toLowerCase() : null;
    const priority = Number(get("priority"));
    const code = get("code").toLowerCase();
    const extraPhones = get("otros_telefonos");
    const doctoralia = get("doctoralia");
    const notes = [get("notes"), extraPhones && `Otros teléfonos: ${extraPhones}`, doctoralia && `Perfil de Doctoralia: ${doctoralia}`].filter(Boolean).join("\n");
    rows.push({
      line,
      code: /^[a-z0-9][a-z0-9-]{2,39}$/.test(code) ? code : null,
      name,
      greeting: get("greeting") || name.split(" ")[0],
      title: ["Dr.", "Dra."].includes(get("title")) ? get("title") : "",
      business_name: get("business_name"),
      zone: get("zone"),
      address: get("address"),
      specialty: get("specialty"),
      phone: phone?.phone ?? null,
      phone_kind: phone?.kind ?? null,
      instagram,
      email,
      website: website(get("website")),
      priority: priority >= 1 && priority <= 3 ? Math.round(priority) : 2,
      signals: get("signals"),
      source: get("source"),
      notes,
    });
  });
  if (table.rows.length > MAX_OUTREACH_ROWS) problems.push({ line: MAX_OUTREACH_ROWS + 2, reason: `Se leen las primeras ${MAX_OUTREACH_ROWS} filas.` });
  return { rows, problems, total: table.rows.length };
}
