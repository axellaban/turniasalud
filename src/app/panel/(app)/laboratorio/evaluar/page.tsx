import type { Metadata } from "next";
import { Card, Empty, Field, Notice, inputClass } from "@/components/ui";
import { getPanelClinic, requireAdmin } from "@/lib/panel-clinic";
import { pendingWork, subscriptionPrompt } from "@/lib/lab/external";
import { labApplySubscription } from "../../../lab-actions";
import { CopyBox } from "../copy-box";
import { LabForm } from "../lab-form";
import { LabHeader } from "../lab-ui";

export const metadata: Metadata = { title: "Evaluar · Laboratorio de Sofi" };
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Regla (src/lib/lab/policy.ts): el laboratorio no usa la API con clave. Evaluar se hace con la suscripción:
// se copia el pedido, se pega en Claude o ChatGPT y se pega acá la respuesta. Sin claves.
const BATCH = { simulaciones: 8, reales: 4 };

export default async function EvaluatePage() {
  await requireAdmin();
  const clinic = await getPanelClinic();
  const work = await pendingWork({ clinicId: clinic.id, ...BATCH, propuestasSoloAlFinal: true });
  const total = work.simulaciones.length + work.charlas_reales.length + work.propuestas.length;
  return (
    <>
      <LabHeader
        current="/panel/laboratorio/evaluar"
        title="Evaluar con tu suscripción"
        description="El simulador corre las charlas con Haiku (centavos, con tope) y la evaluación la hace tu Claude o tu ChatGPT con la suscripción, sin API: copiás el pedido, lo pegás en el chat y pegás acá la respuesta. ElevenLabs no se usa para pruebas."
      />
      {!total ? (
        <Empty>No hay nada para evaluar. Las charlas aparecen acá cuando el simulador termina una batería, un experimento o «Jugar de paciente», y las charlas reales cuando se cierran.</Empty>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <h2 className="font-semibold text-brand-950">1. Copiá el pedido</h2>
            <p className="mt-1 text-sm text-brand-900/70">
              Esta tanda: {work.simulaciones.length} simulaciones, {work.charlas_reales.length} charlas reales
              {work.propuestas.length ? ` y propuestas de mejora` : ""}.
              {work.quedan.simulaciones + work.quedan.charlas_reales > 0 && ` Después quedan ${work.quedan.simulaciones + work.quedan.charlas_reales} más: van en la tanda siguiente.`}
            </p>
            <p className="mt-2 text-sm text-brand-900/70">
              Pegalo en <strong>claude.ai</strong> o <strong>chatgpt.com</strong>, con tu cuenta, en un chat nuevo. Las charlas reales van sin teléfonos ni mails.
            </p>
            <div className="mt-3">
              <CopyBox text={subscriptionPrompt(work)} />
            </div>
          </Card>
          <Card>
            <h2 className="font-semibold text-brand-950">2. Pegá la respuesta</h2>
            <LabForm action={labApplySubscription} submit="Cargar la evaluación" pending="Guardando y calculando el puntaje…" className="mt-3 space-y-3">
              <Field label="¿Quién evaluó?">
                <select name="evaluador" className={inputClass} defaultValue="Claude">
                  <option>Claude</option>
                  <option>ChatGPT</option>
                </select>
              </Field>
              <Field label="La respuesta del chat" hint="Pegala entera: el panel busca el bloque JSON.">
                <textarea name="respuesta" rows={12} required className={`${inputClass} font-mono text-xs`} />
              </Field>
            </LabForm>
            <Notice className="mt-4">
              El puntaje lo calcula el panel, con los mismos pesos y controles automáticos de siempre. Lo ya evaluado no se pisa.
            </Notice>
          </Card>
        </div>
      )}
    </>
  );
}
