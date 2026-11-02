import { normalizePhone } from "./phone";
import type { PatientSex } from "./types";

// Importación de la base de pacientes que la clínica trae de su sistema anterior (AgendaPro,
// Dentalink, Medilink, una planilla…): un CSV exportado o celdas copiadas de Excel o Google Sheets.
// Corre igual en el navegador (vista previa) y en el servidor (lo que se guarda): el servidor vuelve
// a leer el texto original, nunca confía en la vista previa.
//
// Sirve tanto una fila por paciente como una fila por visita: las filas de la misma persona se
// juntan en un paciente y cada fecha queda como una visita (alimenta el recall y la reactivación).
// Una familia con un mismo celular queda en fichas aparte, y quien no tiene celular entra igual.

export const IMPORT_FIELDS = [
  "full_name",
  "first_name",
  "last_name",
  "phone",
  "dni",
  "email",
  "birth_date",
  "sex",
  "address",
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
  sex: "Sexo",
  address: "Dirección",
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
  sex: ["sexo", "genero", "sexo biologico"],
  address: ["direccion", "domicilio", "calle", "direccion particular", "domicilio particular"],
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
const EXACT_ONLY = new Set(["fecha", "control", "consulta", "motivo", "contacto", "plan", "volver", "recall", "nombre", "cliente", "paciente", "calle"]);

/** Columnas que no hace falta importar porque salen de otra (se explica al lado de la columna). */
const DERIVED: Record<string, string> = {
  edad: "No hace falta: la edad sale de la fecha de nacimiento.",
  "edad actual": "No hace falta: la edad sale de la fecha de nacimiento.",
};

export function derivedColumnNote(header: string): string | null {
  return DERIVED[normalizeHeader(header)] ?? null;
}

export type ParsedTable = { headers: string[]; rows: string[][] };
export type ColumnMapping = Array<ImportField | null>;

export type ImportPatient = {
  /** Orden dentro de la importación (las filas de la planilla que forman la ficha, en `lines`). */
  key: number;
  lines: number[];
  /** null: sin celular que sirva (la ficha se crea igual, con el número de la planilla en las notas). */
  phone: string | null;
  /** Otros celulares de la misma persona (filas con su DNI y otro número). */
  other_phones: string[];
  full_name: string | null;
  dni: string | null;
  email: string | null;
  birth_date: string | null;
  sex: PatientSex | null;
  address: string | null;
  coverage: string | null;
  coverage_plan: string | null;
  member_number: string | null;
  /** Las notas de la planilla y lo que no tiene un campo propio (un mail mal escrito, otro nombre…). */
  notes: string | null;
  next_control_at: string | null;
  next_control_reason: string | null;
  visits: Array<{ visited_at: string; service: string; professional: string | null }>;
};

/** skipped: la fila no se importó; si no, es un aviso sobre una fila que sí entró. */
export type ImportProblem = { line: number; reason: string; skipped?: boolean };

/** Un celular que trae más de una fila: quiénes son y con quién se juntó cada una (la primera fila de su ficha). */
export type SharedPhone = {
  phone: string;
  rows: Array<{ line: number; name: string | null; detail: string; sameAs: number | null }>;
};

export type ImportPreview = {
  patients: ImportPatient[];
  visits: number;
  problems: ImportProblem[];
  skipped: number;
  rows: number;
  /** Celulares con más de una fila, para revisar si son la misma persona o una familia. */
  shared: SharedPhone[];
  withoutPhone: number;
  /** Celulares que venían sin código de área y se completaron. */
  completedPhones: number;
};

export type ImportOptions = {
  today?: Date;
  /** Código de área para los números que vienen sin él (por ejemplo, 11). */
  areaCode?: string | null;
  /** Revisión del consultorio: fila → primera fila de la ficha con la que se junta (0: ficha aparte). */
  sameAs?: Record<number, number>;
};

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
  for (const part of splitPhones(raw)) {
    const phone = normalizePhone(part);
    // En la Argentina, el único código de área que empieza con 1 es el 11: «15 4555-0123» no tiene código.
    if (/^\d{10,15}$/.test(phone) && !/^5491[02-9]/.test(phone)) return phone;
  }
  return null;
}

const splitPhones = (raw: string) => raw.split(/\s*(?:\/|;|,|\||\so\s|\sy\s)\s*/);

