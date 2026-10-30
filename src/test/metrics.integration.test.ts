import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Métricas para el tablero de Chapa Labs: la prospección cuenta la cohorte de primer contacto, las
// series van por día de Buenos Aires, las clínicas de las demos no cuentan como uso y el endpoint
// pide la clave y no devuelve datos personales.

const base = testDatabaseUrl();
const SECRET = "m".repeat(40);

describe.runIf(base)("métricas del tablero", () => {
  let sql: typeof import("@/lib/db").sql;
  let metrics: typeof import("@/lib/sales/metrics");
  let route: typeof import("@/app/api/metricas/route");
  const get = (auth?: string, query = "") =>
    route.GET(new Request(`https://turnia.example/api/metricas${query}`, { headers: auth ? { authorization: auth } : {} }));

  beforeAll(async () => {
    const url = await scratchDatabase(base!, "turnia_test_metrics");
    await resetTestDatabase(url);
    for (const [key, value] of Object.entries({ DATABASE_URL: url, METRICS_SECRET: SECRET })) vi.stubEnv(key, value);
    ({ sql } = await import("@/lib/db"));
    metrics = await import("@/lib/sales/metrics");
    route = await import("@/app/api/metricas/route");

    const person = (code: string, status: string, firstContact: string | null, extra: { opened?: string; demo?: string; channel?: string; zone?: string } = {}) =>
      sql`insert into sales_outreach (code, name, zone, status, touches, last_channel, first_contact_at, opened_at, demo_at)
          values (${code}, ${`Persona ${code}`}, ${extra.zone ?? "Mar del Plata"}, ${status}, ${firstContact ? 1 : 0}, ${extra.channel ?? (firstContact ? "whatsapp" : null)},
                  ${firstContact}, ${extra.opened ?? null}, ${extra.demo ?? null}) returning id`;
    const [a] = await person("aaa-111", "respondio", "2026-10-20T13:00:00Z", { opened: "2026-10-20T15:00:00Z", demo: "2026-10-21T15:00:00Z" });
    await person("bbb-222", "contactado", "2026-10-21T02:30:00Z", { opened: "2026-10-21T10:00:00Z" }); // 20/10 23:30 en Buenos Aires
    await person("ccc-333", "cliente", "2026-10-25T13:00:00Z", { channel: "instagram", zone: "Miramar" });
    await person("ddd-444", "por_contactar", null);
    await sql`insert into sales_outreach_events (outreach_id, kind, channel, detail, created_at) values
      (${a.id}, 'mensaje', 'whatsapp', 'presentación', '2026-10-20T13:00:00Z'),
      (${a.id}, 'abrio', null, '', '2026-10-20T15:00:00Z'),
      (${a.id}, 'demo', null, '', '2026-10-21T15:00:00Z'),
      (${a.id}, 'estado', null, 'respondio: quiere probar', '2026-10-21T16:00:00Z')`;
    await sql`insert into leads (name, email, status, created_at) values
      ('Pedido', 'pedido@example.test', 'demo_agendada', '2026-10-22T13:00:00Z'),
      ('Otro', 'otro@example.test', 'nuevo', '2026-10-23T13:00:00Z')`;
    await sql`insert into demo_sessions (phone, chat_id, website, status, created_at) values
      ('+5492230000001', 'c1', 'https://a.example', 'terminada', '2026-10-22T13:00:00Z'),
      ('+5492230000002', 'c2', 'https://b.example', 'error', '2026-10-22T14:00:00Z')`;
    // Una clínica de demo con un turno: no cuenta.
    await sql`update clinics set is_demo = true where id <> '00000000-0000-4000-8000-000000000001'`;
  }, 60000);

  afterAll(async () => {
    await (await import("@/lib/db")).closeDb();
    vi.unstubAllEnvs();
  });

  it("arma el embudo de la prospección, por canal, por zona y por día", async () => {
    const m = await metrics.turniaMetrics({ from: null, to: null });
    expect(m.prospeccion).toMatchObject({ prospectados: 4, contactados: 3, abrieron_demo: 2, probaron_demo: 1, respondieron: 2, interesados: 3, reuniones: 1, clientes: 1 });
    expect(m.prospeccion.etapas).toEqual({ respondio: 1, contactado: 1, cliente: 1, por_contactar: 1 });
    expect(m.prospeccion.porCanal).toEqual([
      { canal: "whatsapp", contactados: 2, respondieron: 1, probaron_demo: 1, clientes: 0 },
      { canal: "instagram", contactados: 1, respondieron: 1, probaron_demo: 0, clientes: 1 },
    ]);
    expect(m.prospeccion.porZona[0]).toEqual({ zona: "Mar del Plata", prospectados: 3, contactados: 2, respondieron: 1, clientes: 0 });
    expect(m.prospeccion.diario).toEqual([
      { date: "2026-10-20", mensajes: 1, otros_contactos: 0, aperturas: 1, demos: 0, respuestas: 0, reuniones: 0, clientes: 0, nuevos: 2 },
      { date: "2026-10-21", mensajes: 0, otros_contactos: 0, aperturas: 0, demos: 1, respuestas: 1, reuniones: 0, clientes: 0, nuevos: 0 },
      { date: "2026-10-25", mensajes: 0, otros_contactos: 0, aperturas: 0, demos: 0, respuestas: 0, reuniones: 0, clientes: 0, nuevos: 1 },
    ]);
    expect(m.demos).toMatchObject({ iniciadas: 2, listas: 1, terminadas: 1, con_error: 1 });
    expect(m.pedidos).toMatchObject({ pedidos: 2, contactados: 1, demo_agendada: 1, ganados: 0 });
    // Los turnos del ejemplo se cargan hoy: los que tomó Turnia (no el panel) de la clínica real.
    expect(m.uso).toMatchObject({ clinicas: 1, clinicas_activas: 1, ultimos7: 3, previos7: 0, turnos: 3 });
  });

  it("con fechas, cuenta la cohorte del primer contacto en el período", async () => {
    const m = await metrics.turniaMetrics({ from: "2026-10-21", to: "2026-10-26" });
    expect(m.prospeccion).toMatchObject({ prospectados: 4, contactados: 1, clientes: 1 });
    expect(m.demos.iniciadas).toBe(2);
    expect(m.uso.turnos).toBe(0); // los del ejemplo se cargan hoy, fuera del período
  });

  it("el endpoint pide la clave, valida las fechas y no devuelve datos personales", async () => {
    expect((await get()).status).toBe(401);
    expect((await get("Bearer otra")).status).toBe(401);
    vi.stubEnv("METRICS_SECRET", ` ${SECRET}\n`);
    expect((await get(`Bearer ${SECRET}`, "?desde=ayer")).status).toBe(400);
    vi.stubEnv("METRICS_SECRET", SECRET);
    expect((await get(`Bearer ${SECRET}`, "?desde=ayer")).status).toBe(400);
    const res = await get(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ producto: "turnia", prospeccion: { prospectados: 4 } });
    for (const secret of ["Persona", "aaa-111", "example.test", "+549"]) expect(text).not.toContain(secret);
  });
});
