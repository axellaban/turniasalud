import { Field, inputClass } from "@/components/ui";

export function ReviewFields({ eligibility = "sin_revisar", evidence = "", context = "" }: { eligibility?: string; evidence?: string; context?: string }) {
  return <>
    <Field label="Datos de este consultorio para Sofi (opcional)" hint="Solo para este destinatario: especialidades, motivo de contacto o detalles que Sofi deba conocer. El saludo y el guion general se editan en Configuración de Sofi. No incluyas datos de pacientes.">
      <textarea name="context" className={inputClass} maxLength={3000} rows={3} defaultValue={context} />
    </Field>
    <Field label="Habilitación del contacto" hint="Un teléfono publicado en una web no acredita permiso. Revisá No Llame antes de ofrecer servicios por teléfono.">
      <select name="eligibility" className={inputClass} defaultValue={eligibility}>
        <option value="sin_revisar">Sin revisar — no llamar</option>
        <option value="solicito_llamada">Solicitó que lo llamemos</option>
        <option value="no_llame_revisado">Revisión de No Llame y contacto completada</option>
      </select>
    </Field>
    <Field label="Fuente y fecha de la revisión" hint="Ejemplo: pedido de devolución de llamada y cuándo se recibió, o referencia de la consulta a No Llame. La revisión vence a las 24 horas.">
      <textarea name="evidence" className={inputClass} maxLength={1500} rows={2} defaultValue={evidence} />
    </Field>
    <p className="text-xs text-brand-900/70"><a href="https://nollame.aaip.gob.ar/" target="_blank" rel="noreferrer" className="underline">Registro No Llame</a> · <a href="https://www.argentina.gob.ar/noticias/registro-no-llame-la-aaip-brinda-informacion-para-garantizar-el-cumplimiento-de-la-ley" target="_blank" rel="noreferrer" className="underline">Instrucciones de la AAIP</a></p>
  </>;
}
