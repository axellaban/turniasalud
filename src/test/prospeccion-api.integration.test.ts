import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// La prospección operada desde el panel de Chapa Labs (/prospecting): pide la clave, aplica las
// mismas reglas que Panel → Prospección (saludo sin toque, tres mensajes, la baja para siempre),
// vuelve a copiar la planilla y devuelve la fila con las columnas de la pestaña «Prospección»,
// incluida la clínica de la demo y si conversó con Sofi.

const mocks = vi.hoisted(() => ({ after: [] as Array<() => unknown> }));
vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn(async () => {}) }));
vi.mock("@/lib/analytics-server", () => ({ captureLater: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => mocks.after.push(fn),
}));

const base = testDatabaseUrl();
const SECRET = "p".repeat(40);

describe.runIf(base)("API de prospección para Chapa Labs", () => {
  let sql: typeof import("@/lib/db").sql;
  let route: typeof import("@/app/api/prospeccion/route");
  const post = async (body: unknown, auth = `Bearer ${SECRET}`) => {
    const res = await route.POST(new Request("https://turnia.example/api/prospeccion", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  const col = (r: { header: string[]; row: unknown[] }, name: string) => r.row[r.header.indexOf(name)];

  beforeAll(async () => {
    const url = await scratchDatabase(base!, "turnia_test_prospeccion_api");
    await resetTestDatabase(url);
    for (const [key, value] of Object.entries({ DATABASE_URL: url, METRICS_SECRET: SECRET })) vi.stubEnv(key, value);
    ({ sql } = await import("@/lib/db"));
    route = await import("@/app/api/prospeccion/route");
    await sql`insert into sales_outreach (code, name, greeting, phone, phone_kind, status) values
      ('ana-111', 'Ana Prueba', 'Ana', '+5492235000001', 'movil', 'por_contactar'),
      ('beto-222', 'Beto Prueba', 'Beto', '+5492235000002', 'movil', 'por_contactar')`;
  }, 60000);

  afterAll(async () => {
    await (await import("@/lib/db")).closeDb();
    vi.unstubAllEnvs();
  });

  it("sin la clave no hace nada", async () => {
    expect((await post({ code: "ana-111", action: { type: "sent" } }, "Bearer otra")).status).toBe(401);
    expect((await post({ code: "ana-111", action: { type: "sent" } }, "")).status).toBe(401);
  });

  it("el primer WhatsApp es el saludo; el segundo, la demo, y copia la planilla", async () => {
    mocks.after.length = 0;
    let r = await post({ code: "ana-111", action: { type: "sent", channel: "whatsapp", template: "whatsapp_saludo" } });
    expect(r.status).toBe(200);
    expect(col(r.body, "Estado")).toBe("Contactado");
    expect(col(r.body, "Mensajes")).toBe(0);
    expect(col(r.body, "Saludo enviado")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(mocks.after.length).toBeGreaterThan(0);
    // El mismo saludo confirmado otra vez es un reintento: no suma.
    r = await post({ code: "ana-111", action: { type: "sent", channel: "whatsapp", template: "whatsapp_saludo" } });
    expect(col(r.body, "Mensajes")).toBe(0);
    // Respondió enseguida: la demo sale un minuto después del saludo y sí cuenta.
    r = await post({ code: "ana-111", action: { type: "sent", channel: "whatsapp", template: "whatsapp_1" } });
    expect(col(r.body, "Mensajes")).toBe(1);
    r = await post({ code: "ana-111", action: { type: "sent", channel: "whatsapp", template: "whatsapp_1" } });
    expect(col(r.body, "Mensajes")).toBe(1);
    expect(r.body.header).toContain("Clínica de la demo");
    expect(r.body.header).toContain("Conversó en la demo");
  });

  it("un audio a mano cuenta como mensaje, salvo que ese día ya haya salido uno, y queda en «Audio enviado»", async () => {
    await sql`insert into sales_outreach (code, name, greeting, phone, phone_kind, status, touches, greeted_at, first_contact_at)
              values ('audio-444', 'Audio Prueba', 'Audio', '+5492235000044', 'movil', 'contactado', 1, now() - interval '3 days', now() - interval '3 days')`;
    let r = await post({ code: "audio-444", action: { type: "sent", channel: "whatsapp", format: "audio" } });
    expect(r.status).toBe(200);
    expect(col(r.body, "Mensajes")).toBe(2);
    expect(col(r.body, "Audio enviado")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    // El mismo día, otro audio (o el texto ya registrado) no suma otro mensaje.
    r = await post({ code: "audio-444", action: { type: "sent", channel: "whatsapp", format: "audio" } });
    expect(col(r.body, "Mensajes")).toBe(2);
    // Sin audio, la columna queda vacía.
    r = await post({ code: "beto-222", action: { type: "note", text: "sin audio" } });
    expect(col(r.body, "Audio enviado")).toBe("");
  });

  it("en lote, con «step», registrar el mismo paso dos veces no suma nada", async () => {
    await sql`insert into sales_outreach (code, name, greeting, phone, phone_kind, status) values ('lote-333', 'Lote Prueba', 'Lote', '+5492235000033', 'movil', 'por_contactar')`;
    for (const step of [0, 1, 2, 0, 1, 2]) {
      const r = await post({ code: "lote-333", action: { type: "sent", channel: "whatsapp", step } });
      expect(r.status).toBe(200);
    }
    const r = await post({ code: "lote-333", action: { type: "note", text: "lote" } });
    expect(col(r.body, "Mensajes")).toBe(2);
    expect(col(r.body, "Saludo enviado")).toMatch(/^\d{4}-/);
  });

  it("estados, notas, próximo paso y deshacer", async () => {
    let r = await post({ code: "ana-111", action: { type: "outcome", outcome: "interesado", detail: "quiere verla el martes" } });
    expect(col(r.body, "Estado")).toBe("Respondió");
    r = await post({ code: "ana-111", action: { type: "schedule", nextAt: "2026-11-10", nextStep: "Reunión" } });
    expect(String(col(r.body, "Próximo paso"))).toContain("2026-11-10");
    // Como en el panel, la nota va a la historia de la persona.
    r = await post({ code: "ana-111", action: { type: "note", text: "Prefiere a la tarde" } });
    expect(r.status).toBe(200);
    const notes = await sql<Array<{ detail: string }>>`select e.detail from sales_outreach_events e join sales_outreach o on o.id = e.outreach_id where o.code = 'ana-111' and e.kind = 'nota'`;
    expect(notes.map((n) => n.detail)).toEqual(expect.arrayContaining(["Prefiere a la tarde", "Próximo paso: Reunión"]));
    r = await post({ code: "beto-222", action: { type: "sent", channel: "whatsapp" } });
    r = await post({ code: "beto-222", action: { type: "undo" } });
    expect(col(r.body, "Estado")).toBe("Por contactar");
    expect(col(r.body, "Saludo enviado")).toBe("");
  });

  it("la baja es para siempre y los errores de las reglas vuelven como 422", async () => {
    let r = await post({ code: "beto-222", action: { type: "outcome", outcome: "baja" } });
    expect(col(r.body, "Estado")).toBe("Pidió no recibir más");
    r = await post({ code: "beto-222", action: { type: "sent", channel: "whatsapp" } });
    expect(r.status).toBe(422);
    expect((await post({ code: "ana-111", action: { type: "demo" } })).status).toBe(422);
    expect((await post({ code: "nadie-000", action: { type: "note", text: "x" } })).status).toBe(404);
  });

  it("trae la clínica de su demo y si conversó con Sofi", async () => {
    const [lead] = await sql<Array<{ id: string }>>`insert into leads (name, email) values ('Ana', 'ana@example.test') returning id`;
    await sql`update sales_outreach set lead_id = ${lead.id}, demo_at = now() where code = 'ana-111'`;
    const [clinic] = await sql<Array<{ id: string }>>`select id from clinics limit 1`;
    await sql`insert into demo_sessions (phone, chat_id, website, status, clinic_id, lead_id, created_at)
              values ('+5492235000001', 'c-ana', 'https://ana.example', 'chat', ${clinic.id}, ${lead.id}, '2026-11-03T13:00:00Z')`;
    let r = await post({ code: "ana-111", action: { type: "note", text: "probó" } });
    expect(col(r.body, "Clínica de la demo")).toBe("2026-11-03 10:00");
    // Abrió la llamada y Sofi saludó, pero no dijo nada: no conversó.
    await sql`insert into conversations (clinic_id, started_at, transcript) values (${clinic.id}, '2026-11-03T13:05:00Z', ${sql.json([{ role: "agent", message: "¡Hola! Soy Sofi." }, { role: "user", message: "" }])})`;
    r = await post({ code: "ana-111", action: { type: "note", text: "solo el saludo" } });
    expect(col(r.body, "Conversó en la demo")).toBe("");
    await sql`insert into conversations (clinic_id, started_at, transcript) values (${clinic.id}, '2026-11-03T13:08:00Z', ${sql.json([{ role: "agent", message: "¡Hola! Soy Sofi." }, { role: "user", message: "Quiero un turno" }])})`;
    r = await post({ code: "ana-111", action: { type: "note", text: "conversó" } });
    expect(col(r.body, "Conversó en la demo")).toBe("2026-11-03 10:08");
  });

  it("lee y guarda los mensajes, sin tocar los demás ni las metas", async () => {
    const get = async () => (await route.GET(new Request("https://turnia.example/api/prospeccion", { headers: { authorization: `Bearer ${SECRET}` } }))).json();
    const before = await get();
    expect(before.templates.map((t: { key: string }) => t.key)).toContain("whatsapp_saludo");
    expect(before.weeklyGoal).toBe(250);
    const r = await post({ templates: { whatsapp_saludo: "¡Hola! ¿Hablo con {saludo}?" } });
    expect(r.status).toBe(200);
    const after = await get();
    const text = (k: string, x: { templates: Array<{ key: string; text: string }> }) => x.templates.find((t) => t.key === k)?.text;
    expect(text("whatsapp_saludo", after)).toBe("¡Hola! ¿Hablo con {saludo}?");
    expect(text("whatsapp_1", after)).toBe(text("whatsapp_1", before));
    expect((await post({ templates: { no_existe: "x" } })).status).toBe(422);
    expect((await post({ templates: { whatsapp_1: "  " } })).status).toBe(422);
    expect((await route.GET(new Request("https://turnia.example/api/prospeccion"))).status).toBe(401);
  });

  it("guarda las metas del embudo: la semanal de saludos es la del panel", async () => {
    const get = async () => (await route.GET(new Request("https://turnia.example/api/prospeccion", { headers: { authorization: `Bearer ${SECRET}` } }))).json();
    expect((await get()).funnelRates).toEqual({});
    const r = await post({ funnel: { perWeek: 300, rates: { demos: 0.2, llamadas: 0.6 } } });
    expect(r.status).toBe(200);
    const after = await get();
    expect(after.weeklyGoal).toBe(300);
    expect(after.funnelRates).toEqual({ demos: 0.2, llamadas: 0.6 });
    const [settings] = await sql<Array<{ outreach_weekly_goal: number }>>`select outreach_weekly_goal from sales_settings where id = 1`;
    expect(settings.outreach_weekly_goal).toBe(300);
    expect((await post({ funnel: { perWeek: 0, rates: {} } })).status).toBe(422);
    expect((await post({ funnel: { perWeek: 250, rates: { demos: 1.5 } } })).status).toBe(422);
  });

  it("vincula la cuenta real que se le dio y la marca activa si su clínica tiene turnos", async () => {
    const [clinic] = await sql<Array<{ id: string; name: string }>>`insert into clinics (name, is_demo) values ('Clínica Real Prueba', false) returning id, name`;
    const [demo] = await sql<Array<{ id: string }>>`insert into clinics (name, is_demo) values ('Clínica Demo', true) returning id`;
    expect((await post({ code: "ana-111", action: { type: "account", clinicId: demo.id } })).status).toBe(422);
    expect((await post({ code: "ana-111", action: { type: "account", clinicId: "no-es-un-id" } })).status).toBe(422);
    let r = await post({ code: "ana-111", action: { type: "account", clinicId: clinic.id } });
    expect(r.status).toBe(200);
    expect(col(r.body, "Clínica de la cuenta")).toBe("Clínica Real Prueba");
    expect(col(r.body, "Cuenta creada")).toMatch(/^\d{4}-/);
    expect(col(r.body, "Cuenta activa")).toBe("");
    const [pro] = await sql<Array<{ id: string }>>`insert into professionals (clinic_id, full_name, specialty) values (${clinic.id}, 'Dra. Prueba', 'Odontología') returning id`;
    const [type] = await sql<Array<{ id: string }>>`insert into appointment_types (clinic_id, name, specialty) values (${clinic.id}, 'Consulta', 'Odontología') returning id`;
    const [patient] = await sql<Array<{ id: string }>>`insert into patients (clinic_id, full_name, phone) values (${clinic.id}, 'Paciente Prueba', '+5492235009999') returning id`;
    await sql`insert into appointments (clinic_id, patient_id, professional_id, appointment_type_id, starts_at, ends_at, source)
              values (${clinic.id}, ${patient.id}, ${pro.id}, ${type.id}, now() + interval '1 day', now() + interval '1 day 30 minutes', 'whatsapp')`;
    r = await post({ code: "ana-111", action: { type: "note", text: "operando" } });
    expect(col(r.body, "Cuenta activa")).toMatch(/^\d{4}-/);
    // Onboarding: operativa desde su primera conversación y las del primer mes.
    expect(col(r.body, "Operativa desde")).toBe("");
    expect(col(r.body, "Interacciones del primer mes")).toBe(0);
    await sql`insert into conversations (clinic_id, started_at) values (${clinic.id}, now() - interval '2 days'), (${clinic.id}, now() - interval '1 day')`;
    r = await post({ code: "ana-111", action: { type: "outcome", outcome: "cliente", detail: "setup cobrado" } });
    expect(col(r.body, "Cliente desde")).toMatch(/^\d{4}-/);
    expect(col(r.body, "Operativa desde")).toMatch(/^\d{4}-/);
    expect(col(r.body, "Interacciones del primer mes")).toBe(2);
    r = await post({ code: "ana-111", action: { type: "account", clinicId: null } });
    expect(col(r.body, "Cuenta creada")).toBe("");
  });

  it("edita datos con las mismas validaciones del panel", async () => {
    const r = await post({ code: "ana-111", action: { type: "edit", fields: { org: "Consultorio Ana", phone: "223 500-0009", phoneKind: "compartido", instagram: "https://instagram.com/ana.odonto" } } });
    expect(r.status).toBe(200);
    expect(col(r.body, "Consultorio")).toBe("Consultorio Ana");
    expect(col(r.body, "De quién es el teléfono")).toBe("Celular del consultorio");
    expect(col(r.body, "Instagram")).toBe("@ana.odonto");
    expect((await post({ code: "ana-111", action: { type: "edit", fields: { phone: "12" } } })).status).toBe(422);
  });
});
