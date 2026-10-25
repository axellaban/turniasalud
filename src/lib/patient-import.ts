import { normalizePhone } from "./phone";

// Importación de la base de pacientes que la clínica trae de su sistema anterior (AgendaPro,
// Dentalink, Medilink, una planilla…): un CSV exportado o celdas copiadas de Excel o Google Sheets.
// Corre igual en el navegador (vista previa) y en el servidor (lo que se guarda): el servidor vuelve
// a leer el texto original, nunca confía en la vista previa.
//
// Sirve tanto una fila por paciente como una fila por visita: las filas con el mismo celular se
// juntan en un paciente y cada fecha queda como una visita (alimenta el recall y la reactivación).

export const IMPORT_FIELDS = [
  "full_name",
  "first_name",
  "last_name",
  "phone",
  "dni",
  "email",
  "birth_date",
  "coverage",
  "coverage_plan",
  "member_number",
  "last_visit",
  "service",
  "professional",
  "next_control",
  "notes",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const FIELD_LABELS: Record<ImportField, string> = {
  full_name: "Nombre y apellido",
  first_name: "Nombre",
  last_name: "Apellido",
  phone: "Celular",
  dni: "DNI",
  email: "Email",
  birth_date: "Fecha de nacimiento",
  coverage: "Obra social / prepaga",
  coverage_plan: "Plan",
  member_number: "N° de afiliado",
  last_visit: "Fecha de la visita",
  service: "Prestación o tratamiento",
  professional: "Profesional",
  next_control: "Próximo control",
  notes: "Notas",
};

/** Encabezados habituales de cada dato, ya normalizados (minúsculas, sin tildes ni signos). */
const ALIASES: Record<ImportField, string[]> = {
  full_name: ["nombre y apellido", "apellido y nombre", "nombre completo", "paciente", "nombre del paciente", "apellido nombre", "nombre apellido", "cliente"],
  first_name: ["nombre", "nombres", "primer nombre"],
  last_name: ["apellido", "apellidos"],
  phone: ["celular", "telefono", "tel", "movil", "whatsapp", "telefono celular", "cel", "telefono movil", "numero de telefono", "contacto", "telefono 1"],
  dni: ["dni", "documento", "nro documento", "n documento", "numero de documento", "doc", "nro de documento"],
  email: ["email", "e mail", "mail", "correo", "correo electronico"],
  birth_date: ["fecha de nacimiento", "nacimiento", "f nacimiento", "fecha nac", "fecha nacimiento"],
  coverage: ["obra social", "cobertura", "prepaga", "os", "financiador", "obra social prepaga", "aseguradora"],
  coverage_plan: ["plan", "plan de cobertura"],
  member_number: ["afiliado", "n afiliado", "nro afiliado", "numero de afiliado", "credencial", "nro de afiliado"],
  last_visit: ["ultima visita", "fecha ultima visita", "ultimo turno", "fecha del ultimo turno", "ultima consulta", "ultima atencion", "fecha de atencion", "fecha visita", "fecha de la visita", "fecha del turno", "fecha turno", "fecha"],
  service: ["prestacion", "tratamiento", "servicio", "practica", "tipo de turno", "motivo", "ultimo tratamiento", "ultima prestacion", "consulta"],
  professional: ["profesional", "doctor", "doctora", "dr", "dra", "medico", "medica", "odontologo", "odontologa", "atendido por"],
  next_control: ["proximo control", "fecha proximo control", "proxima visita", "control", "volver", "recall", "proximo recall"],
  notes: ["notas", "observaciones", "comentarios", "obs"],
};

/** Encabezados demasiado genéricos para buscarlos dentro de otro ("Fecha de alta" no es una visita). */
const EXACT_ONLY = new Set(["fecha", "control", "consulta", "motivo", "contacto", "plan", "volver", "recall", "nombre", "cliente", "paciente"]);

export type ParsedTable = { headers: string[]; rows: string[][] };
export type ColumnMapping = Array<ImportField | null>;

export type ImportPatient = {
  phone: string;
  full_name: string | null;
  dni: string | null;
  email: string | null;
  birth_date: string | null;
  coverage: string | null;
  coverage_plan: string | null;
  member_number: string | null;
  notes: string | null;
  next_control_at: string | null;
  next_control_reason: string | null;
  visits: Array<{ visited_at: string; service: string; professional: string | null }>;
};

export type ImportProblem = { line: number; reason: string };
export type ImportPreview = { patients: ImportPatient[]; visits: number; problems: ImportProblem[]; rows: number };

export const MAX_IMPORT_ROWS = 20000;

const normalizeHeader = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Lee CSV (coma o punto y coma) o celdas pegadas de Excel (tabulaciones), con comillas. */
export function parseTable(text: string): ParsedTable {
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const firstLine = clean.split("\n").find((l) => l.trim()) ?? "";
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delimiter = count("\t") > 0 ? "\t" : count(";") > count(",") ? ";" : ",";

  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field.trim() === "") {
      quoted = true;
      field = "";
    } else if (ch === delimiter) {
      record.push(field.trim());
      field = "";
    } else if (ch === "\n") {
      record.push(field.trim());
      records.push(record);
      record = [];
      field = "";
    } else field += ch;
  }
  record.push(field.trim());
  records.push(record);
  const nonEmpty = records.filter((r) => r.some((c) => c !== ""));
  const [headers = [], ...rows] = nonEmpty;
  return { headers, rows };
}

