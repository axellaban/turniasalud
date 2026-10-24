import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

const mocks = vi.hoisted(() => ({ admin: true }));
vi.mock("@/lib/panel-clinic", () => ({ requireAdmin: async () => { if (!mocks.admin) throw new Error("admin requerido"); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn() }));

import { closeDb, sql } from "@/lib/db";
import { authorizeBudget, blockProspect, dialProspect, recordSalesConversation, refreshSalesCall, runSalesTool, salesPhone, saveProspect } from "@/lib/sales/service";
import { salesAgentBody, setupSalesAgent, verifySalesAgent } from "@/lib/sales/agent";
import { salesAction } from "@/app/panel/(app)/comercial/actions";
import { POST as toolPost } from "@/app/api/comercial/tools/[name]/route";
import { POST as postCall } from "@/app/api/elevenlabs/post-call/route";

const base = testDatabaseUrl();
let outbound = 0;
let lost = false;
let noAnswer = false;
let moderatedVoice = false;
let recoverAgent = false;
let remote = salesAgentBody("voz-agustin",["sales-tool-1","sales-tool-2"]);
let sent: { conversation_initiation_client_data: { dynamic_variables: Record<string,string> }; agent_id: string; to_number: string };
const providerRequests: string[] = [];
function response(data: unknown) { return new Response(JSON.stringify(data), { headers: { "content-type":"application/json" } }); }
function eventData() {
  return { agent_id: "agent-sales", conversation_id: "conv_sales", status: "done", transcript: [{ role:"user", message: "Quiero probar una demo." }], metadata: { call_duration_secs:48,cost:123 }, analysis:{ transcript_summary:"Pidió demo y charla con Axel" }, conversation_initiation_client_data: sent.conversation_initiation_client_data };
}
async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const path = new URL(String(input)).pathname;
  providerRequests.push(`${init.method ?? "GET"} ${path}`);
  if (path === "/v1/convai/twilio/outbound-call") {
    outbound++; sent = JSON.parse(String(init.body));
    if (lost) throw new Error("timeout después de enviar");
    if (noAnswer) return response({ success:false });
    return response({ success:true,conversation_id:"conv_sales" });
  }
  if (path === "/v1/convai/conversations/conv_sales") return response(eventData());
  if (path === "/v2/voices") return response({ voices:[{voice_id:"voz-agustin",name:"Agustin De Angelis - Confident and Happy",sharing:{live_moderation_enabled:moderatedVoice}}] });
  if (path === "/v1/convai/tools" && !init.method) return response({tools:[]});
  if (path === "/v1/convai/tools" && init.method === "POST") return response({id:providerRequests.filter((s)=>s === "POST /v1/convai/tools").length === 1 ? "sales-tool-1" : "sales-tool-2"});
  if (path === "/v1/convai/agents/create") { remote = JSON.parse(String(init.body)); return response({ agent_id:"agent-sales" }); }
  if (path === "/v1/convai/agents") return response({agents:recoverAgent ? [{agent_id:"agent-sales",name:remote.name}] : []});
  if (path === "/v1/convai/agents/agent-sales") return response(remote);
  throw new Error(`fetch inesperado ${path}`);
}

