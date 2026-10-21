import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Formulario "Pedí una demo" de la web pública contra un Postgres descartable.

const mocks = vi.hoisted(() => ({ notifyN8n: vi.fn(async () => {}) }));
vi.mock("@/lib/n8n", () => ({ notifyN8n: mocks.notifyN8n }));

const baseUrl = testDatabaseUrl();

function form(data: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
}

/** MP3 falso pero válido: `n` cuadros MPEG-1 capa III de 128 kbps a 44,1 kHz (26 ms cada uno). */
function mp3Falso(n: number): string {
  const cuadro = Buffer.alloc(417);
  cuadro.set([0xff, 0xfb, 0x90, 0x64]);
  return Buffer.concat(Array.from({ length: n }, () => cuadro)).toString("base64");
}

describe.runIf(baseUrl)("Pedí una demo", () => {
  let sql: typeof import("@/lib/db").sql;
  let pedirDemo: typeof import("@/app/(marketing)/pedi-una-demo/actions").pedirDemo;

  beforeAll(async () => {
    const url = await scratchDatabase(baseUrl!, "turnia_test_web");
    await resetTestDatabase(url);
    vi.stubEnv("DATABASE_URL", url);
    ({ sql } = await import("@/lib/db"));
    ({ pedirDemo } = await import("@/app/(marketing)/pedi-una-demo/actions"));
  }, 60000);

  afterAll(async () => {
    await sql.end();
    vi.unstubAllEnvs();
  });

  it("guarda el pedido y avisa a n8n", async () => {
    const res = await pedirDemo(undefined, form({ nombre: "Laura Gómez", email: "laura@clinica.com.ar", organizacion: "Centro Plaza", origen: "/pedi-una-demo" }));
    expect(res).toEqual({ ok: true });
    const rows = await sql`select name, email, organization, source from leads`;
    expect(rows).toEqual([{ name: "Laura Gómez", email: "laura@clinica.com.ar", organization: "Centro Plaza", source: "/pedi-una-demo" }]);
    expect(mocks.notifyN8n).toHaveBeenCalledWith("lead.nuevo", expect.objectContaining({ lead: expect.objectContaining({ email: "laura@clinica.com.ar" }) }));
  });

  it("valida el email y descarta bots sin guardar", async () => {
    expect((await pedirDemo(undefined, form({ nombre: "Ana", email: "no-es-email" }))).error).toBe("Revisá el email.");
    expect(await pedirDemo(undefined, form({ nombre: "Bot", email: "bot@spam.com", empresa_web: "x" }))).toEqual({ ok: true });
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from leads`;
    expect(n).toBe(1);
  });
});

describe.runIf(baseUrl)("Audios de la web generados desde el panel", () => {
  let sql: typeof import("@/lib/db").sql;
  let audios: typeof import("@/lib/web-audios");
  let GET: typeof import("@/app/api/audios/[archivo]/route").GET;
  const pedidos: Array<{ url: string; body: unknown }> = [];
  let sinPermiso = false;

  beforeAll(async () => {
    const url = await scratchDatabase(baseUrl!, "turnia_test_audios");
    await resetTestDatabase(url);
    // El suite anterior cerró la conexión compartida: se arranca una nueva contra esta base.
    vi.resetModules();
    delete (globalThis as { turniaSql?: unknown }).turniaSql;
    vi.stubEnv("DATABASE_URL", url);
    vi.stubEnv("ELEVENLABS_API_KEY", "clave-falsa");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const u = String(input);
        pedidos.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
        if (sinPermiso) {
          return new Response(JSON.stringify({ detail: { status: "missing_permissions", message: "The API key is missing the permission text_to_speech" } }), { status: 401 });
        }
        if (u.includes("/v2/voices")) {
          return Response.json({
            voices: [
              { voice_id: "v_tomas", name: "Tomás", favorited_at_unix: 100, labels: { gender: "male" } },
              { voice_id: "v_otra", name: "Otra", favorited_at_unix: null },
              { voice_id: "v_sofi", name: "Sofía", favorited_at_unix: 200, labels: { gender: "female" } },
            ],
            has_more: false,
          });
        }
        if (u.includes("/v1/text-to-dialogue/with-timestamps")) {
          const body = JSON.parse(String(init!.body)) as { inputs: unknown[] };
          return Response.json(
            {
              audio_base64: mp3Falso(40),
              voice_segments: body.inputs.map((_, i) => ({ dialogue_input_index: i, start_time_seconds: i * 0.05, end_time_seconds: i * 0.05 + 0.04 })),
            },
            { headers: { "request-id": `req_${pedidos.length}` } },
          );
        }
        return new Response("no", { status: 404 });
      }),
    );
    ({ sql } = await import("@/lib/db"));
    audios = await import("@/lib/web-audios");
    ({ GET } = await import("@/app/api/audios/[archivo]/route"));
  }, 60000);

  afterAll(async () => {
    await sql.end();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const pedir = (archivo: string, headers: Record<string, string> = {}) =>
    GET(new Request(`http://local/api/audios/${archivo}`, { headers }), { params: Promise.resolve({ archivo }) });

  it("sin audio generado, la API responde 404 y la web usa la lectura animada", async () => {
    expect((await pedir("home.json")).status).toBe(404);
    expect((await pedir("no-existe.mp3")).status).toBe(404);
  });

  it("elige las 2 favoritas (Sofi = la femenina), genera por bloques y lo sirve con Range", async () => {
    const voces = await audios.elegirVoces();
    expect(voces.agente.id).toBe("v_sofi");
    expect(voces.paciente.id).toBe("v_tomas");

    const { getConversacion } = await import("@/content/conversaciones");
    const home = getConversacion("home")!;
    const duracion = await audios.generarAudio(home, voces);
    const llamadas = pedidos.filter((p) => p.url.includes("text-to-dialogue"));
    expect(llamadas.length).toBeGreaterThanOrEqual(2);
    expect(llamadas[1].body).toMatchObject({ previous_request_ids: [expect.stringMatching(/^req_/)] });
    expect((llamadas[0].body as { inputs: Array<{ voice_id: string }> }).inputs[0].voice_id).toBe(home.lineas[0].quien === "agente" ? "v_sofi" : "v_tomas");
    expect(duracion).toBeCloseTo(llamadas.length * 40 * (1152 / 44100), 2);

    const json = await (await pedir("home.json")).json();
    expect(json.segmentos).toHaveLength(home.lineas.length);
    expect(json.segmentos.at(-1).inicio).toBeGreaterThan(1); // los bloques siguientes se corren en el tiempo

    const completo = await pedir("home.mp3");
    expect(completo.headers.get("content-type")).toBe("audio/mpeg");
    const total = Number(completo.headers.get("content-length"));
    expect(total).toBe(llamadas.length * 40 * 417);
    const parcial = await pedir("home.mp3", { range: "bytes=100-199" });
    expect(parcial.status).toBe(206);
    expect(parcial.headers.get("content-range")).toBe(`bytes 100-199/${total}`);
    expect((await parcial.arrayBuffer()).byteLength).toBe(100);

    const estado = await audios.estadoAudios();
    expect(estado.find((e) => e.slug === "home")?.generado).toBeTruthy();
    expect(estado.find((e) => e.slug === "pediatria")?.generado).toBeNull();
  });

  it("explica en castellano cuando la clave no tiene permiso de Text to Speech", async () => {
    sinPermiso = true;
    await expect(audios.elegirVoces()).rejects.toThrow(/Text to Speech/);
    sinPermiso = false;
  });
});