/** Adivina qué dato trae cada columna por su encabezado. Cada dato se asigna a una sola columna. */
export function detectMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const mapping: ColumnMapping = headers.map(() => null);
  const used = new Set<ImportField>();
  const assign = (match: (header: string, alias: string) => boolean) => {
    for (const fieldName of IMPORT_FIELDS) {
      if (used.has(fieldName)) continue;
      const column = normalized.findIndex((h, i) => mapping[i] === null && h && ALIASES[fieldName].some((a) => match(h, a)));
      if (column >= 0) {
        mapping[column] = fieldName;
        used.add(fieldName);
      }
    }
  };
  // Primero los encabezados exactos; después los que contienen el nombre ("Teléfono celular del paciente").
  assign((h, a) => h === a);
  assign((h, a) => a.length >= 4 && !EXACT_ONLY.has(a) && (h.startsWith(`${a} `) || h.endsWith(` ${a}`) || h.includes(` ${a} `)));
  // "Nombre" solo es el nombre de pila si también hay una columna de apellido.
  const first = mapping.indexOf("first_name");
  if (first >= 0 && !mapping.includes("last_name") && !mapping.includes("full_name")) mapping[first] = "full_name";
  return mapping;
}

/** Fecha en los formatos habituales (31/12/2025, 31-12-25, 2025-12-31, número de serie de Excel) → AAAA-MM-DD. */
export function parseDate(raw: string | null | undefined, today = new Date()): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let y: number, m: number, d: number;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(value))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?!\d)/.exec(value))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    // Formato yanqui (12/31/2025): solo si el día no puede ser mes.
    if (m > 12 && d <= 12) [d, m] = [m, d];
    if (y < 100) y += y <= today.getUTCFullYear() % 100 ? 2000 : 1900;
  } else if (/^\d{5}$/.test(value)) {
    // Número de serie de Excel (días desde el 30/12/1899).
    const date = new Date(Date.UTC(1899, 11, 30) + Number(value) * 86400_000);
    [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (y < 1900 || y > today.getUTCFullYear() + 5) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * El primer número de la celda que sirve para WhatsApp ("11 5555-0001 / 4444-5555" → el celular).
 * Sin código de área (8 dígitos) no se puede saber de dónde es: no sirve.
 */
export function parsePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  for (const part of raw.split(/\s*(?:\/|;|,|\||\so\s|\sy\s)\s*/)) {
    const phone = normalizePhone(part);
    if (/^\d{10,15}$/.test(phone)) return phone;
  }
  return null;
}

const cleanText = (value: string | undefined, max = 200) => {
  const v = value?.replace(/\s+/g, " ").trim();
  return v ? v.slice(0, max) : null;
};

/** Arma los pacientes con sus visitas y lista los problemas fila por fila. */
export function buildImport(table: ParsedTable, mapping: ColumnMapping, today = new Date()): ImportPreview {
  const todayKey = today.toISOString().slice(0, 10);
  const col = (row: string[], f: ImportField) => {
    const i = mapping.indexOf(f);
    return i >= 0 ? row[i] : undefined;
  };
  const byPhone = new Map<string, ImportPatient>();
  const problems: ImportProblem[] = [];
  let visits = 0;
  const rows = table.rows.slice(0, MAX_IMPORT_ROWS);
  if (table.rows.length > MAX_IMPORT_ROWS) problems.push({ line: MAX_IMPORT_ROWS + 2, reason: `Se leen hasta ${MAX_IMPORT_ROWS.toLocaleString("es-AR")} filas por vez.` });

  rows.forEach((row, index) => {
    const line = index + 2; // la 1 es el encabezado
    const rawPhone = col(row, "phone");
    const phone = parsePhone(rawPhone);
    if (!phone) {
      problems.push({ line, reason: rawPhone ? `Celular no válido: «${rawPhone.slice(0, 30)}»` : "Sin celular" });
      return;
    }
    const name = cleanText(col(row, "full_name")) ?? cleanText([col(row, "first_name"), col(row, "last_name")].filter(Boolean).join(" "));
    const patient =
      byPhone.get(phone) ??
      ({ phone, full_name: null, dni: null, email: null, birth_date: null, coverage: null, coverage_plan: null, member_number: null, notes: null, next_control_at: null, next_control_reason: null, visits: [] } satisfies ImportPatient);
    byPhone.set(phone, patient);
    // De cada dato vale el primero que aparece (en una fila por visita, se repite igual).
    patient.full_name ??= name;
    patient.dni ??= cleanText(col(row, "dni"), 20)?.replace(/\D/g, "") || null;
    const email = cleanText(col(row, "email"), 120);
    patient.email ??= email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase() : null;
    patient.birth_date ??= parseDate(col(row, "birth_date"), today);
    patient.coverage ??= cleanText(col(row, "coverage"), 80);
    patient.coverage_plan ??= cleanText(col(row, "coverage_plan"), 60);
    patient.member_number ??= cleanText(col(row, "member_number"), 40);
    patient.notes ??= cleanText(col(row, "notes"), 500);

    const rawVisit = col(row, "last_visit");
    const visit = parseDate(rawVisit, today);
    const service = cleanText(col(row, "service"), 120) ?? "";
    if (rawVisit?.trim() && !visit) problems.push({ line, reason: `Fecha de visita no válida: «${rawVisit.slice(0, 20)}»` });
    else if (visit && visit > todayKey) problems.push({ line, reason: `La visita del ${visit.split("-").reverse().join("/")} es futura: no se cuenta.` });
    else if (visit && !patient.visits.some((v) => v.visited_at === visit && v.service === service)) {
      patient.visits.push({ visited_at: visit, service, professional: cleanText(col(row, "professional"), 120) });
      visits++;
    }

    const rawControl = col(row, "next_control");
    const control = parseDate(rawControl, today);
    if (rawControl?.trim() && !control) problems.push({ line, reason: `Próximo control no válido: «${rawControl.slice(0, 20)}»` });
    // Con varias filas del mismo paciente, vale el control más lejano.
    if (control && (!patient.next_control_at || control > patient.next_control_at)) {
      patient.next_control_at = control;
      patient.next_control_reason = !service ? null : /^control/i.test(service) ? service : `control de ${service.toLowerCase()}`;
    }
  });
  return { patients: [...byPhone.values()], visits, problems, rows: rows.length };
}

/** Une el nombre de una prestación importada con las de la clínica (sin tildes ni mayúsculas). */
export function matchService<T extends { id: string; name: string }>(service: string, types: T[]): T | null {
  const s = normalizeHeader(service);
  if (!s) return null;
  const exact = types.find((t) => normalizeHeader(t.name) === s);
  if (exact) return exact;
  const partial = types.filter((t) => {
    const n = normalizeHeader(t.name);
    return n.length >= 4 && s.length >= 4 && (s.includes(n) || n.includes(s));
  });
  // Solo si no hay dudas: dos prestaciones posibles no se adivinan.
  return partial.length === 1 ? partial[0] : null;
}
