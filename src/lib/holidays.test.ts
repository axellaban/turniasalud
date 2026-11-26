import { describe, expect, it } from "vitest";
import { fetchArgentineHolidays, holidaysToLoad } from "./holidays";

const sample = [
  { fecha: "2026-12-07", tipo: "puente", nombre: "Puente turístico no laborable" },
  { fecha: "2026-12-08", tipo: "inamovible", nombre: "Día de la Inmaculada Concepción de María" },
  { fecha: "2026-12-25", tipo: "inamovible", nombre: "Navidad" },
  { fecha: "2026-05-01", tipo: "inamovible", nombre: "Día del Trabajador" },
  { fecha: "mal", tipo: "inamovible" },
];

describe("feriados nacionales", () => {
  it("lee el calendario y descarta lo inválido", async () => {
    const list = await fetchArgentineHolidays(2026, (async () => Response.json(sample)) as typeof fetch);
    expect(list).toHaveLength(4);
    expect(list[2]).toEqual({ date: "2026-12-25", name: "Navidad", kind: "inamovible" });
  });

  it("carga solo los que faltan, desde hoy, y los puentes solo si se piden", async () => {
    const list = await fetchArgentineHolidays(2026, (async () => Response.json(sample)) as typeof fetch);
    const base = { today: "2026-11-26", until: "2027-11-26", loaded: new Set(["2026-12-25"]) };
    expect(holidaysToLoad(list, { ...base, bridges: false }).map((h) => h.date)).toEqual(["2026-12-08"]);
    expect(holidaysToLoad(list, { ...base, bridges: true }).map((h) => h.date)).toEqual(["2026-12-07", "2026-12-08"]);
  });

  it("avisa si el calendario no responde", async () => {
    await expect(fetchArgentineHolidays(2026, (async () => new Response("", { status: 503 })) as typeof fetch)).rejects.toThrow("503");
  });
});
