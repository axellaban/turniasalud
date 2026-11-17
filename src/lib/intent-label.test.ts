import { describe, expect, it } from "vitest";
import { intentLabel } from "@/components/ui";

// El motivo de cada charla se muestra como lo diría recepción, no con el código interno.
describe("intentLabel", () => {
  it("traduce los motivos que anota ElevenLabs", () => {
    expect(intentLabel("agendar")).toBe("Pidió turno");
    expect(intentLabel("consulta_informativa")).toBe("Consulta");
    expect(intentLabel("orden_medica")).toBe("Orden médica");
  });

  it("un motivo nuevo se lee igual, con mayúscula y sin guiones bajos", () => {
    expect(intentLabel("pedido_especial")).toBe("Pedido especial");
  });
});
