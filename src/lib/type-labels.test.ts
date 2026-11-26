import { describe, expect, it } from "vitest";
import { typeLabels } from "./type-labels";

describe("typeLabels", () => {
  it("deja los nombres únicos como están y distingue los repetidos", () => {
    const labels = typeLabels([
      { id: "1", name: "Consulta", specialty: "Odontología", duration_min: 30 },
      { id: "2", name: "Turno Smile Connect", specialty: "Endodoncia", duration_min: 30 },
      { id: "3", name: "Turno Smile Connect", specialty: "Odontología", duration_min: 30 },
      { id: "4", name: "Limpieza", specialty: "Odontología", duration_min: 30 },
      { id: "5", name: "Limpieza", specialty: "Odontología", duration_min: 45 },
    ]);
    expect([...labels.values()]).toEqual([
      "Consulta",
      "Turno Smile Connect (Endodoncia)",
      "Turno Smile Connect (Odontología)",
      "Limpieza (Odontología · 30 min)",
      "Limpieza (Odontología · 45 min)",
    ]);
  });
});
