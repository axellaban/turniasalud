"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { Notice, buttonClass, secondaryButtonClass } from "@/components/ui";
import { parseOutreachImport } from "@/lib/sales/outreach-import";
import { displayOutreachPhone } from "@/lib/sales/outreach-messages";
import { importOutreachAction } from "../actions";

const MAX_BYTES = 3_000_000;

/** Excel guarda los CSV en Windows-1252 si no se elige UTF-8: se prueba UTF-8 y, si no es válido, latin1. */
async function readText(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export function ImportOutreachForm() {
  const [state, action, pending] = useActionState(importOutreachAction, undefined);
  const [text, setText] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const preview = useMemo(() => (text.trim() ? parseOutreachImport(text) : null), [text]);

  if (state?.ok) {
    return (
      <div className="space-y-4">
        <Notice tone="success">{state.message}</Notice>
        <Link href="/panel/prospeccion" className={buttonClass}>
          Ver a quién escribirle hoy
        </Link>
      </div>
    );
  }

  const count = (kind: string) => (preview ? preview.rows.filter((r) => r.phone_kind === kind).length : 0);
  const [phones, business, landlines] = [count("movil"), count("consultorio"), count("fijo")];
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="text" value={text} />
      <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-start">
        <label className="block text-sm">
          <span className="font-medium text-brand-900">Pegá las celdas (con la fila de títulos)</span>
          <textarea
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"nombre\tconsultorio\tzona\ttelefono\ttipo_telefono\nMaría Pérez\tConsultorio Pérez\tMar del Plata\t223 512-3456\tmovil"}
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
                setText(await readText(file));
              }}
            />
          </label>
          {fileError && <p className="mt-2 max-w-xs text-xs text-red-600">{fileError}</p>}
        </div>
      </div>

      {preview && (
        <div className="rounded-xl bg-brand-50/60 p-4 text-sm">
          <p className="font-medium text-brand-950">
            {preview.rows.length.toLocaleString("es-AR")} {preview.rows.length === 1 ? "persona" : "personas"} · {phones} con celular
            {business > 0 && ` · ${business} con el celular del consultorio`} · {landlines} con fijo
            {preview.problems.length > 0 && <span className="font-normal text-sun-700"> · {preview.problems.length} avisos</span>}
          </p>
          {preview.rows.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-brand-900/70">
              {preview.rows.slice(0, 4).map((r) => (
                <li key={r.line}>
                  {r.title ? `${r.title} ` : ""}
                  {r.name} · {r.business_name || "sin consultorio"} · {r.zone || "sin zona"} · {r.phone ? displayOutreachPhone(r.phone) : r.instagram ? `@${r.instagram}` : "sin contacto"}
                </li>
              ))}
            </ul>
          )}
          {preview.problems.length > 0 && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-brand-700">Ver los avisos</summary>
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
      )}

      <label className="flex items-start gap-2 text-sm text-brand-900">
        <input type="checkbox" name="actualizar" value="1" className="mt-1 size-4 accent-brand-600" />
        <span>
          Reemplazar los datos de los que ya están por los del archivo
          <span className="block text-xs text-brand-900/65">
            Sin marcarlo, a los que ya están solo se les completa lo que falta. El nombre, el estado y los contactos no cambian nunca.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending || !preview?.rows.length} className={buttonClass}>
          {pending ? "Importando…" : preview?.rows.length ? `Importar ${preview.rows.length.toLocaleString("es-AR")}` : "Importar"}
        </button>
        {state?.ok === false && <p className="text-sm text-red-600">{state.message}</p>}
      </div>
    </form>
  );
}
