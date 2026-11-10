import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { FollowupError } from "./followup";
import { FOLLOWUP_STAGES, isStageKey } from "./followup-stages";
import { CLOSED_SITUATIONS, SITUATIONS, actionLabel, isSituation } from "./followup-plan";

/** Configuración comercial editable de Turnia. El motor de envíos sigue en followup-plan.ts.
 * Las etapas personalizadas sirven para filtrar/analizar y nunca alteran el orden del embudo.
 * Solo las clasificaciones canónicas verificadas por el motor pueden cambiar una situación.
 */
export const TURNIA_COMMERCIAL = [
  { key: "prospectado", label: "Prospectado", technical: ["sin-saludo"] },
  { key: "saludado", label: "Saludado", technical: ["saludo-sin-demo"] },
  { key: "demo-enviada", label: "Demo enviada", technical: ["demo-sin-abrir"] },
  { key: "demo-visitada", label: "Demo visitada", technical: ["abrio-sin-conversar"] },
  { key: "converso", label: "Conversó con Sofi", technical: ["converso-sin-cuenta"] },
  { key: "cuenta-creada", label: "Cuenta creada", technical: ["cuenta-sin-actividad"] },
  { key: "cuenta-activa", label: "Cuenta activa", technical: ["activa-sin-pago"] },
  { key: "cliente", label: "Cliente", technical: [] },
] as const;

export type CustomStage = { key: string; label: string; technical_stage: string; entry_situation: string; waiting?: number };
export type CustomState = {
  key: string; label: string; description: string; examples: string; commercial_stage: string;
  source: "whatsapp" | "manual" | "product"; product_stage: string | null;
  maps_to: string | null; active: boolean;
};
export type Override = { commercial_stage: string; key: string; label: string; description: string; examples: string; removed: boolean };

const txt = (v: unknown) => typeof v === "string" ? v.trim() : "";
const isCustom = (v: unknown) => /^custom_[a-z0-9_]{3,60}$/.test(txt(v));
const validCommercial = (key: string, custom: CustomStage[]) =>
  TURNIA_COMMERCIAL.some(s => s.key === key) || custom.some(s => s.key === key);
const fail = (message: string): never => { throw new FollowupError(message); };

export async function commercialCatalog() {
  // Degradación segura hasta que la migración haya sido aplicada en el backend real.
  // No bloquear lectura de colas ni envíos si falta SOLO este catálogo.
  let stages: CustomStage[] = [], states: CustomState[] = [], overrides: Override[] = [];
  try {
    [stages, states, overrides] = await Promise.all([
      sql<CustomStage[]>`select key,label,technical_stage,entry_situation
        from sales_followup_commercial_stages order by created_at asc limit 200`,
      sql<CustomState[]>`select key,label,description,examples,commercial_stage,source,product_stage,maps_to,active
        from sales_followup_state_catalog where removed_at is null order by created_at asc limit 500`,
      sql<Override[]>`select commercial_stage,key,label,description,examples,removed
        from sales_followup_situation_overrides order by commercial_stage,key limit 1000`,
    ]);
  } catch {
    return { available: false, stages: [], states: [], overrides: [], canonical: canonicalOptions(), actions: allowedActions() };
  }
  return { available: true, stages, states, overrides, canonical: canonicalOptions(), actions: allowedActions() };
}

const canonicalOptions = () => Object.entries(SITUATIONS).map(([key, label]) => ({
  key, label, permanent_stop: CLOSED_SITUATIONS.includes(key as keyof typeof SITUATIONS) && key !== "rechazo",
}));
const allowedActions = () => Object.fromEntries(FOLLOWUP_STAGES.map(s => [s.key, [{ key: "principal", label: actionLabel(s.key) }]]));

export async function createCommercialStage(values: Record<string, unknown>) {
  const label = txt(values.label);
  const technical = txt(values.technical_stage);
  const situation = txt(values.entry_situation);
  if (label.length < 2 || label.length > 80 || !isStageKey(technical) || !isSituation(situation))
    fail("Revisá el nombre, el paso técnico y la situación de entrada.");
  const key = "etapa_" + randomUUID();
  try {
    await sql`insert into sales_followup_commercial_stages (key,label,technical_stage,entry_situation)
      values (${key},${label},${technical},${situation})`;
  } catch { fail("No se pudo guardar esta etapa. Comprobá que no exista una etapa con esa condición."); }
  return { key };
}

