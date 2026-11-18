import { describe, expect, it } from "vitest";
import { smileLine, summaryText, type SummaryItem } from "./daily-summary";
import type { Clinic } from "./types";

// El resumen de las 10 dice si cada turno ya quedó escrito en Smile Connect (pendiente de
// Guerra–Mininni, 16/11). Sin conexión a Smile Connect (smile_sync null), no dice nada.

const clinic = { id: "c", agent_name: "Sofi", timezone: "America/Argentina/Buenos_Aires" } as Clinic;
const item = (smile: string | null): SummaryItem => ({
  turno_id: "t", cuando: "martes 3 a las 10:00", profesional: "Dr. Prueba", prestacion: "Control", paciente: "Ana Ficticia",
  dni: "30111000", celular: "+54 9 11 0000-0001", cobertura: "OSDE", notas: null, dio: "Sofi por WhatsApp", paciente_nuevo: false,
  nota: "Control · OSDE · Dio Sofi por WhatsApp", smile,
});

describe("Smile Connect en el resumen diario", () => {
  it("una línea por estado, distinta para los cancelados", () => {
    expect(smileLine(null, false)).toBeNull();
    expect(smileLine("ok", false)).toBe("Smile Connect: ya está cargado.");
    expect(smileLine("ok", true)).toBe("Smile Connect: ya está cancelado allá.");
    expect(smileLine("pendiente", false)).toBe("Smile Connect: todavía no está cargado allá.");
    expect(smileLine("error", true)).toBe("Smile Connect: todavía no se canceló allá.");
    expect(smileLine("revisar", false)).toContain("revisarlo");
  });

  it("aparece debajo de la nota de cada turno, y no aparece sin conexión", () => {
    const from = new Date("2026-11-17T13:00:00Z");
    const withSmile = summaryText({ from, to: from, nuevos: [item("Smile Connect: ya está cargado.")], movidos: [], cancelados: [] }, clinic);
    expect(withSmile).toContain("Nota: Control · OSDE · Dio Sofi por WhatsApp\nSmile Connect: ya está cargado.");
    const without = summaryText({ from, to: from, nuevos: [item(null)], movidos: [], cancelados: [] }, clinic);
    expect(without).not.toContain("Smile Connect");
  });
});
