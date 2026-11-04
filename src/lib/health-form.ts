// Ficha de salud que el paciente firma en el consultorio. Sofi se la ofrece por chat después
// de confirmar su primera consulta; el paciente copia la plantilla, la completa y la manda,
// y el panel la imprime igual a la de papel. Este archivo no toca la base: preguntas,
// plantilla, combinación de respuestas y la hoja de cada clínica.

import { GUERRA_MININNI } from "./agent/appointment-access";

export type YesNo = "si" | "no";

export type HealthQuestion = {
  id: string;
  /** Como figura en la hoja impresa. */
  paper: string;
  /** Como va en la plantilla del chat. */
  chat: string;
  /** Dato que se pide si responde SI («qué mes», «cuál»). */
  detail?: "embarazo_meses" | "hepatitis_cual";
  /** Sangría de «Tratamientos odontológicos». */
  sub?: boolean;
};

const q = (id: string, paper: string, chat = paper, extra: Partial<HealthQuestion> = {}): HealthQuestion => ({ id, paper, chat, ...extra });

/** Columna izquierda de la hoja, en su orden. */
export const QUESTIONS_LEFT: HealthQuestion[] = [
  q("alergia_anestesicos", "Alergia a anestésicos"),
  q("alergia_medicamentos", "Alergias a drogas o medicamentos"),
  q("anemia", "Anemia"),
  q("artritis", "Artritis"),
  q("asma", "Asma Bronquial", "Asma bronquial"),
  q("convulsiones", "Ataques Convulsivos", "Ataques convulsivos"),
  q("diabetes", "Diabetes"),
  q("cardiacas", "Dolencias Cardíacas", "Dolencias cardíacas"),
  q("hipertension", "Hipertensión"),
  q("anticoagulantes", "Toma anticoagulantes?", "Toma anticoagulantes"),
  q("embarazo", "Embarazo (que mes?)", "Embarazo (de cuántos meses)", { detail: "embarazo_meses" }),
  q("venereas", "Enfermedades Venéreas (Sífilis, HIV, etc.)", "Enfermedades venéreas (sífilis, HIV, etc.)"),
  q("fiebre_reumatica", "Fiebre Reumática", "Fiebre reumática"),
  q("hepatitis", "Hepatitis (cuál?)", "Hepatitis (cuál)", { detail: "hepatitis_cual" }),
  q("neurologicos", "Problemas Neurológicos", "Problemas neurológicos"),
  q("oculares", "Problemas Oculares", "Problemas oculares"),
];

/** Columna derecha de la hoja, en su orden. */
export const QUESTIONS_RIGHT: HealthQuestion[] = [
  q("renales", "Problemas Renales", "Problemas renales"),
  q("sinusales", "Problemas Sinusales (sinusitis)", "Problemas sinusales (sinusitis)"),
  q("vesiculares", "Problemas Vesiculares", "Problemas vesiculares"),
  q("sangrado", "Sangrado excesivo en heridas"),
  q("psiquiatricos", "Trastornos Psiquiátricos", "Trastornos psiquiátricos"),
  q("ansioliticos", "Toma Ansiolíticos?", "Toma ansiolíticos"),
  q("radiacion", "Tratamiento por radiación"),
  q("tuberculosis", "Tuberculosis"),
  q("tumores_benignos", "Tumores Benignos", "Tumores benignos"),
  q("tumores_malignos", "Tumores Malignos", "Tumores malignos"),
  q("ulcera", "Úlcera Gastroduodenal", "Úlcera gastroduodenal"),
  q("tratamientos_odontologicos", "Tratamientos odontológicos:", "Tratamientos odontológicos anteriores"),
  q("periodoncia", "...de periodoncia (encías):", "- de periodoncia (encías)", { sub: true }),
  q("endodoncia", "...de endodoncia (de conductos)", "- de endodoncia (de conductos)", { sub: true }),
  q("quirurgicos", "...quirúrgicos", "- quirúrgicos", { sub: true }),
  q("proteticos", "...protéticos", "- protéticos", { sub: true }),
];

export const HEALTH_QUESTIONS: HealthQuestion[] = [...QUESTIONS_LEFT, ...QUESTIONS_RIGHT];

export const OTHERS_PAPER = "Describa cualquier tratamiento médico, medicamentos y enfermedades que no figuran en esta lista:";
export const BIOSAFETY_PAPER = "Desea conocer las normas de Bioseguridad implementadas en éste consultorio odontológico?:";

/** Lo que el paciente declaró. Todo es opcional mientras la ficha está abierta. */
export type HealthFormData = {
  respuestas?: Record<string, YesNo>;
  embarazo_meses?: string;
  hepatitis_cual?: string;
  otros?: string;
  bioseguridad?: YesNo;
  apellido?: string;
  nombres?: string;
  tipo_documento?: string;
  calle?: string;
  numero?: string;
  piso?: string;
  dpto?: string;
  localidad?: string;
};

