import { describe, expect, it } from "vitest";
import { CLINIC_GROUPS, clinicOptions, type ClinicRow } from "./clinic-options";

const row = (o: Partial<ClinicRow> & Pick<ClinicRow, "id" | "name">): ClinicRow => ({
  created_at: "2026-11-03T15:00:00Z", is_demo: true, retained: false, person: null, spoke: false, ...o,
});

describe("selector de clínicas", () => {
  const rows: ClinicRow[] = [
    row({ id: "plaza000-0000", name: "Centro Médico Plaza (demo)", is_demo: false }),
    row({ id: "mininni0-0000", name: "Consultorio Odontológico Dr. Guerra y Dr. Mininni", retained: true }),
    row({ id: "favaloro-0000", name: "favaloro" }),
    // Pescatori armó tres demos y habló en la del medio; Raimondi armó una y no dijo nada.
    row({ id: "pesca001-0000", name: "Consultorio de Marcela Gabriela Pescatori", person: "Marcela Gabriela Pescatori", created_at: "2026-11-03T22:26:00Z" }),
    row({ id: "pesca002-0000", name: "Consultorio de Marcela Gabriela Pescatori", person: "Marcela Gabriela Pescatori", created_at: "2026-11-04T23:43:00Z", spoke: true }),
    row({ id: "pesca003-0000", name: "Consultorio de Marcela Gabriela Pescatori", person: "Marcela Gabriela Pescatori", created_at: "2026-11-08T10:08:00Z" }),
    row({ id: "raimo001-0000", name: "Consultorio Odontológico Raimondi", person: "Sofía Victoria Raimondi" }),
  ];

  it("agrupa las clínicas, deja una demo por persona de la prospección y aparte las pruebas", () => {
    const options = clinicOptions(rows, "plaza000-0000", "America/Argentina/Buenos_Aires");
    expect(options).toEqual([
      { id: "plaza000-0000", label: "Centro Médico Plaza (demo) · principal", group: CLINIC_GROUPS.clinicas },
      { id: "mininni0-0000", label: "Consultorio Odontológico Dr. Guerra y Dr. Mininni · conservada", group: CLINIC_GROUPS.clinicas },
      // La de Pescatori es la última en la que habló con Sofi, no la última que armó.
      { id: "pesca002-0000", label: "Marcela Gabriela Pescatori · habló con Sofi · 3 demos", group: CLINIC_GROUPS.prospeccion },
      { id: "raimo001-0000", label: "Sofía Victoria Raimondi · no habló con Sofi", group: CLINIC_GROUPS.prospeccion },
      { id: "favaloro-0000", label: "favaloro", group: CLINIC_GROUPS.otras },
    ]);
  });

  it("la clínica abierta siempre figura, aunque no sea la elegida para esa persona", () => {
    const options = clinicOptions(rows, "pesca003-0000", "America/Argentina/Buenos_Aires");
    expect(options.filter((o) => o.group === CLINIC_GROUPS.prospeccion).map((o) => o.id)).toEqual(["pesca002-0000", "pesca003-0000", "raimo001-0000"]);
    expect(options.find((o) => o.id === "pesca003-0000")!.label).toMatch(/^Marcela Gabriela Pescatori · demo del /);
  });
});