/** Código de área argentino escrito por el consultorio: 2 a 4 dígitos, sin el 0. */
export function cleanAreaCode(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return /^[1-9]\d{1,3}$/.test(digits) ? digits : null;
}

/**
 * Como parsePhone, pero un número local (sin código de área) se completa con el del consultorio:
 * con el 11, «4555-0123» o «15 4555-0123» → 54 9 11 4555-0123.
 */
export function readPhone(raw: string | null | undefined, areaCode?: string | null): { phone: string | null; completed: boolean } {
  const direct = parsePhone(raw);
  if (direct || !raw) return { phone: direct, completed: false };
  const area = cleanAreaCode(areaCode);
  if (!area) return { phone: null, completed: false };
  const local = 10 - area.length;
  for (const part of splitPhones(raw)) {
    let digits = part.replace(/\D/g, "");
    if (digits.length === local + 2 && digits.startsWith("15")) digits = digits.slice(2);
    if (digits.length !== local || digits.startsWith("0")) continue;
    const phone = normalizePhone(area + digits);
    if (/^\d{10,15}$/.test(phone)) return { phone, completed: true };
  }
  return { phone: null, completed: false };
}

/** El código de área de casi todos los celulares de la planilla, si se puede saber (hoy, solo el 11). */
export function suggestAreaCode(table: ParsedTable, mapping: ColumnMapping): string | null {
  const column = mapping.indexOf("phone");
  if (column < 0) return null;
  const phones = table.rows.map((r) => parsePhone(r[column])).filter((p): p is string => Boolean(p));
  const caba = phones.filter((p) => p.startsWith("54911")).length;
  return phones.length >= 5 && caba / phones.length >= 0.6 ? "11" : null;
}

/** «Femenino», «F», «Mujer» → femenino; lo que no se entiende queda en las notas. */
export function parseSex(raw: string | null | undefined): PatientSex | null {
  const v = normalizeHeader(raw ?? "");
  if (/^(f|fem|femenino|femenina|mujer)$/.test(v)) return "femenino";
  if (/^(m|masc|masculino|hombre|varon)$/.test(v)) return "masculino";
  if (/^(x|otro|otra|otros|no binario|nb)$/.test(v)) return "otro";
  return null;
}

const cleanText = (value: string | undefined, max = 200) => {
  const v = value?.replace(/\s+/g, " ").trim();
  return v ? v.slice(0, max) : null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_STOPWORDS = new Set(["de", "del", "la", "las", "los", "y", "e"]);

const nameTokens = (name: string | null | undefined) =>
  normalizeHeader(name ?? "")
    .split(" ")
    .filter((t) => t.length >= 2 && !NAME_STOPWORDS.has(t));

/** Distancia de edición (para «Rizzo» / «Rizo», «Rosana Pantolini» / «Roxana Pontolini»). */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

/** Cómo suena: «Tolquentine» = «Tolketine», «Henrique» = «Enrique», «Rizzo» = «Rizo». */
const sound = (word: string) =>
  word
    .replace(/ch/g, "x")
    .replace(/h/g, "")
    .replace(/qu/g, "k")
    .replace(/c([aou])/g, "k$1")
    .replace(/c([ei])/g, "s$1")
    .replace(/z/g, "s")
    .replace(/v/g, "b")
    .replace(/ll/g, "y")
    .replace(/(.)\1+/g, "$1");

const similarWord = (a: string, b: string) => {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4) return false;
  // Mariano y Mariana, Fernando y Fernanda: son dos personas.
  if (a.length === b.length && a.slice(0, -1) === b.slice(0, -1) && /[ao]/.test(a.at(-1)!) && /[ao]/.test(b.at(-1)!)) return false;
  const [sa, sb] = [sound(a), sound(b)];
  return editDistance(sa, sb) <= (Math.max(sa.length, sb.length) >= 8 ? 2 : 1);
};

/**
 * ¿Es la misma persona escrita de dos maneras? Cada palabra del nombre más corto tiene que estar
 * (igual o con un error de tipeo) en el otro, y tienen que coincidir al menos dos: «Norma Ricci» =
 * «Norma Riccis», «Ignacio Testa» = «Testa Juan Ignacio»; «Miguel Arrieta» ≠ «Susana Arrieta».
 */
export function similarNames(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length < 2 && long.length >= 2) return false;
  const free = [...long];
  for (const word of short) {
    const i = free.findIndex((w) => similarWord(word, w));
    if (i < 0) return false;
    free.splice(i, 1);
  }
  return true;
}

