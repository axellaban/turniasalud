import Link from "next/link";
import { notFound } from "next/navigation";
import { Jost, Parisienne, Tinos } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getPanelClinic } from "@/lib/panel-clinic";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/clinic";
import { displayPhone } from "@/lib/phone";
import { formatDateTime, localDateKey } from "@/lib/time";
import { CHANNEL_LABEL, buttonClass } from "@/components/ui";
import {
  BIOSAFETY_PAPER,
  OTHERS_PAPER,
  QUESTIONS_LEFT,
  QUESTIONS_RIGHT,
  TEETH,
  healthFormSheet,
  missingForCompletion,
  splitFullName,
  type HealthFormData,
  type HealthQuestion,
  type YesNo,
} from "@/lib/health-form";
import { latestHealthForm, sheetPatient } from "@/lib/health-forms";
import type { Patient } from "@/lib/types";
import { PrintButton } from "./imprimir";

// La ficha de salud igual a la de papel, completa con lo que el paciente declaró por chat,
// para imprimirla y que la firme al llegar. Sin el menú del panel: es una hoja.

export const metadata: Metadata = { title: "Ficha de salud · Panel", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const serif = Tinos({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-ficha-serif" });
const sans = Jost({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-ficha-sans" });
const script = Parisienne({ subsets: ["latin"], weight: "400", variable: "--font-ficha-script" });

/** Tinta de lo completado: se distingue de lo impreso, como una birome. */
const INK = "text-[#1d2f7a]";
const INK_CIRCLE = "outline-[#1d2f7a]";

/** AAAA-MM-DD → DD/MM/AAAA */
const ddmmyyyy = (key: string) => key.split("-").reverse().join("/");

/** Una pieza dentaria vacía: cuadrado con sus cinco caras. */
function Tooth() {
  return (
    <svg viewBox="0 0 20 20" className="block h-[5.6mm] w-[5.6mm]" aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth="1">
        <rect x="0.5" y="0.5" width="19" height="19" />
        <rect x="6" y="6" width="8" height="8" />
        <path d="M0.5 0.5 6 6M19.5 0.5 14 6M0.5 19.5 6 14M19.5 19.5 14 14" />
      </g>
    </svg>
  );
}

function TeethRow({ quadrants, numbers }: { quadrants: readonly (readonly number[])[]; numbers: "top" | "bottom" }) {
  return (
    <div className="grid grid-cols-2">
      {quadrants.map((teeth, i) => (
        <div key={i} className={`flex justify-between ${i === 0 ? "pr-[2mm]" : "pl-[2mm]"}`}>
          {teeth.map((n) => (
            <div key={n} className={`flex flex-col items-center gap-[0.8mm] ${numbers === "bottom" ? "flex-col-reverse" : ""}`}>
              <span className="text-[8pt] leading-none">{n}</span>
              <Tooth />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Odontogram() {
  return (
    <div className="relative">
      <TeethRow quadrants={TEETH.upper} numbers="top" />
      <div className="my-[2.4mm] border-t border-black" />
      <TeethRow quadrants={TEETH.lower} numbers="bottom" />
      <div className="absolute inset-y-0 left-1/2 border-l-[1.5px] border-black" aria-hidden />
    </div>
  );
}

/** Rótulo impreso + línea de puntos con lo completado. */
function Field({ label, value, className = "flex-1" }: { label: string; value?: string | null; className?: string }) {
  return (
    <span className={`flex min-w-0 items-baseline gap-[1.5mm] ${className}`}>
      <span className="shrink-0">{label}</span>
      <span className={`min-w-[8mm] flex-1 truncate border-b border-dotted border-black pl-[1mm] font-[family-name:var(--font-geist-sans)] text-[10.5pt] leading-[1.15] ${INK}`}>
        {value || " "}
      </span>
    </span>
  );
}

/** «SI-NO» con un círculo en lo que respondió. */
function SiNo({ value }: { value?: YesNo }) {
  const mark = (on: boolean, text: string) => (
    <span className={`inline-block rounded-[50%] px-[0.9mm] ${on ? `outline outline-[1.5px] -outline-offset-[0.3mm] ${INK_CIRCLE}` : ""}`}>{text}</span>
  );
  return (
    <span className="whitespace-nowrap">
      {mark(value === "si", "SI")}-{mark(value === "no", "NO")}
    </span>
  );
}

function QuestionRows({ questions, data }: { questions: HealthQuestion[]; data: HealthFormData }) {
  return (
    <ul className="space-y-[0.7mm]">
      {questions.map((q) => {
        const detail = q.detail && data[q.detail];
        return (
          <li key={q.id} className="flex items-baseline justify-between gap-[2mm]">
            <span className={q.sub ? "pl-[1mm]" : ""}>
              {q.paper}
              {detail && <span className={`ml-[1.5mm] font-[family-name:var(--font-geist-sans)] text-[10pt] ${INK}`}>{detail}</span>}
            </span>
            <SiNo value={data.respuestas?.[q.id]} />
          </li>
        );
      })}
    </ul>
  );
}

function Lines({ text, count }: { text?: string; count: number }) {
  return (
    <div className="space-y-[1.5mm]">
      <p className={`min-h-[6mm] whitespace-pre-line border-b border-dotted border-black font-[family-name:var(--font-geist-sans)] text-[10.5pt] leading-[6mm] ${INK}`}>
        {text || " "}
      </p>
      {Array.from({ length: Math.max(0, count - 1) }, (_, i) => (
        <div key={i} className="h-[6mm] border-b border-dotted border-black" />
      ))}
    </div>
  );
}

function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mx-auto mb-5 flex w-full max-w-[210mm] flex-wrap items-center gap-3 px-4 print:hidden">{children}</div>;
}

export default async function HealthFormSheetPage({ params }: PageProps<"/panel/pacientes/[id]/ficha">) {
  const { id } = await params;
  const clinic = await getPanelClinic();
  const sheet = healthFormSheet(clinic.id);
  const [p] = sheet && isUuid(id) ? await sql<Patient[]>`select * from patients where id = ${id} and clinic_id = ${clinic.id}` : [];
  if (!sheet || !p) notFound();

  const form = await latestHealthForm(p.id);
  const data: HealthFormData = form?.data ?? {};
  const tz = clinic.timezone;
  const missing = missingForCompletion(data, sheetPatient(p));
  const { apellido, nombres } = splitFullName(data, p.full_name);
  const coverage = [p.coverage, p.coverage_plan].filter(Boolean).join(" ");
  const document = p.dni ? `${data.tipo_documento ?? "DNI"} ${p.dni}` : data.tipo_documento;
  // Sin el domicilio separado (lo trajo la importación), va entero en «Calle».
  const street = data.calle ?? p.address;
  const completedOn = form?.completed_at ? ddmmyyyy(localDateKey(new Date(form.completed_at), tz)) : null;
  const [day, month, year] = completedOn ? completedOn.split("/") : ["", "", ""];

  const status = form?.completed_at
    ? `Completada por ${CHANNEL_LABEL[form.source ?? ""] ?? "chat"} el ${formatDateTime(form.completed_at, tz)}.`
    : form && Object.keys(data.respuestas ?? {}).length
      ? `Sin terminar: ${missing.length === 1 ? "falta 1 dato" : `faltan ${missing.length} datos`}. Lo que falta se completa a mano.`
      : "Todavía no la completó por chat: sale con sus datos y el resto se completa a mano.";

  return (
    <div className={`${serif.variable} ${sans.variable} ${script.variable} min-h-screen bg-neutral-100 py-6 print:min-h-0 print:bg-white print:py-0`}>
      <style>{"@page { size: A4; margin: 9mm 10mm; }"}</style>
      <Toolbar>
        <Link href={`/panel/pacientes/${p.id}`} className="text-sm text-brand-700 hover:underline">
          ← {p.full_name ?? "Paciente"}
        </Link>
        <p className="flex-1 text-sm text-brand-900/70">{status}</p>
        <PrintButton className={buttonClass} />
      </Toolbar>

      <div className="overflow-x-auto px-4 print:overflow-visible print:px-0">
        <article className="mx-auto w-[190mm] bg-white px-[8mm] pb-[6mm] pt-[8mm] font-[family-name:var(--font-ficha-sans)] text-[10pt] text-black shadow-sm ring-1 ring-black/5 print:w-auto print:p-0 print:shadow-none print:ring-0">
          {/* Encabezado: profesionales y odontograma */}
          <header className="grid grid-cols-[56mm_1fr] gap-[5mm]">
            <div className="flex flex-col items-center text-center uppercase tracking-wide">
              <div className="relative mb-[2mm] h-[15mm] w-[17mm] font-[family-name:var(--font-ficha-serif)] text-[34pt] leading-none" aria-hidden>
                <span className="absolute left-0 top-0">{sheet.monogram[0]}</span>
                <span className="absolute left-[5.5mm] top-[2.4mm] text-[28pt]">{sheet.monogram.slice(1)}</span>
              </div>
              {sheet.professionals.map((pro, i) => (
                <div key={pro.name} className={i ? "mt-[3mm]" : ""}>
                  <p className="text-[11.5pt] leading-tight">{pro.name}</p>
                  {pro.lines.map((line) => (
                    <p key={line} className={`text-[8.5pt] leading-tight ${/[a-z]/.test(line) ? "normal-case tracking-normal" : ""}`}>
                      {line}
                    </p>
                  ))}
                </div>
              ))}
            </div>
            <div className="flex flex-col">
              <Odontogram />
              <div className="mt-auto space-y-[2.2mm] pt-[5mm]">
                <div className="flex gap-[3mm]">
                  <Field label="Cobertura Médica:" value={coverage} />
                  <Field label="Nº" value={p.member_number} className="w-[38mm]" />
                </div>
                <div className="flex justify-end">
                  <Field label="Fecha de Nacimiento:" value={p.birth_date ? ddmmyyyy(p.birth_date) : null} className="w-[78mm]" />
                </div>
              </div>
            </div>
          </header>

          {/* Datos personales */}
          <section className="mt-[2.5mm] space-y-[2.6mm]">
            <div className="flex gap-[3mm]">
              <Field label="Apellido" value={apellido} className="w-[50mm]" />
              <Field label="Nombres" value={nombres} />
              <Field label="Tipo y Nº de Documento:" value={document} className="w-[66mm]" />
            </div>
            <div className="flex gap-[3mm]">
              <Field label="Domicilio Particular: Calle:" value={street} />
              <Field label="Número:" value={data.calle ? data.numero : null} className="w-[30mm]" />
              <Field label="Piso:" value={data.piso} className="w-[20mm]" />
              <Field label="Dpto:" value={data.dpto} className="w-[20mm]" />
            </div>
            <div className="flex gap-[3mm]">
              <Field label="Localidad:" value={data.localidad} />
              <Field label="Teléfono:" value={p.phone ? displayPhone(p.phone) : null} className="w-[72mm]" />
            </div>
            <Field label="E-mail:" value={p.email} className="w-full" />
          </section>

          {/* Antecedentes */}
          <section className="mt-[3mm] font-[family-name:var(--font-ficha-serif)] text-[11pt]">
            <p className="px-[6mm] leading-tight">Responda si tuvo o tiene algunas de estas enfermedades, encerrando con un círculo la respuesta correcta:</p>
            <div className="mt-[1mm] grid grid-cols-[1.1fr_1fr] border border-black">
              <div className="border-r border-black py-[4.5mm] pl-[4.5mm] pr-[3mm]">
                <QuestionRows questions={QUESTIONS_LEFT} data={data} />
              </div>
              <div className="py-[4.5mm] pl-[4mm] pr-[3.5mm]">
                <QuestionRows questions={QUESTIONS_RIGHT} data={data} />
              </div>
            </div>

            <div className="mt-[3.5mm] px-[6mm]">
              <p>{OTHERS_PAPER}</p>
              <div className="mt-[1mm]">
                <Lines text={data.otros} count={2} />
              </div>
            </div>

            <p className="mt-[4mm] px-[3mm] font-[family-name:var(--font-ficha-script)] text-[17pt] leading-snug">
              {BIOSAFETY_PAPER} <SiNo value={data.bioseguridad} />
            </p>
          </section>

          {/* Fecha y firma */}
          <footer className="mt-[13mm] flex items-end justify-between gap-[8mm] font-[family-name:var(--font-ficha-serif)] text-[11.5pt]">
            <p className="flex items-baseline">
              Fecha:
              <span className={`inline-block w-[9mm] border-b border-dotted border-black text-center font-[family-name:var(--font-geist-sans)] text-[10.5pt] ${INK}`}>{day || " "}</span>/
              <span className={`inline-block w-[9mm] border-b border-dotted border-black text-center font-[family-name:var(--font-geist-sans)] text-[10.5pt] ${INK}`}>{month || " "}</span>/
              <span className={`inline-block w-[13mm] border-b border-dotted border-black text-center font-[family-name:var(--font-geist-sans)] text-[10.5pt] ${INK}`}>{year || " "}</span>
            </p>
            <div className="w-[80mm] text-center">
              <div className="border-b border-dotted border-black" />
              <p className="mt-[1mm]">Firma y aclaración del paciente</p>
            </div>
          </footer>
          <p className="mt-[4mm] text-right font-[family-name:var(--font-geist-sans)] text-[7pt] text-neutral-500">{status}</p>
        </article>
      </div>
    </div>
  );
}
