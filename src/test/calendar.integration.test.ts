import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, scratchDatabase, testDatabaseUrl } from "./db-setup";

// Google Calendar de punta a punta, con Google simulado: conexión OAuth, calendario
// por profesional, lo ocupado que deja de ofrecerse, eventos de cada turno y qué
// pasa cuando Google falla o pide reconectar.

const mocks = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  after: [] as Array<() => unknown>,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.cookies.has(name) ? { name, value: mocks.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void mocks.cookies.set(name, value),
    delete: (name: string) => void mocks.cookies.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => mocks.after.push(fn),
}));
vi.mock("@/lib/n8n", () => ({ notifyN8n: vi.fn(async () => {}) }));

const baseUrl = testDatabaseUrl();
const MAIN = "00000000-0000-4000-8000-000000000001";
const RUIZ = "00000000-0000-4000-8000-0000000000a3";
const CONSULTA = "00000000-0000-4000-8000-0000000000b6";
const CAL = "ruiz@group.calendar.google.com";
const API = "https://www.googleapis.com/calendar/v3";

type Stored = Record<string, unknown> & { id: string };
const google = {
  events: new Map<string, Stored[]>(),
  calls: [] as Array<{ method: string; url: string; body: unknown }>,
  down: false,
  revoked: false,
  refreshes: 0,
  reset() {
    this.events = new Map();
    this.calls = [];
    this.down = false;
    this.revoked = false;
  },
};

async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = init.method ?? "GET";
  const raw = typeof init.body === "string" ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : undefined;
  let body: unknown = raw;
  try { if (raw?.startsWith("{")) body = JSON.parse(raw); } catch { /* texto */ }
  google.calls.push({ method, url, body });
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

  if (url === "https://oauth2.googleapis.com/token") {
    const form = new URLSearchParams(raw);
    if (form.get("grant_type") === "authorization_code") {
      if (form.get("code") !== "codigo-ok") return json({ error: "invalid_grant" }, 400);
      return json({ access_token: "acceso-1", refresh_token: "permanente-1", expires_in: 3600,
        scope: "openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events" });
    }
    if (google.revoked) return json({ error: "invalid_grant" }, 400);
    google.refreshes++;
    return json({ access_token: `acceso-renovado-${google.refreshes}`, expires_in: 3600 });
  }
  if (url.startsWith("https://oauth2.googleapis.com/revoke")) return new Response(null, { status: 200 });
  if (url === "https://openidconnect.googleapis.com/v1/userinfo") return json({ email: "recepcion@clinica.test" });
  if (!url.startsWith(API)) throw new Error(`fetch inesperado: ${method} ${url}`);
  if (google.down) return json({ error: { message: "backend" } }, 503);

  if (url.startsWith(`${API}/users/me/calendarList`)) {
    return json({ items: [
      { id: "principal@clinica.test", summary: "Recepción", primary: true, accessRole: "owner" },
      { id: CAL, summary: "Dra. Ruiz", accessRole: "writer" },
      { id: "feriados@group.v.calendar.google.com", summary: "Feriados", accessRole: "reader" },
    ] });
  }
  const m = /^\/calendars\/([^/]+)\/events(?:\/([^/?]+))?/.exec(url.slice(API.length));
  if (!m) throw new Error(`ruta de Calendar inesperada: ${url}`);
  const calendarId = decodeURIComponent(m[1]);
  const list = google.events.get(calendarId) ?? [];
  google.events.set(calendarId, list);
  const eventId = m[2];
  if (method === "GET") {
    expect(new URL(url).searchParams.get("fields")).not.toContain("summary");
    return json({ items: list });
  }
  if (method === "POST") {
    const ev = body as Stored;
    if (list.some((e) => e.id === ev.id)) return json({ error: { message: "duplicate" } }, 409);
    list.push(ev);
    return json(ev);
  }
  const found = list.find((e) => e.id === eventId);
  if (method === "PATCH") {
    if (!found) return json({ error: { message: "not found" } }, 404);
    Object.assign(found, body as object);
    return json(found);
  }
  if (method === "DELETE") {
    if (!found) return json({ error: { message: "gone" } }, 410);
    list.splice(list.indexOf(found), 1);
    return new Response(null, { status: 204 });
  }
  throw new Error(`método inesperado ${method}`);
}

