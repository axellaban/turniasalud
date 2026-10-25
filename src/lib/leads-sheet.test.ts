import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { appsScriptCode } from "./leads-sheet";

// El código que el usuario pega en Apps Script, corrido con lo mínimo de Apps Script simulado:
// una hoja en memoria.
function entorno() {
  const filas: unknown[][] = [];
  let frozen = 0;
  const hoja = {
    getName: () => "Pedidos de demo",
    getLastRow: () => filas.length,
    appendRow: (r: unknown[]) => { filas.push([...r]); },
    setFrozenRows: (n: number) => { frozen = n; },
    deleteRow: (n: number) => { filas.splice(n - 1, 1); },
    getRange: (row: number, col: number, nrows: number) => ({
      setFontWeight: () => {},
      setValues: (v: unknown[][]) => { filas[row - 1] = [...v[0]]; },
      createTextFinder: (t: string) => ({ matchEntireCell: () => ({ findNext: () => {
        for (let i = row - 1; i < row - 1 + nrows; i++) if (String(filas[i]?.[col - 1]) === t) return { getRow: () => i + 1 };
        return null;
      } }) }),
    }),
  };
  let creada = false;
  const libro = { getName: () => "Turnia · Pedidos", getSheetByName: (n: string) => (n === "Pedidos de demo" && creada ? hoja : null), insertSheet: () => { creada = true; return hoja; } };
  const ctx: Record<string, unknown> & { doPost?: (e: unknown) => unknown } = {
    SpreadsheetApp: { getActive: () => libro },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (s: string) => ({ setMimeType: () => JSON.parse(s) }) },
    JSON, Date, String,
  };
  return { ctx, filas, frozen: () => frozen };
}

it("el código de Apps Script guarda, actualiza y borra pedidos", () => {
  const { ctx, filas, frozen } = entorno();
  runInNewContext(appsScriptCode("clave-123"), ctx);
  const post = (body: object) => ctx.doPost!({ postData: { contents: JSON.stringify(body) } });
  expect(post({ clave: "otra", accion: "probar" })).toEqual({ ok: false, error: "clave" });
  expect(post({ clave: "clave-123", accion: "probar" })).toEqual({ ok: true, planilla: "Turnia · Pedidos" });
  expect(filas[0][0]).toBe("ID");
  expect(frozen()).toBe(1);
  const pedido = { id: "a1", fecha: "2026-10-25T22:00:00.000Z", nombre: "Laura", email: "l@x.com", whatsapp: "5491155550000", consultorio: "Plaza", rol: "", especialidad: "Odontología", profesionales: "2 a 5", mensaje: "Hola", origen: "Formulario", estado: "Nuevo", notas: "", actualizado: "2026-10-25T22:00:00.000Z" };
  expect(post({ clave: "clave-123", accion: "guardar", pedidos: [pedido, { ...pedido, id: "b2", nombre: "Pedro", whatsapp: "" }] })).toEqual({ ok: true, cantidad: 2 });
  expect(filas.length).toBe(3);
  expect(filas[1][4]).toBe("'5491155550000");
  expect(filas[1][1]).toBeInstanceOf(Date);
  expect(filas[2][4]).toBe("");
  // El mismo pedido actualiza su fila, no suma otra.
  post({ clave: "clave-123", accion: "guardar", pedidos: [{ ...pedido, estado: "Contactado", notas: "Llamar" }] });
  expect(filas.length).toBe(3);
  expect(filas[1][11]).toBe("Contactado");
  expect(filas[1][12]).toBe("Llamar");
  expect(post({ clave: "clave-123", accion: "borrar", ids: ["a1"] })).toEqual({ ok: true });
  expect(filas.map((f) => f[0])).toEqual(["ID", "b2"]);
  expect(post({ clave: "clave-123", accion: "borrar", ids: ["no-existe"] })).toEqual({ ok: true });
  expect(ctx.doPost!({ postData: { contents: "no es json" } })).toEqual({ ok: false, error: "json" });
});