const validDni = (dni: string | null | undefined) => {
  const digits = (dni ?? "").replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 11 ? digits : null;
};

/** Lo que distingue a dos personas con el mismo celular: otro DNI, otra fecha de nacimiento u otro sexo. */
function conflicts(a: { dni: string | null; birth_date: string | null; sex: PatientSex | null }, b: typeof a): boolean {
  const da = validDni(a.dni);
  const db = validDni(b.dni);
  if (da && db && da !== db) return true;
  if (a.birth_date && b.birth_date && a.birth_date !== b.birth_date) return true;
  return Boolean(a.sex && b.sex && a.sex !== "otro" && b.sex !== "otro" && a.sex !== b.sex);
}

type Draft = ImportPatient & { names: string[]; noteLines: string[] };

const fmtKey = (key: string) => key.split("-").reverse().join("/");

/**
 * Arma los pacientes con sus visitas y lista los problemas fila por fila.
 * - Una fila por visita: las filas de la misma persona se juntan y cada fecha queda como una visita.
 * - Familias: dos personas con el mismo celular quedan en fichas aparte (otro DNI, otra fecha de
 *   nacimiento u otro nombre). La misma persona escrita de dos maneras se junta. El consultorio puede
 *   corregirlo fila por fila (`sameAs`).
 * - Sin celular que sirva: la ficha se crea igual y el número de la planilla queda en las notas.
 */
