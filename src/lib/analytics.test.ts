import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanAnalyticsId, cta, isPrivatePath, prospectDistinctId, redactTokens, surfaceOf } from "./analytics-shared";
import { captureBody, captureLater, captureServer, serverAnalyticsEnabled } from "./analytics-server";
import { ctaProperties } from "./interaction-tracking";

describe("analítica: lo que nunca sale y cómo se nombra", () => {
  it("el panel y la demo interna no se miden; la web y las demos sí", () => {
    for (const path of ["/panel", "/panel/prospeccion", "/panel/pacientes/123", "/demo", "/demo/algo"]) expect(isPrivatePath(path)).toBe(true);
    for (const path of ["/", "/p/pagani-ats", "/probar-demo", "/probar-demo/sesion/w_x", "/demos", "/panelista", "/pedi-una-demo"]) expect(isPrivatePath(path)).toBe(false);
  });

  it("los tokens de una demo o de su llamada no llegan a PostHog, tampoco en el referrer", () => {
    expect(redactTokens("https://turnia.example/probar-demo/sesion/w_abcDEF123-_xyz?x=1")).toBe("https://turnia.example/probar-demo/sesion/[oculto]?x=1");
    expect(redactTokens("/probar-demo/llamada/Zz9_-abc")).toBe("/probar-demo/llamada/[oculto]");
    expect(redactTokens("/p/pagani-ats?vista=panel")).toBe("/p/pagani-ats?vista=panel");
  });

  it("cada zona del sitio tiene su nombre", () => {
    expect(surfaceOf("/")).toBe("home");
    expect(surfaceOf("/p/pagani-ats")).toBe("demo_personal");
    expect(surfaceOf("/probar-demo")).toBe("probar_demo");
    expect(surfaceOf("/probar-demo/sesion/w_1")).toBe("demo_web");
    expect(surfaceOf("/probar-demo/llamada/abc")).toBe("demo_llamada");
    expect(surfaceOf("/especialidades/odontologia")).toBe("landing");
    expect(surfaceOf("/recepcion")).toBe("producto");
  });

  it("un llamado a la acción se describe con atributos y el clic se lee solo de ellos", () => {
    const attrs = cta("try_demo", "hero", "probar_demo");
    expect(attrs).toEqual({ "data-cta": "try_demo", "data-cta-location": "hero", "data-cta-destination": "probar_demo", "data-cta-kind": "conversion" });
    // Lo que el navegador expone en `dataset` para esos atributos.
    expect(ctaProperties({ cta: "try_demo", ctaLocation: "hero", ctaDestination: "probar_demo", ctaKind: "conversion" }, "/")).toEqual({
      cta_id: "try_demo",
      cta_location: "hero",
      cta_destination: "probar_demo",
      cta_kind: "conversion",
      surface: "home",
    });
    expect(ctaProperties({ cta: "x".repeat(200) }, "/p/a-b-c").cta_id).toHaveLength(80);
  });

  it("el id que manda el navegador se valida antes de guardarlo", () => {
    expect(cleanAnalyticsId("0192f3a1-7b2c-7d4e-8f00-123456789abc")).toBe("0192f3a1-7b2c-7d4e-8f00-123456789abc");
    expect(cleanAnalyticsId(prospectDistinctId("pagani-ats"))).toBe("prospecto:pagani-ats");
    for (const bad of ["", "a b", "<script>", "x".repeat(201), 42, null]) expect(cleanAnalyticsId(bad)).toBeNull();
  });
});

describe("analítica del servidor", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("solo envía en producción (o con una clave puesta a mano)", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    expect(serverAnalyticsEnabled()).toBe(false);
    await captureServer("prospect_pitch_sent", "prospecto:x-y-z");
    captureLater("prospect_pitch_sent", "prospecto:x-y-z");
    expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv("VERCEL_ENV", "production");
    expect(serverAnalyticsEnabled()).toBe(true);
  });

  it("sin persona, el evento no crea perfiles; con persona, los actualiza", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const anon = captureBody("demo_prepared", "demo:1", { via: "whatsapp" });
    expect(anon).toMatchObject({
      event: "demo_prepared",
      distinct_id: "demo:1",
      api_key: expect.stringMatching(/^phc_/),
      properties: { via: "whatsapp", app_env: "production", tracking_version: 1, $lib: "turnia-server", $process_person_profile: false },
    });
    const person = captureBody("prospect_pitch_sent", "prospecto:x-y-z", {}, { set: { prospect_status: "contactado" }, setOnce: { prospect_code: "x-y-z" } });
    expect(person.properties).toMatchObject({ $set: { prospect_status: "contactado" }, $set_once: { prospect_code: "x-y-z" } });
    expect(person.properties).not.toHaveProperty("$process_person_profile");
  });

  it("manda a la API de captura y nunca tira, aunque PostHog no responda", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await captureServer("demo_prepared", "demo:1", { pages_read: 3 });
    expect(fetch.mock.calls[0][0]).toBe("https://us.i.posthog.com/i/v0/e/");
    expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toMatchObject({ event: "demo_prepared", properties: { pages_read: 3 } });

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("caído"))));
    await expect(captureServer("demo_prepared", "demo:1")).resolves.toBeUndefined();
    // Fuera de una petición (sin `after`), se manda igual sin esperar.
    expect(() => captureLater("demo_prepared", "demo:1")).not.toThrow();
  });
});
