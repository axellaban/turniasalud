import { describe, expect, it } from "vitest";
import { imagenPagina, imagenPortada } from "./og";

// WhatsApp no muestra la miniatura si pesa más de ~300 KB: en PNG, las que llevan la foto pasaban los 500.
describe("miniaturas para compartir", () => {
  it("salen en JPEG y livianas, también las que llevan la foto", async () => {
    for (const imagen of [await imagenPortada(), await imagenPagina({ eyebrow: "Turnos", titulo: "Turnos por WhatsApp, las 24 horas" })]) {
      expect(imagen.headers.get("content-type")).toBe("image/jpeg");
      const bytes = Buffer.from(await imagen.arrayBuffer());
      expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
      expect(bytes.length).toBeLessThan(150_000);
    }
  }, 30000);
});