export function buildImport(table: ParsedTable, mapping: ColumnMapping, options: ImportOptions = {}): ImportPreview {
  const today = options.today ?? new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const col = (row: string[], f: ImportField) => {
    const i = mapping.indexOf(f);
    return i >= 0 ? row[i] : undefined;
  };
  const drafts: Draft[] = [];
  const byPhone = new Map<string, Draft[]>();
  const byDni = new Map<string, Draft>();
  const byNameNoPhone = new Map<string, Draft>();
  const draftOfLine = new Map<number, Draft>();
  const linesOfPhone = new Map<string, number[]>();
  const problems: ImportProblem[] = [];
  let visits = 0;
  let completedPhones = 0;
  const rows = table.rows.slice(0, MAX_IMPORT_ROWS);
  if (table.rows.length > MAX_IMPORT_ROWS) {
    problems.push({ line: MAX_IMPORT_ROWS + 2, reason: `Se leen hasta ${MAX_IMPORT_ROWS.toLocaleString("es-AR")} filas por vez.`, skipped: true });
  }
  const area = cleanAreaCode(options.areaCode);

  rows.forEach((row, index) => {
    const line = index + 2; // la 1 es el encabezado
    const rawPhone = cleanText(col(row, "phone"), 60);
    const { phone, completed } = readPhone(rawPhone, area);
    const name = cleanText(col(row, "full_name")) ?? cleanText([col(row, "first_name"), col(row, "last_name")].filter(Boolean).join(" "));
    const rawDni = cleanText(col(row, "dni"), 20)?.replace(/\D/g, "") || null;
    if (!phone && !name) {
      problems.push({ line, reason: rawPhone ? `Sin nombre y con un celular que no sirve: «${rawPhone.slice(0, 30)}»` : "Sin nombre ni celular", skipped: true });
      return;
    }
    const rawBirth = cleanText(col(row, "birth_date"), 30);
    const birth = parseDate(rawBirth, today);
    const rawSex = cleanText(col(row, "sex"), 30);
    const sex = parseSex(rawSex);
    const person = { dni: rawDni, birth_date: birth, sex };

    // ¿Con qué ficha va esta fila?
    let draft: Draft | undefined;
    const override = phone ? options.sameAs?.[line] : undefined;
    if (override !== undefined) {
      const target = override ? draftOfLine.get(override) : undefined;
      draft = target && target.phone === phone ? target : undefined;
    } else {
      const dni = validDni(rawDni);
      draft = dni ? byDni.get(dni) : undefined;
      if (draft && conflicts(draft, person)) draft = undefined;
      if (!draft && phone) draft = byPhone.get(phone)?.find((d) => !conflicts(d, person) && (!name || !d.names.length || d.names.some((n) => similarNames(n, name))));
      if (!draft && !phone && name) {
        const same = byNameNoPhone.get(nameTokens(name).join(" "));
        if (same && !conflicts(same, person)) draft = same;
      }
    }
    if (!draft) {
      draft = {
        key: drafts.length, lines: [], phone, other_phones: [], full_name: null, dni: null, email: null, birth_date: null, sex: null,
        address: null, coverage: null, coverage_plan: null, member_number: null, notes: null, next_control_at: null,
        next_control_reason: null, visits: [], names: [], noteLines: [],
      };
      drafts.push(draft);
      if (phone) byPhone.set(phone, [...(byPhone.get(phone) ?? []), draft]);
      else if (name) byNameNoPhone.set(nameTokens(name).join(" "), draft);
    }
    draft.lines.push(line);
    draftOfLine.set(line, draft);
    if (phone) linesOfPhone.set(phone, [...(linesOfPhone.get(phone) ?? []), line]);
    const note = (text: string) => { if (!draft!.noteLines.includes(text)) draft!.noteLines.push(text); };

    // Celular: el de la ficha, otro número suyo, completado con el código de área o, si no sirve, en las notas.
    if (phone && !draft.phone) {
      draft.phone = phone;
      byPhone.set(phone, [...(byPhone.get(phone) ?? []), draft]);
    } else if (phone && phone !== draft.phone && !draft.other_phones.includes(phone)) draft.other_phones.push(phone);
    if (completed) {
      completedPhones++;
      note(`El celular venía sin código de área («${rawPhone}»): se completó con el ${area}.`);
    }
    if (!phone && rawPhone) {
      note(`Celular en la planilla, que no sirve para WhatsApp: «${rawPhone}».`);
      problems.push({ line, reason: `Celular no válido: «${rawPhone.slice(0, 30)}». Entra sin celular.` });
    } else if (!phone) {
      problems.push({ line, reason: "Sin celular: entra sin celular." });
    }

    // De cada dato vale el primero que aparece (en una fila por visita, se repite igual).
    if (name && !draft.names.some((n) => nameTokens(n).join(" ") === nameTokens(name).join(" "))) {
      if (draft.names.length) note(`También figura como: ${name}.`);
      draft.names.push(name);
    }
    draft.full_name ??= name;
    draft.dni ??= rawDni;
    if (rawDni && validDni(rawDni) && draft.dni !== rawDni) note(`Otro DNI en la planilla: ${rawDni}.`);
    const email = cleanText(col(row, "email"), 120);
    if (email && EMAIL.test(email)) {
      if (!draft.email) draft.email = email.toLowerCase();
      else if (draft.email !== email.toLowerCase()) note(`Otro mail: ${email.toLowerCase()}.`);
    } else if (email) note(`Mail en la planilla, mal escrito: «${email}».`);
    draft.birth_date ??= birth;
    if (rawBirth && !birth) note(`Fecha de nacimiento en la planilla, que no se entiende: «${rawBirth}».`);
    draft.sex ??= sex;
    if (rawSex && !sex) note(`Sexo en la planilla: ${rawSex}.`);
    draft.address ??= cleanText(col(row, "address"), 200);
    draft.coverage ??= cleanText(col(row, "coverage"), 80);
    draft.coverage_plan ??= cleanText(col(row, "coverage_plan"), 60);
    draft.member_number ??= cleanText(col(row, "member_number"), 40);
    const notes = cleanText(col(row, "notes"), 500);
    if (notes) note(notes);

    const rawVisit = col(row, "last_visit");
    const visit = parseDate(rawVisit, today);
    const service = cleanText(col(row, "service"), 120) ?? "";
    const professional = cleanText(col(row, "professional"), 120);
    if (rawVisit?.trim() && !visit) problems.push({ line, reason: `Fecha de visita no válida: «${rawVisit.slice(0, 20)}»` });
    else if (visit && visit > todayKey) problems.push({ line, reason: `La visita del ${fmtKey(visit)} es futura: no se cuenta.` });
    else if (visit && !draft.visits.some((v) => v.visited_at === visit && v.service === service)) {
      draft.visits.push({ visited_at: visit, service, professional });
      visits++;
    }
    // Sin fecha de visita, la prestación y el profesional no se pierden.
    if (!visit) {
      if (professional) note(`Profesional: ${professional}.`);
      if (service && !col(row, "next_control")?.trim()) note(`Prestación: ${service}.`);
    }

    const rawControl = col(row, "next_control");
    const control = parseDate(rawControl, today);
    if (rawControl?.trim() && !control) problems.push({ line, reason: `Próximo control no válido: «${rawControl.slice(0, 20)}»` });
    // Con varias filas del mismo paciente, vale el control más lejano.
    if (control && (!draft.next_control_at || control > draft.next_control_at)) {
      draft.next_control_at = control;
      draft.next_control_reason = !service ? null : /^control/i.test(service) ? service : `control de ${service.toLowerCase()}`;
    }
  });

  const patients: ImportPatient[] = drafts.map((d) => {
    const { names, noteLines, ...p } = d;
    void names;
    return { ...p, notes: noteLines.length ? noteLines.join("\n").slice(0, 2000) : null };
  });

  const describe = (line: number) => {
    const row = rows[line - 2];
    const dni = cleanText(col(row, "dni"), 20);
    const birth = parseDate(col(row, "birth_date"), today);
    const visit = parseDate(col(row, "last_visit"), today);
    return [dni && `DNI ${dni}`, birth && `nació el ${fmtKey(birth)}`, visit && `vino el ${fmtKey(visit)}`].filter(Boolean).join(" · ") || "sin DNI ni fecha";
  };
  const shared: SharedPhone[] = [...linesOfPhone]
    .filter(([, lines]) => lines.length > 1)
    .map(([phone, lines]) => ({
      phone,
      rows: lines.map((line) => {
        const first = draftOfLine.get(line)!.lines[0];
        const row = rows[line - 2];
        return {
          line,
          name: cleanText(col(row, "full_name")) ?? cleanText([col(row, "first_name"), col(row, "last_name")].filter(Boolean).join(" ")),
          detail: describe(line),
          sameAs: first !== line && lines.includes(first) ? first : null,
        };
      }),
    }));

  return {
    patients,
    visits,
    problems,
    skipped: problems.filter((p) => p.skipped).length,
    rows: rows.length,
    shared,
    withoutPhone: patients.filter((p) => !p.phone).length,
    completedPhones,
  };
}

