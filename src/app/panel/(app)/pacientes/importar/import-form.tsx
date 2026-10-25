"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { importPatientsAction } from "../../../campaign-actions";
import { FIELD_LABELS, IMPORT_FIELDS, buildImport, detectMapping, parseTable, type ColumnMapping, type ImportField } from "@/lib/patient-import";
import { displayPhone } from "@/lib/phone";
import { Notice, buttonClass, secondaryButtonClass } from "@/components/ui";

const MAX_BYTES = 3_500_000;

/** Excel guarda los CSV en Windows-1252 si no se elige UTF-8: se prueba UTF-8 y, si no es válido, latin1. */
async function readText(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const fmtDate = (key: string | null) => (key ? key.split("-").reverse().join("/") : "—");

export function ImportForm({ clinicId }: { clinicId: string }) {
  const [state, action, pending] = useActionState(importPatientsAction, undefined);
  const [text, setText] = useState("");
  const [source, setSource] = useState("Planilla pegada");
  const [fileError, setFileError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const table = useMemo(() => (text.trim() ? parseTable(text) : null), [text]);
  const columns = useMemo(
    () => (mapping && table && mapping.length === table.headers.length ? mapping : table ? detectMapping(table.headers) : []),
    [mapping, table],
  );
  const preview = useMemo(() => (table ? buildImport(table, columns) : null), [table, columns]);
  const hasPhone = columns.includes("phone");
  const hasName = columns.includes("full_name") || columns.includes("first_name");

  const load = (value: string, name: string) => {
    setText(value);
    setSource(name);
    setMapping(null);
  };

  if (state?.ok && state.summary) {
    const s = state.summary;
    return (
      <div className="space-y-4">
        <Notice tone="success">{state.message}</Notice>
        <ul className="space-y-1 text-sm text-brand-900/75">
          <li>{s.created} fichas nuevas y {s.existing} que ya estaban (solo completamos los datos que les faltaban).</li>
          <li>{s.visits} visitas guardadas para calcular controles e inactivos.</li>
          {s.skipped > 0 && <li>{s.skipped} filas sin importar (sin celular válido u otro problema).</li>}
          {s.unmatched.length > 0 && (
            <li>
              Prestaciones que no reconocimos (cuentan para inactivos, no para controles): {s.unmatched.join(", ")}. Si son tuyas, cargalas con el mismo
              nombre en Configuración → Prestaciones y volvé a importar.
            </li>
          )}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Link href="/panel/campanas" className={buttonClass}>
            Ver a quiénes escribirles
          </Link>
          <button type="button" onClick={() => window.location.reload()} className={secondaryButtonClass}>
            Importar otra planilla
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="clinic_id" value={clinicId} />
      <input type="hidden" name="text" value={text} />
      <input type="hidden" name="source" value={source} />
      <input type="hidden" name="mapping" value={JSON.stringify(columns)} />

      <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-start">
        <label className="block text-sm">
          <span className="font-medium text-brand-900">Pegá las celdas de tu Excel o Google Sheets (con la fila de títulos)</span>
          <textarea
            rows={6}
            value={text}
            onChange={(e) => load(e.target.value, "Planilla pegada")}
            placeholder={"Paciente\tCelular\tÚltima visita\tPrestación\nMaría González\t11 5555-0001\t12/03/2026\tLimpieza dental"}
            spellCheck={false}
            className="mt-1 w-full rounded-xl border border-brand-900/15 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-brand-500"
          />
        </label>
        <div className="text-sm md:pt-6">
          <span className="block text-brand-900/60 md:text-center">o</span>
          <label className={`${secondaryButtonClass} mt-1 cursor-pointer`}>
            Elegir archivo CSV
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                setFileError(null);
                if (!file) return;
                if (file.size > MAX_BYTES) return setFileError("El archivo es muy grande: dividilo en partes de hasta 3 MB.");
                if (/\.xlsx?$/i.test(file.name)) return setFileError("Ese es un Excel: guardalo como CSV (Archivo → Guardar como → CSV) o copiá y pegá las celdas.");
                load(await readText(file), file.name);
              }}
            />
          </label>
          {fileError && <p className="mt-2 max-w-xs text-xs text-red-600">{fileError}</p>}
        </div>
      </div>

      {table && preview && (
        <>
          <div>
            <h3 className="text-sm font-semibold text-brand-950">¿Qué tiene cada columna?</h3>
            <p className="text-xs text-brand-900/60">Lo adivinamos por el título; corregí lo que haga falta. Las columnas en «No usar» se ignoran.</p>
            <ul className="mt-2 divide-y divide-brand-900/5 rounded-xl border border-brand-900/10">
              {table.headers.map((h, i) => {
                const samples = table.rows.map((row) => row[i]).filter(Boolean).slice(0, 3);
                return (
                  <li key={i} className="grid gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_13rem] sm:items-center">
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-medium ${columns[i] ? "text-brand-950" : "text-brand-900/50"}`}>{h || `Columna ${i + 1}`}</p>
                      <p className="truncate text-xs text-brand-900/55">{samples.length ? samples.join(" · ") : "Vacía"}</p>
                    </div>
                    <select
                      aria-label={`Dato de la columna ${h || i + 1}`}
                      value={columns[i] ?? ""}
                      onChange={(e) => {
                        const next = [...columns];
                        const value = (e.target.value || null) as ImportField | null;
                        // Cada dato va en una sola columna.
                        if (value) next.forEach((f, j) => { if (f === value) next[j] = null; });
                        next[i] = value;
                        setMapping(next);
                      }}
                      className={`w-full rounded-lg border px-2 py-1.5 text-sm ${columns[i] ? "border-brand-200 bg-brand-50 font-medium text-brand-900" : "border-brand-900/15 bg-white text-brand-900/55"}`}
                    >
                      <option value="">No usar</option>
                      {IMPORT_FIELDS.map((f) => (
                        <option key={f} value={f}>
                          {FIELD_LABELS[f]}
                        </option>
                      ))}
                    </select>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-xl bg-brand-50/60 p-4 text-sm">
            <p className="font-medium text-brand-950">
              {preview.patients.length.toLocaleString("es-AR")} pacientes con celular · {preview.visits.toLocaleString("es-AR")} visitas
              {preview.problems.length > 0 && (
                <span className="font-normal text-sun-700"> · {preview.problems.length} {preview.problems.length === 1 ? "fila" : "filas"} con problemas</span>
              )}
            </p>
            {!hasPhone && <p className="mt-1 text-red-600">Elegí qué columna tiene el celular.</p>}
            {!hasName && <p className="mt-1 text-red-600">Elegí qué columna tiene el nombre (o nombre y apellido).</p>}
            {preview.patients.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-brand-900/70">
                {preview.patients.slice(0, 3).map((p) => (
                  <li key={p.phone}>
                    {p.full_name ?? "Sin nombre"} · {displayPhone(p.phone)}
                    {p.visits.length > 0 && ` · última visita ${fmtDate(p.visits.reduce((a, v) => (v.visited_at > a ? v.visited_at : a), ""))}`}
                    {p.next_control_at && ` · control ${fmtDate(p.next_control_at)}`}
                  </li>
                ))}
              </ul>
            )}
            {preview.problems.length > 0 && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-brand-700">Ver las filas con problemas</summary>
                <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-brand-900/70">
                  {preview.problems.slice(0, 100).map((p, i) => (
                    <li key={i}>
                      Fila {p.line}: {p.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <label className="flex items-start gap-2 text-sm text-brand-900/80">
            <input type="checkbox" name="consent" required className="mt-1" />
            <span>Son pacientes de este consultorio, nos dieron su celular y se les puede escribir por sus turnos y controles.</span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button disabled={pending || !hasPhone || !hasName || preview.patients.length === 0} className={buttonClass}>
              {pending ? "Importando…" : `Importar ${preview.patients.length.toLocaleString("es-AR")} pacientes`}
            </button>
            {state?.ok === false && <p className="text-sm text-red-600">{state.message}</p>}
          </div>
        </>
      )}
    </form>
  );
}
