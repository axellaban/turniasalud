import { describe, expect, it } from "vitest";
import { salesCallBlockers } from "@/lib/sales/availability";
import type { Prospect, SalesSettings } from "@/lib/sales/service";

const budget = {today:"2026-10-24",spent:100};
const ready: SalesSettings = {agent_id:"sales",voice_id:"sofi",tool_ids:[],enabled:true,budget_date:budget.today,budget_cents:500,config_version:1,applied_at:null,needs_sync:false};
const contact: Prospect = {id:"test",business_name:"Prueba",phone:"+5491112345678",website:"https://example.org",context:"",eligibility:"solicito_llamada",evidence:"Pedido de llamada revisado hoy",reviewed_at:new Date().toISOString(),outcome:null,notes:""};

describe("Motivo concreto del bloqueo de llamadas",()=>{
  it("permite confirmar solo con todos los requisitos y revisión vigente",()=>{
    expect(salesCallBlockers(ready,budget,false,true,contact)).toEqual([]);
  });
  it("distingue pausa de cupo vencido o agotado y enlaza al paso correcto",()=>{
    const paused=salesCallBlockers({...ready,enabled:false},budget,false,true,contact);
    expect(paused).toHaveLength(1);expect(paused[0]).toMatchObject({message:"El piloto está pausado.",href:"/panel/comercial#presupuesto"});
    expect(salesCallBlockers({...ready,budget_date:"2026-10-23"},budget,false,true,contact)[0].message).toContain("venció");
    expect(salesCallBlockers({...ready,budget_cents:100},budget,false,true,contact)[0].message).toContain("reserva");
  });
  it("bloquea un contacto sin revisión, vencido o dado de baja aunque el presupuesto alcance",()=>{
    expect(salesCallBlockers(ready,budget,false,true,{...contact,eligibility:"sin_revisar"})[0].href).toBe("#contacto");
    expect(salesCallBlockers(ready,budget,false,true,{...contact,reviewed_at:new Date(Date.now()-25*3600_000).toISOString()})[0].message).toContain("venció");
    const suppressed=salesCallBlockers(ready,budget,false,true,{...contact,suppressed:true});
    expect(suppressed).toHaveLength(1);expect(suppressed[0].message).toContain("todas sus fichas");
  });
  it("explica llamada pendiente, línea ausente y configuración sin comprobar",()=>{
    expect(salesCallBlockers(ready,budget,true,true,contact)[0].href).toContain("#pendiente");
    expect(salesCallBlockers(ready,budget,false,false,contact)[0].message).toContain("línea saliente");
    expect(salesCallBlockers({...ready,needs_sync:true},budget,false,true,contact)[0].href).toBe("/panel/comercial/configuracion");
  });
});