/** Lo que hace falta de una ficha que ya está en Turnia para saber si es la misma persona. */
export type ExistingPatient = { id: string; phone: string | null; full_name: string | null; dni: string | null; birth_date: string | null; sex: PatientSex | null };

/**
 * La ficha que ya existe para cada paciente importado (o null si es nuevo): la del mismo DNI; si no,
 * la del mismo celular con el mismo nombre (o una sin nombre ni DNI, si ese celular trae a una sola
 * persona); sin celular, la que tiene el mismo nombre y tampoco tiene celular. Cada ficha se usa una vez.
 */
export function matchExisting(imported: ImportPatient[], existing: ExistingPatient[]): Array<string | null> {
  const used = new Set<string>();
  const byDni = new Map<string, ExistingPatient[]>();
  const byPhone = new Map<string, ExistingPatient[]>();
  const byName = new Map<string, ExistingPatient[]>();
  const add = <K,>(map: Map<K, ExistingPatient[]>, key: K, p: ExistingPatient) => map.set(key, [...(map.get(key) ?? []), p]);
  for (const p of existing) {
    const dni = validDni(p.dni);
    if (dni) add(byDni, dni, p);
    if (p.phone) add(byPhone, p.phone, p);
    else if (p.full_name) add(byName, nameTokens(p.full_name).join(" "), p);
  }
  const perPhone = new Map<string, number>();
  for (const p of imported) if (p.phone) perPhone.set(p.phone, (perPhone.get(p.phone) ?? 0) + 1);

  return imported.map((p) => {
    const free = (list: ExistingPatient[] | undefined) => (list ?? []).filter((e) => !used.has(e.id));
    const dni = validDni(p.dni);
    const candidates = dni ? free(byDni.get(dni)) : [];
    let match: ExistingPatient | undefined = candidates.find((e) => e.phone === p.phone) ?? candidates[0];
    if (!match && p.phone) {
      const samePhone = free(byPhone.get(p.phone)).filter((e) => !conflicts(e, p));
      match =
        samePhone.find((e) => similarNames(e.full_name, p.full_name)) ??
        (perPhone.get(p.phone) === 1 ? samePhone.find((e) => !e.full_name && !validDni(e.dni)) : undefined);
    }
    if (!match && !p.phone && p.full_name) match = free(byName.get(nameTokens(p.full_name).join(" "))).find((e) => !conflicts(e, p));
    if (!match) return null;
    used.add(match.id);
    return match.id;
  });
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