export async function saveCommercialSituation(values: Record<string, unknown>, actor: string) {
  const key=txt(values.key), stage=txt(values.commercial_stage);
  const label=txt(values.label), description=txt(values.description), examples=txt(values.examples);
  const isBase = values.base === true;
  const catalog=await commercialCatalog();
  if (!catalog.available) fail("Falta aplicar la migración del catálogo comercial de Turnia.");
  if (!validCommercial(stage,catalog.stages)) fail("Etapa comercial desconocida.");
  if (label.length < 2 || label.length > 80 || description.length>800 || examples.length>2000)
    fail("Nombre, descripción o ejemplos demasiado largos o vacíos.");
  if(isBase) {
    if(!isSituation(key)) fail("La situación base no existe en Turnia.");
    // Nunca ocultar las bajas permanentes: conservarlas visibles para el operador.
    await sql`insert into sales_followup_situation_overrides
      (commercial_stage,key,label,description,examples,removed,updated_by,updated_at)
      values (${stage},${key},${label},${description},${examples},false,${actor},now())
      on conflict (commercial_stage,key) do update set
      label=excluded.label,description=excluded.description,examples=excluded.examples,
      removed=false,updated_by=excluded.updated_by,updated_at=now()`;
    return { key };
  }
  const source=txt(values.source)||"whatsapp";
  const mapsTo=txt(values.maps_to)||null;
  const productStage=source==="product"?txt(values.product_stage)||null:null;
  const active=values.active===true;
  if(!isCustom(key)) fail("La clave debe empezar con custom_.");
  if(!["whatsapp","manual","product"].includes(source)) fail("Origen de situación desconocido.");
  if(productStage) {
    const commercial=TURNIA_COMMERCIAL.find(x=>x.key===stage);
    if(!commercial || !(commercial.technical as readonly string[]).includes(productStage) || mapsTo)
      fail("La condición del producto debe pertenecer a la etapa comercial seleccionada.");
  } else if(source==="product") fail("La condición del producto es obligatoria.");
  if(mapsTo && !isSituation(mapsTo)) fail("Equivalencia de situación desconocida.");
  if(active&&!mapsTo&&!productStage) fail("Para activar la situación, elegí una equivalencia válida o condición de producto.");
  // Los descartes y bajas siempre mantienen la semántica canónica.
  if(mapsTo==="no_contactar" && source==="product") fail("No se puede automatizar una baja con actividad del producto.");
  if(values.create===true) {
    await sql`insert into sales_followup_state_catalog
      (key,commercial_stage,label,description,examples,source,product_stage,maps_to,active,updated_by)
      values (${key},${stage},${label},${description},${examples},${source},${productStage},${mapsTo},${active},${actor})`;
  } else {
    const rows=await sql<Array<{key:string}>>`update sales_followup_state_catalog set
      label=${label},description=${description},examples=${examples},source=${source},
      product_stage=${productStage},maps_to=${mapsTo},active=${active},updated_at=now(),updated_by=${actor}
      where key=${key} and commercial_stage=${stage} and removed_at is null returning key`;
    if (!rows.length) fail("La situación ya no existe en esta etapa.");
  }
  return { key };
}

export async function deleteCommercialSituation(values: Record<string, unknown>, actor: string) {
  const key=txt(values.key), stage=txt(values.commercial_stage);
  const catalog=await commercialCatalog();
  if(!validCommercial(stage,catalog.stages)) fail("Etapa comercial desconocida.");
  if(values.base===true) {
    if(!isSituation(key)) fail("Situación base desconocida.");
    if(CLOSED_SITUATIONS.includes(key as keyof typeof SITUATIONS) && key!=="rechazo")
      fail("Las bajas y los teléfonos sin canal siempre deben estar visibles.");
    await sql`insert into sales_followup_situation_overrides
      (commercial_stage,key,label,description,examples,removed,updated_by,updated_at)
      values (${stage},${key},${SITUATIONS[key as keyof typeof SITUATIONS]},'','',true,${actor},now())
      on conflict (commercial_stage,key) do update set removed=true,updated_by=excluded.updated_by,updated_at=now()`;
  } else {
    if(!isCustom(key)) fail("Situación personalizada inválida.");
    await sql`update sales_followup_state_catalog set removed_at=now(),active=false,
      updated_by=${actor},updated_at=now()
      where key=${key} and commercial_stage=${stage} and removed_at is null`;
  }
  return { key };
}