/** Datos de la ficha del paciente que también van en la hoja. */
export type HealthFormPatient = {
  full_name: string | null;
  dni: string | null;
  birth_date: string | null;
  email: string | null;
  phone: string | null;
  coverage: string | null;
  coverage_plan: string | null;
  member_number: string | null;
  address: string | null;
  sex: string | null;
};

/** Lo que manda guardar_ficha_salud (las preguntas van por su id). */
export type HealthFormInput = Partial<Record<string, string | boolean>> & {
  resto_no?: boolean;
};

const TEXT_FIELDS = ["embarazo_meses", "hepatitis_cual", "otros", "apellido", "nombres", "tipo_documento", "calle", "numero", "piso", "dpto", "localidad"] as const;

function yesNo(value: unknown): YesNo | undefined {
  if (typeof value === "boolean") return value ? "si" : "no";
  if (typeof value !== "string") return undefined;
  const v = value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
  if (v === "si" || v === "s") return "si";
  if (v === "no" || v === "n") return "no";
  return undefined;
}

/**
 * Suma lo nuevo a lo que ya había. `resto_no`: el paciente devolvió la lista, y lo que no marcó
 * con SI es NO (también la bioseguridad). Pura.
 */
export function mergeHealthForm(current: HealthFormData, input: HealthFormInput): HealthFormData {
  const respuestas = { ...(current.respuestas ?? {}) };
  for (const question of HEALTH_QUESTIONS) {
    const answer = yesNo(input[question.id]);
    if (answer) respuestas[question.id] = answer;
  }
  const next: HealthFormData = { ...current, respuestas };
  for (const field of TEXT_FIELDS) {
    const value = input[field];
    if (typeof value === "string" && value.trim()) next[field] = value.trim();
  }
  const biosafety = yesNo(input.bioseguridad);
  if (biosafety) next.bioseguridad = biosafety;
  if (input.resto_no) {
    for (const question of HEALTH_QUESTIONS) respuestas[question.id] ??= "no";
    next.bioseguridad ??= "no";
  }
  // Las sub-preguntas de tratamientos odontológicos implican la general.
  if (["periodoncia", "endodoncia", "quirurgicos", "proteticos"].some((id) => respuestas[id] === "si")) respuestas.tratamientos_odontologicos = "si";
  return next;
}

/** Preguntas sin responder, en el orden de la hoja. */
export function unansweredQuestions(data: HealthFormData): HealthQuestion[] {
  return HEALTH_QUESTIONS.filter((question) => !data.respuestas?.[question.id]);
}

/** ¿Hay un domicilio, del que declaró o de la ficha? */
const hasAddress = (data: HealthFormData, patient: HealthFormPatient) => Boolean(data.calle || patient.address);

/** Lo que falta para dar la ficha por completa. */
export function missingForCompletion(data: HealthFormData, patient: HealthFormPatient): string[] {
  return [
    !hasAddress(data, patient) && "Domicilio",
    !data.localidad && !patient.address && "Localidad",
    ...unansweredQuestions(data).map((question) => question.chat.replace(/^- /, "Tratamientos ")),
    !data.bioseguridad && "Si desea conocer las normas de bioseguridad",
  ].filter((item): item is string => Boolean(item));
}

export const HEALTH_FORM_MARKER = "📋 FICHA DE SALUD";

/** ¿La respuesta del agente trae la plantilla? Para mandarla como un mensaje aparte. */
const MARKER_LINE = /^[ \t*_~📋]*FICHA DE SALUD\b/im;

/** ¿Este mensaje es la plantilla? (no se manda como audio). */
export function isHealthFormText(text: string): boolean {
  const match = MARKER_LINE.exec(text.trimStart());
  return Boolean(match && match.index === 0);
}

/**
 * Separa la plantilla del resto del mensaje: así el paciente la copia sola y la devuelve
 * completa. Sin plantilla, o si es lo único que hay, devuelve un solo mensaje. Pura.
 */
export function splitHealthFormMessage(text: string): string[] {
  const match = MARKER_LINE.exec(text);
  if (!match || match.index === 0) return [text];
  const before = text.slice(0, match.index).trim();
  const form = text.slice(match.index).trim();
  return before ? [before, form] : [form];
}

/**
 * Plantilla para copiar, completar y devolver. Omite lo que ya sabemos y lo que ya respondió.
 * Sirve para quien tutea y para quien trata de usted (infinitivos). Pura.
 */
