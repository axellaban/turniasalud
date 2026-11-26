import { describe, expect, it } from "vitest";
import { friendlyError } from "./friendly-error";

describe("friendlyError", () => {
  it("traduce los errores que vio la auditoría y guarda el original para el detalle", () => {
    expect(friendlyError('WAHA POST /api/sendText → 422: {"error":"Session status is not as expected"}')).toEqual({
      text: "No se pudo enviar: la línea de WhatsApp estaba desconectada.",
      detail: 'WAHA POST /api/sendText → 422: {"error":"Session status is not as expected"}',
    });
    expect(friendlyError("409, slot_unavailable; ref. 09ad32e6")?.text).toBe("Smile Connect no aceptó el horario: ya estaba ocupado.");
    expect(friendlyError("The requested slot is outside configured hours")?.text).toContain("fuera del horario");
  });

  it("deja como está lo que ya está dicho para una persona", () => {
    expect(friendlyError("Ese turno ya no está en Smile Connect.")).toEqual({ text: "Ese turno ya no está en Smile Connect.", detail: null });
    expect(friendlyError("")).toBeNull();
    expect(friendlyError('{"weird":true}')?.detail).toBe('{"weird":true}');
  });
});
