import { describe, expect, it } from "vitest";
import { groupBlocks } from "./block-groups";

const TZ = "America/Argentina/Buenos_Aires";
// Medianoche en Buenos Aires = 03:00 UTC.
const mid = (d: string) => `${d}T03:00:00.000Z`;
const pros = new Map([["c", "Dra. Coldeira"], ["m", "Dr. Mininni"]]);
const b = (id: string, pro: string | null, from: string, to: string, extra: Record<string, unknown> = {}) => ({ id, professional_id: pro, starts_at: from, ends_at: to, reason: null, ...extra });

describe("groupBlocks", () => {
  it("junta los profesionales del mismo día y los días seguidos (12 tarjetas → 1 renglón)", () => {
    const days = ["2026-12-01", "2026-12-02", "2026-12-03"];
    const next = (d: string) => new Date(Date.parse(mid(d)) + 86_400_000).toISOString();
    const blocks = days.flatMap((d, i) => [b(`c${i}`, "c", mid(d), next(d), { external_id: `sc:e${i}` }), b(`m${i}`, "m", mid(d), next(d), { external_id: `sc:f${i}` })]);
    const groups = groupBlocks(blocks, pros, TZ);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ who: "Dr. Mininni y Dra. Coldeira", when: "del mar 1 dic al jue 3 dic · todo el día", fromSmile: true });
    expect(groups[0].ids).toHaveLength(6);
  });

  it("un día suelto se lee como un día, y un rango con horas, con sus horas", () => {
    expect(groupBlocks([b("1", null, mid("2026-12-08"), mid("2026-12-09"), { reason: "Feriado" })], pros, TZ)[0])
      .toMatchObject({ who: "Toda la clínica", when: "mar 8 dic · todo el día", reason: "Feriado", fromSmile: false });
    expect(groupBlocks([b("1", "c", "2026-12-08T17:00:00.000Z", "2026-12-08T21:00:00.000Z")], pros, TZ)[0].when).toBe("mar 8 dic, 14:00 a 18:00");
  });

  it("no junta motivos distintos", () => {
    const g = groupBlocks([b("1", "c", mid("2026-12-01"), mid("2026-12-02"), { reason: "Congreso" }), b("2", "c", mid("2026-12-02"), mid("2026-12-03"), { reason: "Vacaciones" })], pros, TZ);
    expect(g).toHaveLength(2);
  });
});
