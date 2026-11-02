"use client";

import { useActionState, useState } from "react";
import { Badge, Card, Notice, buttonClass, secondaryButtonClass, smallButtonClass } from "@/components/ui";
import {
  extractSmileConnectJsonText,
  parseSmileConnectPayload,
  splitSmileConnectBatches,
  type SmileConnectParsed,
} from "@/lib/smile-connect-parse";
import type { SmileConnectStatus, SmileConnectSyncSummary } from "@/lib/smile-connect";
import { rotateSmileConnectTokenAction } from "../../calendar-actions";

const fmtNum = (n: number) => n.toLocaleString("es-AR");

export function SmileConnectCard({
  clinicId,
  status,
  lastSyncFormatted,
}: {
  clinicId: string;
  status: SmileConnectStatus;
  lastSyncFormatted: string | null;
}) {
  const [tokenState, tokenAction, tokenPending] = useActionState(rotateSmileConnectTokenAction, undefined);

  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<SmileConnectParsed | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [optimisticAdded, setOptimisticAdded] = useState<{ total: number; future: number; blocks: number } | null>(null);

  async function handleFile(file: File | null) {
    setParsed(null);
    setParseError(null);
    setImportResult(null);
    if (!file) {
      setFileName(null);
      return;
    }
    setFileName(file.name);
    setReading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const text = await extractSmileConnectJsonText(bytes);
      const jsonData = JSON.parse(text) as unknown;
      const result = parseSmileConnectPayload(jsonData);
      setParsed(result);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "No se pudo leer el archivo elegido.");
    } finally {
      setReading(false);
    }
  }

  async function runImport() {
    if (!parsed || importing) return;
    setImporting(true);
    setImportResult(null);
    const batches = splitSmileConnectBatches(parsed);
    const totals: SmileConnectSyncSummary = {
      patientsCreated: 0,
      patientsUpdated: 0,
      appointmentsCreated: 0,
      appointmentsUpdated: 0,
      appointmentsCancelled: 0,
      blocksCreated: 0,
      blocksUpdated: 0,
      blocksDeleted: 0,
      professionalsCreated: 0,
    };

    try {
      for (let i = 0; i < batches.length; i++) {
        setProgress(batches.length > 1 ? `Importando tanda ${i + 1} de ${batches.length}…` : "Importando agenda…");
        const res = await fetch("/api/smile-connect/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clinic_id: clinicId,
            recordImport: i === 0,
            payload: batches[i],
          }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string; summary?: SmileConnectSyncSummary };
        if (!res.ok || !data.ok || !data.summary) {
          throw new Error(data.error || `Error al importar la tanda ${i + 1}.`);
        }
        totals.patientsCreated += data.summary.patientsCreated;
        totals.patientsUpdated += data.summary.patientsUpdated;
        totals.appointmentsCreated += data.summary.appointmentsCreated;
        totals.appointmentsUpdated += data.summary.appointmentsUpdated;
        totals.appointmentsCancelled += data.summary.appointmentsCancelled;
        totals.blocksCreated += data.summary.blocksCreated;
        totals.blocksUpdated += data.summary.blocksUpdated;
        totals.blocksDeleted += data.summary.blocksDeleted;
        totals.professionalsCreated += data.summary.professionalsCreated;
      }

      const parts = [
        `${fmtNum(totals.patientsCreated)} pacientes nuevos${totals.patientsUpdated ? ` (${fmtNum(totals.patientsUpdated)} actualizados)` : ""}`,
        `${fmtNum(totals.appointmentsCreated)} turnos cargados${totals.appointmentsUpdated ? ` (${fmtNum(totals.appointmentsUpdated)} actualizados)` : ""}`,
        `${fmtNum(totals.blocksCreated)} bloqueos${totals.blocksUpdated ? ` (${fmtNum(totals.blocksUpdated)} actualizados)` : ""}`,
      ];
      setImportResult({ ok: true, message: `Listo: ${parts.join(", ")}.` });
      setOptimisticAdded((prev) => ({
        total: (prev?.total ?? status.syncedAppointments) + totals.appointmentsCreated,
        future: prev ? Math.max(prev.future, parsed.preview.appointmentsFuture) : Math.max(status.syncedFutureAppointments, parsed.preview.appointmentsFuture),
        blocks: prev ? Math.max(prev.blocks, parsed.preview.blocksFuture) : Math.max(status.syncedBlocks, parsed.preview.blocksFuture),
      }));
      setParsed(null);
    } catch (e) {
      setImportResult({ ok: false, message: e instanceof Error ? e.message : "No se pudo completar la importación." });
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  const totalAppointments = optimisticAdded?.total ?? status.syncedAppointments;
  const futureAppointments = optimisticAdded?.future ?? status.syncedFutureAppointments;
  const futureBlocks = optimisticAdded?.blocks ?? status.syncedBlocks;
  const active = status.connected || totalAppointments > 0;
  const scriptInstallUrl = `/api/smile-connect/turnia.user.js?clinic_id=${clinicId}`;
  const scriptDownloadUrl = `/api/smile-connect/turnia.user.js?clinic_id=${clinicId}&download=1`;

  return (
    <Card className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-brand-950">Smile Connect</h2>
          <p className="mt-1 text-sm text-brand-900/65">
            Integra la agenda de <code>app.smileconnect.pro</code> (pacientes, turnos, sobreturnos y bloqueos) directamente en la Agenda de Turnia, sin pisar los horarios semanales configurados para Sofi.
          </p>
        </div>
        {active && (
          <Badge tone="green">
            {status.connected ? "Sincronización activa" : "Agenda importada"}
          </Badge>
        )}
      </div>

      {active && (
        <dl className="mt-4 grid gap-3 rounded-xl bg-brand-50/50 p-3.5 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-brand-900/65">Última sincronización</dt>
            <dd className="font-medium text-brand-950">{optimisticAdded ? "Recién importado" : (lastSyncFormatted ?? "Importación manual")}</dd>
          </div>
          <div>
            <dt className="text-xs text-brand-900/65">Turnos próximos activos</dt>
            <dd className="font-medium text-brand-950">{fmtNum(futureAppointments)}</dd>
          </div>
          <div>
            <dt className="text-xs text-brand-900/65">Turnos históricos y futuros</dt>
            <dd className="font-medium text-brand-950">{fmtNum(totalAppointments)}</dd>
          </div>
          <div>
            <dt className="text-xs text-brand-900/65">Bloqueos próximos</dt>
            <dd className="font-medium text-brand-950">{fmtNum(futureBlocks)}</dd>
          </div>
        </dl>
      )}

      <div className="mt-5 grid gap-6 border-t border-brand-900/10 pt-5 lg:grid-cols-2">
        {/* Columna 1: Carga inicial desde ZIP o JSON */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-brand-950">1. Importar histórico (.zip o datos-completos.json)</h3>
          <p className="text-xs leading-relaxed text-brand-900/70">
            Elegí el archivo <code>smileconnect-historico-datos-*.zip</code> o <code>datos-completos.json</code>. Se limpia en tu navegador: descarta odontogramas y adjuntos pesados y sube solo pacientes, turnos y bloqueos (~400 KB).
          </p>

          <div>
            <label className="inline-block cursor-pointer">
              <input
                type="file"
                accept=".zip,.json,application/zip,application/json"
                onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
                disabled={reading || importing}
                className="block w-full text-xs text-brand-900/75 file:mr-3 file:cursor-pointer file:rounded-xl file:border-0 file:bg-brand-900/5 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-brand-950 hover:file:bg-brand-900/10"
              />
            </label>
          </div>

          {reading && <p className="text-xs text-brand-900/70">Leyendo {fileName} en el navegador…</p>}
          {parseError && <Notice tone="error">{parseError}</Notice>}

          {parsed && (
            <div className="space-y-3 rounded-xl border border-brand-900/10 bg-brand-50/40 p-3.5 text-xs text-brand-900">
              <p className="font-semibold text-brand-950">Vista previa de {fileName}</p>
              <ul className="space-y-1 text-brand-900/80">
                <li>
                  <b>{fmtNum(parsed.preview.patients)} pacientes</b> ({fmtNum(parsed.preview.patientsWithPhone)} con celular válido para WhatsApp).
                </li>
                <li>
                  <b>{fmtNum(parsed.preview.appointmentsFuture)} turnos futuros activos</b> ({fmtNum(parsed.preview.remindersAlreadySent)} ya tienen WhatsApp enviado en Smile Connect y no recibirán recordatorio duplicado).
                </li>
                <li>
                  <b>{fmtNum(parsed.preview.appointmentsPast)} turnos pasados</b> + {fmtNum(parsed.preview.appointmentsCancelled)} cancelados y <b>{fmtNum(parsed.preview.blocksTotal)} bloqueos</b> ({fmtNum(parsed.preview.blocksFuture)} futuros).
                </li>
                {(parsed.preview.sobreturnos > 0 || parsed.preview.duplicatesMerged > 0) && (
                  <li>
                    {parsed.preview.sobreturnos > 0 && <>Se conservan <b>{fmtNum(parsed.preview.sobreturnos)} sobreturnos reales</b>. </>}
                    {parsed.preview.duplicatesMerged > 0 && <>Se unificaron <b>{fmtNum(parsed.preview.duplicatesMerged)} turnos duplicados</b> del mismo paciente.</>}
                  </li>
                )}
                {parsed.preview.professionals.length > 0 && (
                  <li>
                    Profesionales: {parsed.preview.professionals.map((p) => p.fullName).join(", ")}.
                  </li>
                )}
              </ul>
              <p className="text-[11px] text-brand-900/65">
                No modifica los horarios semanales de atención configurados para Sofi ni envía mensajes al importar.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button type="button" onClick={() => void runImport()} disabled={importing} className={buttonClass}>
                  {importing ? (progress ?? "Importando…") : "Importar agenda en Turnia"}
                </button>
              </div>
            </div>
          )}

          {importResult && (
            <Notice tone={importResult.ok ? "success" : "error"}>{importResult.message}</Notice>
          )}
        </div>

        {/* Columna 2: Sincronización continua con Tampermonkey */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-brand-950">2. Sincronización continua (Tampermonkey)</h3>
          <p className="text-xs leading-relaxed text-brand-900/70">
            Instalalo en la computadora donde recepción usa <code>app.smileconnect.pro</code>. Mientras la pestaña esté abierta, cada 10 minutos copia turnos nuevos, reprogramaciones, cancelaciones, asistencias y bloqueos a Turnia.
          </p>
          <ol className="list-decimal space-y-1 pl-4 text-xs text-brand-900/80">
            <li>Instalá la extensión gratuita <b>Tampermonkey</b> en Chrome o Edge.</li>
            <li>Tocá <b>«Instalar en Tampermonkey»</b>: ya viene configurado con la dirección y la clave secreta de esta clínica{status.tokenHint ? ` (…${status.tokenHint})` : ""}.</li>
            <li>Abrí <code>app.smileconnect.pro</code> y aceptá el permiso de conexión cuando Tampermonkey lo pregunte una sola vez.</li>
          </ol>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <a href={scriptInstallUrl} className={buttonClass}>
              Instalar en Tampermonkey
            </a>
            <a href={scriptDownloadUrl} className={secondaryButtonClass}>
              Descargar .user.js
            </a>
            {status.connected && (
              <form action={tokenAction}>
                <input type="hidden" name="clinic_id" value={clinicId} />
                <input type="hidden" name="rotate" value="1" />
                <button disabled={tokenPending} className={smallButtonClass}>
                  {tokenPending ? "Renovando…" : "Cambiar clave"}
                </button>
              </form>
            )}
          </div>

          {tokenState?.message && (
            <Notice tone={tokenState.ok ? "success" : "error"}>{tokenState.message}</Notice>
          )}
        </div>
      </div>
    </Card>
  );
}
