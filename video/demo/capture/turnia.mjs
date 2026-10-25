// Captura el panel real de Turnia corriendo en local con datos ficticios.
// Requiere: Postgres local con supabase/schema.sql + supabase/seed.sql + capture/turnia/seed-video*.sql,
// y `next start` con DATABASE_URL apuntando a esa base (ver README).
// Uso: node capture/turnia.mjs [--base=http://localhost:3100] [--code=VDEM-PZAP-TURA-2345]
import path from "node:path";
import { openBrowser, Recorder, hide } from "./lib.mjs";

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) || d;
const base = arg("base", "http://localhost:3100");
const code = arg("code", "VDEM-PZAP-TURA-2345");
const out = path.resolve("public/turnia");
const rec = new Recorder(out);
const { browser, context } = await openBrowser();
const page = await context.newPage();

await page.goto(base + "/panel/login");
await page.locator("input[type=password]").fill(code);
await page.locator("button[type=submit]").click();
await page.waitForURL(/\/panel(\/|$|\?)/);
await page.waitForTimeout(800);

const nav = {
  navAgenda: "aside a[href='/panel/agenda'], nav a[href='/panel/agenda']",
  navConv: "aside a[href='/panel/conversaciones'], nav a[href='/panel/conversaciones']",
  navTareas: "aside a[href='/panel/tareas'], nav a[href='/panel/tareas']",
  navCamp: "aside a[href='/panel/campanas'], nav a[href='/panel/campanas']",
};
const go = async (p) => {
  await page.goto(base + p, { waitUntil: "load" });
  await page.waitForTimeout(1200);
};

await go("/panel/agenda?fecha=2026-10-26&vista=dia");
await rec.shot(page, "agenda-dia", { ...nav, jorge: "text=Jorge Pérez", fernandez: "text=Dra. Lucía Fernández" });
await go("/panel/agenda?fecha=2026-10-26");
await rec.shot(page, "agenda-semana", { ...nav, lunes: "text=26 oct – 1 nov 2026" });
await go("/panel/conversaciones");
await rec.shot(page, "conversaciones", { ...nav, jorge: page.locator("a:has-text('Jorge Pérez')").first() });
await page.locator("a:has-text('Jorge Pérez')").first().click();
await page.waitForURL(/conversaciones\/.+/);
await page.waitForTimeout(1200);
await rec.shot(page, "conversacion", { ...nav, resumen: "text=Resumen", transcript: "text=Transcripción", tarea: "text=Tareas creadas" });
await go("/panel/tareas");
await rec.shot(page, "tareas", { ...nav, receta: "text=Renovar receta de antiinflamatorio" });
await go("/panel/campanas");
await rec.shot(page, "campanas", { ...nav, base: "text=Tu base para volver a agendar", vencidos: "text=Controles vencidos", revisar: page.getByRole("button", { name: /Revisar y enviar/ }).first().or(page.getByRole("link", { name: /Revisar y enviar/ }).first()) });
rec.save({ base });
await browser.close();