describe.runIf(baseUrl)("Google Calendar", () => {
  let sql: typeof import("@/lib/db").sql;
  let service: typeof import("@/lib/agent/service");
  let sync: typeof import("@/lib/calendar/sync");
  let day = "";
  const at = (hhmm: string) => {
    const [y, mo, d] = day.split("-").map(Number);
    const [h, mi] = hhmm.split(":").map(Number);
    return zoned(y, mo, d, h, mi, "America/Argentina/Buenos_Aires").toISOString();
  };
  let zoned: typeof import("@/lib/time").zonedTimeToUtc;
  const ctx = { clinicId: MAIN, patientPhone: "5491166660000", channel: "custom" };
  const runAfter = async () => { for (const fn of mocks.after.splice(0)) await fn(); };
  const calendarEvents = () => google.events.get(CAL) ?? [];

  beforeAll(async () => {
    const url = await scratchDatabase(baseUrl!, "turnia_test_calendar");
    await resetTestDatabase(url);
    vi.stubEnv("DATABASE_URL", url);
    vi.stubEnv("AGENT_TOOLS_SECRET", "secreto-de-prueba");
    vi.stubEnv("SESSION_SECRET", "sesion-de-prueba");
    vi.stubEnv("PANEL_PASSWORD", "clave");
    vi.stubEnv("APP_URL", "https://turnia.example");
    vi.stubEnv("GOOGLE_CLIENT_ID", "cliente.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secreto-google");
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
    ({ sql } = await import("@/lib/db"));
    service = await import("@/lib/agent/service");
    sync = await import("@/lib/calendar/sync");
    const time = await import("@/lib/time");
    zoned = time.zonedTimeToUtc;
    // Un día hábil a partir de pasado mañana (la Dra. Ruiz atiende de lunes a viernes de 10 a 17).
    day = time.addDaysKey(time.localDateKey(new Date(), "America/Argentina/Buenos_Aires"), 2);
    while ([0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) day = time.addDaysKey(day, 1);
    mocks.cookies.set("turnia_session", (await import("@/lib/session")).createSessionToken());
  }, 60000);

  afterAll(async () => {
    const { closeDb } = await import("@/lib/db");
    await closeDb();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    google.calls = [];
  });

  it("conecta la cuenta con un estado firmado y guarda los tokens cifrados", async () => {
    const connect = (await import("@/app/api/google/conectar/route")).GET;
    const callback = (await import("@/app/api/google/callback/route")).GET;
    const res = await connect(new Request(`https://turnia.example/api/google/conectar?clinic_id=${MAIN}`));
    const google_ = new URL(res.headers.get("location")!);
    expect(google_.origin).toBe("https://accounts.google.com");
    expect(google_.searchParams.get("redirect_uri")).toBe("https://turnia.example/api/google/callback");
    expect(google_.searchParams.get("access_type")).toBe("offline");
    expect(google_.searchParams.get("scope")).toContain("calendar.events");
    const state = google_.searchParams.get("state")!;
    const nonce = /turnia_google_oauth=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")![1];

    // Sin la cookie del navegador que lo pidió, o con el estado alterado, no conecta.
    const back = (r: Response) => new URL(r.headers.get("location")!).searchParams.get("google");
    expect(back(await callback(new Request(`https://turnia.example/api/google/callback?code=codigo-ok&state=${state}`)))).toBe("vencido");
    mocks.cookies.set("turnia_google_oauth", nonce);
    expect(back(await callback(new Request(`https://turnia.example/api/google/callback?code=codigo-ok&state=${state.replace(/.$/, "x")}`)))).toBe("vencido");
    expect(back(await callback(new Request(`https://turnia.example/api/google/callback?error=access_denied&state=${state}`)))).toBe("cancelado");

    expect(back(await callback(new Request(`https://turnia.example/api/google/callback?code=codigo-ok&state=${state}`)))).toBe("conectado");
    const [conn] = await sql`select account_email, refresh_token, access_token, status from calendar_connections where clinic_id = ${MAIN}`;
    expect(conn.account_email).toBe("recepcion@clinica.test");
    expect(conn.status).toBe("conectado");
    expect(conn.refresh_token).not.toContain("permanente-1");
    const { decryptSecret } = await import("@/lib/calendar/crypto");
    expect(decryptSecret(conn.refresh_token)).toBe("permanente-1");
  });

  it("el panel ofrece solo calendarios en los que se puede escribir y guarda el de cada profesional", async () => {
    const Page = (await import("@/app/panel/(app)/configuracion/calendario/page")).default;
    const { renderToStaticMarkup } = await import("react-dom/server");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ google: "conectado" }) } as never));
    expect(html).toContain("recepcion@clinica.test");
    expect(html).toContain("Dra. Ruiz");
    expect(html).not.toContain("Feriados</option>");
    expect(html).toContain("Google Calendar quedó conectado");

    const { saveProfessionalCalendar } = await import("@/app/panel/calendar-actions");
    const form = new FormData();
    form.set("clinic_id", MAIN);
    form.set("professional_id", RUIZ);
    form.set("calendar_id", "feriados@group.v.calendar.google.com");
    expect((await saveProfessionalCalendar(undefined, form)).ok).toBe(false);
    form.set("calendar_id", CAL);
    expect(await saveProfessionalCalendar(undefined, form)).toMatchObject({ ok: true });
    const [pro] = await sql`select google_calendar_id, google_calendar_name from professionals where id = ${RUIZ}`;
    expect(pro).toEqual({ google_calendar_id: CAL, google_calendar_name: "Dra. Ruiz" });
    await runAfter();
  });

  it("lo ocupado en Google deja de ofrecerse; lo «Disponible», lo de Turnia y lo rechazado no", async () => {
    google.events.set(CAL, [
      { id: "cirugia", start: { dateTime: at("10:00") }, end: { dateTime: at("12:00") } },
      { id: "libre", transparency: "transparent", start: { dateTime: at("12:00") }, end: { dateTime: at("13:00") } },
      { id: "propio", extendedProperties: { private: { turnia_appointment_id: "x" } }, start: { dateTime: at("12:00") }, end: { dateTime: at("12:30") } },
      { id: "rechazada", attendees: [{ self: true, responseStatus: "declined" }], start: { dateTime: at("12:00") }, end: { dateTime: at("14:00") } },
      { id: "cancelado", status: "cancelled", start: { dateTime: at("12:00") }, end: { dateTime: at("17:00") } },
    ]);
    const r = (await service.checkAvailability(ctx, { tipo_turno_id: CONSULTA, desde: day, hasta: day })) as { turnos: Array<{ inicio: string }> };
    expect(r.turnos.map((t) => t.inicio)).toEqual([at("12:00"), at("12:30")]);
    // La segunda consulta usa lo leído hace un momento: no vuelve a Google.
    google.calls = [];
    await service.checkAvailability(ctx, { tipo_turno_id: CONSULTA, desde: day, hasta: day });
    expect(google.calls.filter((c) => c.url.includes("/events"))).toHaveLength(0);
  });

  it("al reservar consulta Google en el momento y escribe el evento con lo mínimo del paciente", async () => {
    // Recién anotado en Google (la lectura guardada todavía no lo tiene): igual se rechaza.
    google.events.get(CAL)!.push({ id: "reunion", start: { dateTime: at("15:00") }, end: { dateTime: at("16:00") } });
    await expect(service.bookAppointment(ctx, { tipo_turno_id: CONSULTA, profesional_id: RUIZ, inicio: at("15:00"), nombre_completo: "Juan Carlos Pérez" }))
      .rejects.toThrow("ocupado");
    // Al paciente no se le dice qué tiene el profesional en Google; el panel lo ve y lo puede dar igual.
    const { createManualAppointment } = await import("@/app/panel/actions");
    const manual = new FormData();
    for (const [k, v] of Object.entries({ phone: "11 6666-0099", full_name: "Ana Forzada", appointment_type_id: CONSULTA, professional_id: RUIZ, date: day, time: "15:00" })) manual.set(k, v);
    expect(await createManualAppointment(undefined, manual)).toEqual({ ok: false, message: "Ese horario está ocupado en el Google Calendar de Dra. Carolina Ruiz.", forzable: true });
    manual.set("force", "1");
    expect(await createManualAppointment(undefined, manual)).toMatchObject({ ok: true });
    await sql`delete from appointments where patient_id = (select id from patients where phone = '5491166660099')`;

    const booked = (await service.bookAppointment(ctx, { tipo_turno_id: CONSULTA, profesional_id: RUIZ, inicio: at("12:00"), nombre_completo: "Juan Carlos Pérez" })) as { turno_id: string };
    const [pending] = await sql`select calendar_sync from appointments where id = ${booked.turno_id}`;
    expect(pending.calendar_sync).toBe("pendiente");
    await sync.syncPendingCalendar(MAIN);
    const event = calendarEvents().find((e) => (e.extendedProperties as { private: Record<string, string> } | undefined)?.private?.turnia_appointment_id === booked.turno_id)!;
    expect(event).toMatchObject({ summary: "Turno: Consulta odontológica · Juan P.", status: "confirmed", location: "Av. Santa Fe 3200, 4º piso, Palermo, CABA" });
    expect(String(event.description)).toContain("Teléfono: +5491166660000");
    expect(JSON.stringify(event)).not.toMatch(/DNI|cobertura/i);
    const [row] = await sql`select calendar_sync, calendar_event_id, calendar_event_calendar from appointments where id = ${booked.turno_id}`;
    expect(row).toEqual({ calendar_sync: "ok", calendar_event_id: sync.eventIdFor(booked.turno_id), calendar_event_calendar: CAL });
    // Su propio evento no le bloquea la agenda a Turnia.
    const again = (await service.checkAvailability(ctx, { tipo_turno_id: CONSULTA, desde: day, hasta: day })) as { turnos: Array<{ inicio: string }> };
    expect(again.turnos[0].inicio).toBe(at("12:30"));
  });

  it("reprogramar mueve el evento y cancelar lo borra", async () => {
    const [appt] = await sql`select id from appointments where calendar_event_id is not null and status = 'confirmado' limit 1`;
    const moved = (await service.rescheduleAppointment(ctx, { turno_id: appt.id, nuevo_inicio: at("13:00") })) as { turno_id: string };
    await sync.syncPendingCalendar(MAIN);
    const ids = calendarEvents().map((e) => e.id);
    expect(ids).not.toContain(sync.eventIdFor(appt.id));
    expect(ids).toContain(sync.eventIdFor(moved.turno_id));

    await service.cancelAppointment(ctx, { turno_id: moved.turno_id });
    await sync.syncPendingCalendar(MAIN);
    expect(calendarEvents().map((e) => e.id)).not.toContain(sync.eventIdFor(moved.turno_id));
    const [row] = await sql`select calendar_sync, calendar_event_id from appointments where id = ${moved.turno_id}`;
    expect(row).toEqual({ calendar_sync: "ok", calendar_event_id: null });
  });

  it("si Google no responde, el turno se da igual y el evento se escribe después", async () => {
    google.down = true;
    await sql`update professionals set google_busy_at = null where id = ${RUIZ}`;
    const booked = (await service.bookAppointment(ctx, { tipo_turno_id: CONSULTA, profesional_id: RUIZ, inicio: at("16:00"), nombre_completo: "Juan Carlos Pérez" })) as { turno_id: string };
    expect(booked.turno_id).toBeTruthy();
    await sync.syncPendingCalendar(MAIN);
    const [failed] = await sql`select calendar_sync, calendar_attempts, calendar_error from appointments where id = ${booked.turno_id}`;
    expect(failed).toMatchObject({ calendar_sync: "error", calendar_attempts: 1 });
    google.down = false;
    // El reintento lo hace la automatización /api/automations/calendario.
    const job = (await import("@/app/api/automations/[job]/route")).POST;
    const res = await job(new Request("https://turnia.example/api/automations/calendario", { method: "POST", headers: { "x-turnia-secret": "secreto-de-prueba" } }), { params: Promise.resolve({ job: "calendario" }) });
    expect(await res.json()).toMatchObject({ ok: true, sincronizados: 1, errores: 0 });
    expect(calendarEvents().map((e) => e.id)).toContain(sync.eventIdFor(booked.turno_id));
  });

  it("si Google pide reconectar, la agenda sigue andando y el panel lo avisa", async () => {
    await sql`update calendar_connections set access_expires_at = now() - interval '1 minute' where clinic_id = ${MAIN}`;
    await sql`update professionals set google_busy_at = null, google_busy = null where id = ${RUIZ}`;
    google.revoked = true;
    const r = (await service.checkAvailability(ctx, { tipo_turno_id: CONSULTA, desde: day, hasta: day })) as { turnos: unknown[] };
    expect(r.turnos.length).toBeGreaterThan(0);
    const [conn] = await sql`select status, last_error from calendar_connections where clinic_id = ${MAIN}`;
    expect(conn).toEqual({ status: "error", last_error: "Google pidió volver a conectar la cuenta." });
    const Page = (await import("@/app/panel/(app)/configuracion/calendario/page")).default;
    const { renderToStaticMarkup } = await import("react-dom/server");
    expect(renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) } as never))).toContain("Reconectar");
    google.revoked = false;
  });

  it("desconectar revoca el permiso y deja de sincronizar", async () => {
    const { disconnectCalendar } = await import("@/app/panel/calendar-actions");
    const form = new FormData();
    form.set("clinic_id", MAIN);
    await disconnectCalendar(form);
    expect(google.calls.some((c) => c.url.startsWith("https://oauth2.googleapis.com/revoke"))).toBe(true);
    expect(await sql`select 1 from calendar_connections where clinic_id = ${MAIN}`).toHaveLength(0);
    // Un turno nuevo ya no queda pendiente de escribir en Google.
    const booked = (await service.bookAppointment(ctx, { tipo_turno_id: CONSULTA, profesional_id: RUIZ, inicio: at("14:30"), nombre_completo: "Juan Carlos Pérez" })) as { turno_id: string };
    const [row] = await sql`select calendar_sync from appointments where id = ${booked.turno_id}`;
    expect(row.calendar_sync).toBeNull();
  });
});