describe.skipIf(!base)("Piloto comercial: permisos, gasto, bajas y aislamiento", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = await scratchDatabase(base!,"turnia_sales_test");
    process.env.AGENT_TOOLS_SECRET = "secreto-solo-test";
    process.env.ELEVENLABS_API_KEY = "clave-falsa";
    process.env.ELEVENLABS_PHONE_NUMBER_ID = "phnum-turnia";
    process.env.ELEVENLABS_WEBHOOK_SECRET = "firma-solo-test";
    await resetTestDatabase(process.env.DATABASE_URL);
  });
  beforeEach(async () => {
    await sql`truncate sales_suppressions,sales_calls,sales_prospects`;
    await sql`update sales_settings set agent_id='agent-sales',voice_id='voz-agustin',tool_ids=array['sales-tool-1','sales-tool-2'],enabled=false,budget_cents=0,budget_date=null where id=1`;
    outbound=0; lost=false; noAnswer=false; moderatedVoice=false; recoverAgent=false; mocks.admin=true; providerRequests.length=0;
    remote=salesAgentBody("voz-agustin",["sales-tool-1","sales-tool-2"]);
    vi.stubGlobal("fetch",fakeFetch);
  });
  afterAll(async () => { await closeDb(); vi.unstubAllGlobals(); });

  const prospect = () => saveProspect({ business_name:"Odontología de prueba",phone:"+54 9 11 1234 5678",website:"https://consultorio.example",context:"Ofrece odontología general",eligibility:"solicito_llamada",evidence:"Solicitó hoy una devolución de llamada; prueba local." });

  it("arranca sin gasto y bloquea antes de consultar al proveedor",async()=>{
    const id=await prospect();
    await expect(dialProspect(id,randomUUID())).rejects.toThrow("pausado");
    expect(outbound).toBe(0); expect(providerRequests).toHaveLength(0);
  });
  it("rechaza autorizaciones vencidas y contactos sin revisar",async()=>{
    const id=await prospect(); await authorizeBudget(100,true);
    await sql`update sales_settings set budget_date=current_date-2`;
    await expect(dialProspect(id,randomUUID())).rejects.toThrow("venció");
    await authorizeBudget(100,true); await sql`update sales_prospects set eligibility='sin_revisar' where id=${id}`;
    await expect(dialProspect(id,randomUUID())).rejects.toThrow("revisar");
    expect(outbound).toBe(0);
  });
  it("un envío repetido/concurrente solo llama una vez y manda todas las variables",async()=>{
    const id=await prospect(); await authorizeBudget(100,true); const key=randomUUID();
    const ids=await Promise.all([dialProspect(id,key),dialProspect(id,key)]);
    expect(ids[0]).toBe(ids[1]); expect(outbound).toBe(1);
    expect(sent.agent_id).toBe("agent-sales"); expect(sent.to_number).toBe("+5491112345678");
    expect(Object.keys(sent.conversation_initiation_client_data.dynamic_variables).sort()).toEqual(["business_name","sales_call_id","sales_call_token","sales_context"]);
    expect(Object.values(sent.conversation_initiation_client_data.dynamic_variables).every(Boolean)).toBe(true);
    await expect(dialProspect(id,randomUUID())).rejects.toThrow("pendiente");
    await refreshSalesCall(ids[0]);
    await expect(dialProspect(id,randomUUID())).rejects.toThrow("cupo");
    expect(outbound).toBe(1);
  });
  it("dos confirmaciones distintas simultáneas no exceden una llamada activa",async()=>{
    const id=await prospect(); await authorizeBudget(200,true);
    const results=await Promise.allSettled([dialProspect(id,randomUUID()),dialProspect(id,randomUUID())]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1); expect(outbound).toBe(1);
  });
  it("si se pierde la confirmación conserva la reserva y no reintenta",async()=>{
    const id=await prospect(); await authorizeBudget(200,true); lost=true;
    const callId=await dialProspect(id,randomUUID());
    const [c]=await sql`select status,reserved_cents from sales_calls where id=${callId}`;
    expect(c.status).toBe("incierta"); expect(c.reserved_cents).toBe(100);
    await expect(dialProspect(id,randomUUID())).rejects.toThrow("pendiente"); expect(outbound).toBe(1);
  });
  it("no llama si el proveedor cambió el límite o agregó herramientas clínicas",async()=>{
    const id=await prospect(); await authorizeBudget(200,true);
    remote.conversation_config.conversation.max_duration_seconds=1200;
    await dialProspect(id,randomUUID()); expect(outbound).toBe(0);
    remote=salesAgentBody("voz-agustin",["sales-tool-1","sales-tool-2","reservar_turno"]);
    await expect(verifySalesAgent("agent-sales","voz-agustin",["sales-tool-1","sales-tool-2"])).rejects.toThrow("cambió");
  });
  it("la baja se guarda antes de confirmar y bloquea las fichas duplicadas",async()=>{
    const id=await prospect(); await authorizeBudget(300,true); await dialProspect(id,randomUUID());
    const vars=sent.conversation_initiation_client_data.dynamic_variables;
    await expect(runSalesTool("registrar_baja_comercial",{...vars,sales_call_token:"a".repeat(64),reason:"No llamar"})).rejects.toThrow("inválida");
    expect(await runSalesTool("registrar_baja_comercial",{...vars,reason:"No recibir más llamadas"})).toMatchObject({ok:true});
    const duplicate=await prospect();
    await expect(dialProspect(duplicate,randomUUID())).rejects.toThrow("no recibir");
    expect((await sql`select * from sales_suppressions`)).toHaveLength(1);
  });
  it("webhook firmado comercial idempotente no crea pacientes y rescata una baja no ejecutada",async()=>{
    const id=await prospect(); await authorizeBudget(100,true); await dialProspect(id,randomUUID());
    const [{n:before}]=await sql`select count(*)::int as n from patients`;
    const data=eventData(); data.transcript=[{role:"user",message:"No me llamen más, por favor"}];
    const raw=JSON.stringify({type:"post_call_transcription",data}); const t=String(Math.floor(Date.now()/1000));
    const sig=`t=${t},v0=${createHmac("sha256",process.env.ELEVENLABS_WEBHOOK_SECRET!).update(`${t}.${raw}`).digest("hex")}`;
    for(let i=0;i<2;i++) expect((await postCall(new Request("http://localhost/api/elevenlabs/post-call",{method:"POST",body:raw,headers:{"elevenlabs-signature":sig}}))).status).toBe(200);
    expect((await sql`select count(*)::int as n from patients`)[0].n).toBe(before);
    expect(await sql`select * from sales_calls`).toHaveLength(1);
    expect((await sql`select outcome from sales_calls`)[0].outcome).toBe("baja");
    expect(await sql`select * from sales_suppressions`).toHaveLength(1);
    expect(await recordSalesConversation({agent_id:"agent-sales",conversation_id:"desconocida"})).toBe(true);
    expect((await toolPost(new Request("http://localhost/api/comercial/tools/registrar_baja_comercial",{method:"POST",body:"{}"}),{params:Promise.resolve({name:"registrar_baja_comercial"})})).status).toBe(401);
  });
  it("baja manual persiste, acciones exigen administrador y no aceptan llamadas sin confirmar",async()=>{
    const id=await prospect(); await blockProspect(id); await authorizeBudget(100,true);
    await expect(dialProspect(id,randomUUID())).rejects.toThrow("no recibir");
    const form=new FormData();form.set("intent","dial");form.set("id",id);form.set("request_key",randomUUID());
    expect(await salesAction({},form)).toMatchObject({error:expect.stringContaining("Confirmá")});
    mocks.admin=false; await expect(salesAction({},form)).rejects.toThrow("admin requerido"); expect(outbound).toBe(0);
  });
  it("preparar crea solo Agustín, no compra números ni llama ni modifica Sofi",async()=>{
    await sql`update sales_settings set agent_id=null,voice_id=null,tool_ids='{}' where id=1`;
    await setupSalesAgent();
    expect(providerRequests.filter(s=>s.startsWith("POST"))).toEqual(["POST /v1/convai/tools","POST /v1/convai/tools","POST /v1/convai/agents/create"]);
    expect(remote.conversation_config.conversation.max_duration_seconds).toBe(60);
    expect(remote.platform_settings.call_limits.agent_concurrency_limit).toBe(1);
    expect(remote.platform_settings.privacy.record_voice).toBe(false);
    expect(remote.platform_settings).not.toHaveProperty("analysis_llm");
    expect((await sql`select enabled,budget_cents from sales_settings where id=1`)[0]).toMatchObject({enabled:false,budget_cents:0});
    expect(outbound).toBe(0);
  });
  it("normaliza sin adivinar números y rechaza formatos ambiguos",()=>{
    expect(salesPhone("00549 11 1234-5678")).toBe("+5491112345678");
    expect(()=>salesPhone("01112345678")).toThrow();
  });
  it("rechaza la voz con moderación antes de crear herramientas/agente y sin cambiarla por otra",async()=>{
    moderatedVoice=true;
    await expect(setupSalesAgent("voz-agustin")).rejects.toThrow("moderación");
    expect(providerRequests.filter(s=>s.startsWith("POST"))).toHaveLength(0);
    expect(outbound).toBe(0);
  });
  it("recupera un agente ya creado antes de repetir un POST de creación",async()=>{
    await sql`update sales_settings set agent_id=null where id=1`;
    recoverAgent=true;
    await setupSalesAgent("voz-agustin");
    expect(providerRequests).not.toContain("POST /v1/convai/agents/create");
    expect(providerRequests).toContain("PATCH /v1/convai/agents/agent-sales");
    expect((await sql`select agent_id from sales_settings where id=1`)[0].agent_id).toBe("agent-sales");
  });
});
