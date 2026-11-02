"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { importPatientsAction } from "../../../campaign-actions";
import {
  FIELD_LABELS,
  IMPORT_FIELDS,
  buildImport,
  derivedColumnNote,
  detectMapping,
  parseTable,
  suggestAreaCode,
  type ColumnMapping,
  type ImportField,
  type SharedPhone,
} from "@/lib/patient-import";
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
  // null: el que sugiere la planilla. Las filas de un celular compartido que el consultorio corrigió.
  const [area, setArea] = useState<string | null>(null);
  const [sameAs, setSameAs] = useState<Record<number, number>>({});
  const table = useMemo(() => (text.trim() ? parseTable(text) : null), [text]);
  const columns = useMemo(
    () => (mapping && table && mapping.length === table.headers.length ? mapping : table ? detectMapping(table.headers) : []),
    [mapping, table],
  );
  const suggested = useMemo(() => (table ? suggestAreaCode(table, columns) : null), [table, columns]);
  const areaCode = area ?? suggested ?? "";
  const preview = useMemo(() => (table ? buildImport(table, columns, { areaCode, sameAs }) : null), [table, columns, areaCode, sameAs]);
  const hasPhone = columns.includes("phone");
  const hasName = columns.includes("full_name") || columns.includes("first_name");
  const families = preview ? preview.shared.filter((g) => g.rows.some((r) => r.sameAs === null && r !== g.rows[0])).length : 0;
  const warnings = preview?.problems.filter((p) => !p.skipped) ?? [];
  const skipped = preview?.problems.filter((p) => p.skipped) ?? [];

  const load = (value: string, name: string) => {
    setText(value);
    setSource(name);
    setMapping(null);
    setArea(null);
    setSameAs({});
  };

  if (state?.ok && state.summary) {
    const s = state.summary;
    return (
      <div className="space-y-4">
        <Notice tone="success">{state.message}</Notice>
        <ul className="space-y-1 text-sm text-brand-900/75">
          <li>{s.created} fichas nuevas y {s.existing} que ya estaban (solo completamos los datos que les faltaban).</li>
          <li>{s.visits} visitas guardadas para calcular controles e inactivos.</li>
          {s.sharedPhones > 0 && <li>{s.sharedPhones} celulares compartidos por una familia: cada persona quedó con su ficha.</li>}
          {s.withoutPhone > 0 && <li>{s.withoutPhone} fichas sin celular que sirva: están en Pacientes, pero no se les puede escribir hasta cargarlo.</li>}
          {s.skipped > 0 && <li>{s.skipped} filas sin importar (sin nombre ni celular).</li>}
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
      <input type="hidden" name="area_code" value={areaCode} />
      <input type="hidden" name="same_as" value={JSON.stringify(sameAs)} />

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
                const derived = !columns[i] ? derivedColumnNote(h) : null;
                return (
                  <li key={i} className="grid gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_13rem] sm:items-center">
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-medium ${columns[i] ? "text-brand-950" : "text-brand-900/50"}`}>{h || `Columna ${i + 1}`}</p>
                      <p className="truncate text-xs text-brand-900/55">{samples.length ? samples.join(" · ") : "Vacía"}</p>
                      {derived && <p className="text-xs text-brand-700">{derived}</p>}
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

          {hasPhone && (
            <label className="block max-w-md text-sm">
              <span className="font-medium text-brand-900">Código de área de los celulares que vienen sin él</span>
              <span className="block text-xs text-brand-900/60">
                Por ejemplo, 11. Con él, «4555-0123» queda como 11 4555-0123.{" "}
                {suggested && area === null ? "Lo sugerimos por los demás números de la planilla." : "Vacío: esos números entran en las notas."}
              </span>
              <input
                value={areaCode}
                onChange={(e) => setArea(e.target.value.replace(/\D/g, "").slice(0, 4))}
                inputMode="numeric"
                placeholder="11"
                className="mt-1 w-24 rounded-lg border border-brand-900/15 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500"
              />
            </label>
          )}

          <div className="rounded-xl bg-brand-50/60 p-4 text-sm">
            <p className="font-medium text-brand-950">
              {preview.patients.length.toLocaleString("es-AR")} pacientes · {preview.visits.toLocaleString("es-AR")} visitas
              {preview.withoutPhone > 0 && <span className="font-normal text-brand-900/70"> · {preview.withoutPhone} sin celular que sirva</span>}
              {preview.completedPhones > 0 && (
                <span className="font-normal text-brand-900/70"> · {preview.completedPhones} celulares completados con el {areaCode}</span>
              )}
              {families > 0 && <span className="font-normal text-brand-900/70"> · {families} celulares de una familia</span>}
              {skipped.length > 0 && <span className="font-normal text-sun-700"> · {skipped.length} {skipped.length === 1 ? "fila" : "filas"} sin importar</span>}
            </p>
            {!hasName && <p className="mt-1 text-red-600">Elegí qué columna tiene el nombre (o nombre y apellido).</p>}
            {!hasPhone && <p className="mt-1 text-sun-700">No hay una columna de celular: los pacientes entran sin celular y no se les puede escribir.</p>}
            {preview.patients.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-brand-900/70">
                {preview.patients.slice(0, 3).map((p) => (
                  <li key={p.key}>
                    {p.full_name ?? "Sin nombre"} · {p.phone ? displayPhone(p.phone) : "sin celular"}
                    {p.visits.length > 0 && ` · última visita ${fmtDate(p.visits.reduce((a, v) => (v.visited_at > a ? v.visited_at : a), ""))}`}
                    {p.next_control_at && ` · control ${fmtDate(p.next_control_at)}`}
                  </li>
                ))}
              </ul>
            )}
            {preview.shared.length > 0 && (
              <SharedPhones
                groups={preview.shared}
                onChange={(line, target) => setSameAs((prev) => ({ ...prev, [line]: target }))}
              />
            )}
            {warnings.length > 0 && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-brand-700">
                  Ver {warnings.length} {warnings.length === 1 ? "aviso" : "avisos"} (las filas entran igual)
                </summary>
                <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-brand-900/70">
                  {warnings.slice(0, 200).map((p, i) => (
                    <li key={i}>
                      Fila {p.line}: {p.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {skipped.length > 0 && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-brand-700">Ver las filas que no se importan</summary>
                <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-brand-900/70">
                  {skipped.slice(0, 100).map((p, i) => (
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
            <button disabled={pending || !hasName || preview.patients.length === 0} className={buttonClass}>
              {pending ? "Importando…" : `Importar ${preview.patients.length.toLocaleString("es-AR")} pacientes`}
            </button>
            {state?.ok === false && <p className="text-sm text-red-600">{state.message}</p>}
          </div>
        </>
      )}
    </form>
  );
}

/**
 * Celulares con más de una fila: si es la misma persona escrita de dos maneras se junta en una ficha;
 * si es una familia, cada uno queda con la suya. Lo adivinamos (DNI, fecha de nacimiento, nombre) y el
 * consultorio lo corrige fila por fila.
 */
function SharedPhones({ groups, onChange }: { groups: SharedPhone[]; onChange: (line: number, target: number) => void }) {
  const merged = groups.reduce((n, g) => n + g.rows.filter((r) => r.sameAs !== null).length, 0);
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-brand-700">
        Revisar {groups.length} {groups.length === 1 ? "celular que aparece" : "celulares que aparecen"} en más de una fila
        {merged > 0 && ` (${merged} ${merged === 1 ? "fila se junta" : "filas se juntan"} con la misma persona)`}
      </summary>
      <p className="mt-1 text-brand-900/65">
        Una familia con un mismo celular queda en fichas aparte. Si es la misma persona escrita de dos maneras, elegí con quién se junta.
      </p>
      <ul className="mt-2 max-h-96 space-y-2 overflow-y-auto">
        {groups.map((g) => (
          <li key={g.phone} className="rounded-lg border border-brand-900/10 bg-white p-2">
            <p className="font-medium text-brand-950">{displayPhone(g.phone)}</p>
            <ul className="mt-1 space-y-1">
              {g.rows.map((r, i) => (
                <li key={r.line} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-center">
                  <span className="min-w-0">
                    <span className="font-medium text-brand-900">{r.name ?? "Sin nombre"}</span>
                    <span className="text-brand-900/60"> · fila {r.line} · {r.detail}</span>
                  </span>
                  {i === 0 ? (
                    <span className="text-brand-900/60">Su ficha</span>
                  ) : (
                    <select
                      aria-label={`¿Quién es ${r.name ?? `la fila ${r.line}`}?`}
                      value={String(r.sameAs ?? 0)}
                      onChange={(e) => onChange(r.line, Number(e.target.value))}
                      className="w-full rounded-lg border border-brand-900/15 bg-white px-2 py-1 text-xs"
                    >
                      <option value="0">Otra persona: ficha aparte</option>
                      {g.rows.slice(0, i).map((o) => (
                        <option key={o.line} value={o.line}>
                          La misma que {o.name ?? `la fila ${o.line}`}
                        </option>
                      ))}
                    </select>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </details>
  );
}