export function healthFormTemplate(data: HealthFormData, patient: HealthFormPatient): string {
  const personal = [
    !patient.full_name && "Apellido:",
    !patient.full_name && "Nombres:",
    !patient.dni && "DNI:",
    !patient.birth_date && "Fecha de nacimiento:",
    !hasAddress(data, patient) && "Domicilio (calle y número):",
    !hasAddress(data, patient) && "Piso y depto:",
    !data.localidad && !patient.address && "Localidad:",
    !patient.email && "Mail:",
    !patient.coverage && "Cobertura médica y N° de afiliado:",
  ].filter(Boolean);
  const male = patient.sex === "masculino";
  const pending = unansweredQuestions(data).filter((question) => !(male && question.id === "embarazo"));
  const lines = [
    HEALTH_FORM_MARKER,
    "Copiar este mensaje, completar los datos y escribir SI al lado de lo que tenga o haya tenido (lo que quede en blanco cuenta como NO). Después, enviarlo.",
  ];
  if (personal.length) lines.push("", ...(personal as string[]));
  if (pending.length) lines.push("", ...pending.map((question) => `${question.chat}:`));
  if (!data.otros) lines.push("", "Otros tratamientos médicos, medicamentos o enfermedades:");
  if (!data.bioseguridad) lines.push("", "¿Desea conocer las normas de bioseguridad del consultorio?:");
  return lines.join("\n");
}

const DENTAL = new Set(["tratamientos_odontologicos", "periodoncia", "endodoncia", "quirurgicos", "proteticos"]);

/** Enfermedades y medicación que marcó con SI, para verlas de un vistazo en el panel. */
export function positiveAnswers(data: HealthFormData): string[] {
  return HEALTH_QUESTIONS.filter((question) => !DENTAL.has(question.id) && data.respuestas?.[question.id] === "si").map((question) => {
    const label = question.chat.replace(/ \((de cuántos meses|cuál)\)$/, "");
    const detail = question.detail && data[question.detail];
    return detail ? `${label} (${detail})` : label;
  });
}

/** Tratamientos odontológicos anteriores que contó: «de endodoncia y protéticos», o null. */
export function dentalHistory(data: HealthFormData): string | null {
  const kinds = HEALTH_QUESTIONS.filter((question) => question.sub && data.respuestas?.[question.id] === "si").map((question) =>
    question.chat.replace(/^- /, "").replace(/ \(.*\)$/, ""),
  );
  if (kinds.length) return kinds.length === 1 ? kinds[0] : `${kinds.slice(0, -1).join(", ")} y ${kinds[kinds.length - 1]}`;
  return data.respuestas?.tratamientos_odontologicos === "si" ? "sí" : null;
}

/** Apellido y nombres por separado: lo que declaró, o el último nombre como apellido. */
export function splitFullName(data: HealthFormData, fullName: string | null): { apellido: string; nombres: string } {
  if (data.apellido || data.nombres) return { apellido: data.apellido ?? "", nombres: data.nombres ?? "" };
  const words = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return { apellido: words[0] ?? "", nombres: "" };
  return { apellido: words[words.length - 1], nombres: words.slice(0, -1).join(" ") };
}

/** Domicilio para guardar en la ficha del paciente: «Calle 123, piso 2 B, Localidad». */
export function addressLine(data: HealthFormData): string | null {
  if (!data.calle) return null;
  const street = [data.calle, data.numero].filter(Boolean).join(" ");
  const unit = [data.piso && `piso ${data.piso}`, data.dpto].filter(Boolean).join(" ");
  return [street, unit, data.localidad].filter(Boolean).join(", ");
}

// ---------------------------------------------------------------------------
// La hoja de cada clínica
// ---------------------------------------------------------------------------

export type HealthFormSheet = {
  /** Iniciales del logo. */
  monogram: string;
  professionals: Array<{ name: string; lines: string[] }>;
};

const SHEETS: Record<string, HealthFormSheet> = {
  [GUERRA_MININNI]: {
    monogram: "CG",
    professionals: [
      { name: "DR. CLAUDIO M. GUERRA", lines: ["ODONTOLOGO", "M. N. 13816", "Especialista en Prótesis (M.S.P.)"] },
      { name: "DR. MARIANO MININNI", lines: ["ODONTOLOGO", "M. N. 34543"] },
    ],
  },
};

/** La hoja de la clínica, o null si la clínica no usa ficha de salud. */
export function healthFormSheet(clinicId: string): HealthFormSheet | null {
  return SHEETS[clinicId] ?? null;
}

/** Piezas del odontograma, como en la hoja: arriba 18→11 | 21→28, abajo 48→41 | 31→38. */
export const TEETH = {
  upper: [[18, 17, 16, 15, 14, 13, 12, 11], [21, 22, 23, 24, 25, 26, 27, 28]],
  lower: [[48, 47, 46, 45, 44, 43, 42, 41], [31, 32, 33, 34, 35, 36, 37, 38]],
} as const;
