import { describe, expect, it } from "vitest";
import {
  cleanSmileConnectCoverage,
  extractSmileConnectJsonText,
  parseSmileConnectPayload,
  parseSmileConnectPhone,
  parseSmileConnectSex,
  splitSmileConnectBatches,
} from "./smile-connect-parse";

async function buildFakeZip(fileName: string, content: string): Promise<Uint8Array> {
  const nameBytes = new TextEncoder().encode(fileName);
  const rawBytes = new TextEncoder().encode(content);
  const compressedStream = new Blob([rawBytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const compressed = new Uint8Array(await new Response(compressedStream).arrayBuffer());

  const localHeader = new Uint8Array(30 + nameBytes.length);
  const lv = new DataView(localHeader.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(8, 8, true); // deflate
  lv.setUint32(18, compressed.length, true);
  lv.setUint32(22, rawBytes.length, true);
  lv.setUint16(26, nameBytes.length, true);
  localHeader.set(nameBytes, 30);

  const cdOffset = localHeader.length + compressed.length;
  const cdHeader = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(cdHeader.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 20, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(10, 8, true);
  cv.setUint32(20, compressed.length, true);
  cv.setUint32(24, rawBytes.length, true);
  cv.setUint16(28, nameBytes.length, true);
  cv.setUint32(42, 0, true);
  cdHeader.set(nameBytes, 46);

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, cdHeader.length, true);
  ev.setUint32(16, cdOffset, true);

  const out = new Uint8Array(localHeader.length + compressed.length + cdHeader.length + eocd.length);
  out.set(localHeader, 0);
  out.set(compressed, localHeader.length);
  out.set(cdHeader, cdOffset);
  out.set(eocd, cdOffset + cdHeader.length);
  return out;
}

describe("smile-connect-parse", () => {
  const NOW = new Date("2026-11-02T15:00:00.000Z");

  it("normaliza teléfonos argentinos, locales sin área e internacionales extranjeros", () => {
    expect(parseSmileConnectPhone("11 5555-0001", "AR", "11")).toEqual({ phone: "5491155550001", note: null });
    expect(parseSmileConnectPhone("4555-0123", null, "11")).toEqual({ phone: "5491145550123", note: null });
    expect(parseSmileConnectPhone("3055550199", "1", "11")).toEqual({ phone: "13055550199", note: null });
    expect(parseSmileConnectPhone("123", "AR", "11")).toEqual({ phone: null, note: "Teléfono en Smile Connect: 123" });
  });

  it("normaliza sexo y coberturas habituales", () => {
    expect(parseSmileConnectSex("female")).toBe("femenino");
    expect(parseSmileConnectSex("male")).toBe("masculino");
    expect(parseSmileConnectSex("O")).toBe("otro");
    expect(cleanSmileConnectCoverage("osde")).toBe("OSDE");
    expect(cleanSmileConnectCoverage("SWISS MEDICAL")).toBe("Swiss Medical");
    expect(cleanSmileConnectCoverage("PARTICULARES")).toBe("Particular");
  });

  it("unifica turnos duplicados del mismo paciente y conserva sobreturnos reales de pacientes distintos", () => {
    const raw = {
      clinica: {
        professionals: [
          { professional_id: 10, name: "Mariano", surname: "Prueba", active: true, box_id: 1 },
          { professional_id: 20, name: "Emilia", surname: "Prueba", active: true, box_id: 2 },
        ],
        boxes: [
          { box_id: 1, name: "Consultorio 1" },
          { box_id: 2, name: "Consultorio 2" },
        ],
      },
      pacientes: [
        {
          lista: { patient_id: 100, name: "Ana", surname: "Sintética", phone_number: "1155550100", phone_country_code: "AR", last_attended_date: "2026-05-10" },
          ficha: { patient_id: 100, name: "Ana", surname: "Sintética", id_number: "30111222", birth_day: "1990-04-15T00:00:00.000Z", sex: "female", medical_insurance_name: "Osde", medical_insurance_plan: "210" },
        },
        {
          lista: { patient_id: 200, name: "Beto", surname: "Sobreturno", phone_number: "1155550200", phone_country_code: "54" },
          ficha: { patient_id: 200, name: "Beto", surname: "Sobreturno", id_number: "31222333", sex: "male" },
        },
      ],
      turnos: [
        // Par duplicado del MISMO paciente (100) en dos consultorios a la misma hora -> se unifica en 1 turno con 2 profesionales
        {
          appointment_id: 5002,
          start_date: "2026-11-10T16:30:00.000Z",
          end_date: "2026-11-10T17:30:00.000Z",
          patient_id: 100,
          professional_ids: [20],
          box_id: 2,
          patient_attended: "Whatsapp Sent",
          notes: "Rehabilitación",
          created_at: "2026-10-20T12:00:00.000Z",
        },
        {
          appointment_id: 5001,
          start_date: "2026-11-10T16:30:00.000Z",
          end_date: "2026-11-10T17:30:00.000Z",
          patient_id: 100,
          professional_ids: [10, 20],
          box_id: 1,
          patient_attended: null,
          notes: "Rehabilitación",
          created_at: "2026-10-20T12:00:00.000Z",
        },
        // Sobreturno REAL de otro paciente (200) en ese mismo horario con profesional 10 -> se conserva
        {
          appointment_id: 5003,
          start_date: "2026-11-10T16:45:00.000Z",
          end_date: "2026-11-10T17:15:00.000Z",
          patient_id: 200,
          professional_ids: [10],
          box_id: 1,
          patient_attended: "Whatsapp Sent",
          notes: "Control rápido",
          created_at: "2026-11-01T10:00:00.000Z",
        },
        // Turno huérfano (paciente 999 no está en pacientes[]) en el pasado sin marcar -> crea ficha inline y queda atendido
        {
          appointment_id: 4000,
          start_date: "2026-04-20T14:00:00.000Z",
          end_date: "2026-04-20T14:30:00.000Z",
          patient_id: 999,
          professional_id: 10,
          patient_attended: "Whatsapp Sent",
          patient_name: "Carlos",
          patient_surname: "Inline",
          patient_phone_number: "1155550999",
          patient_phone_country_code: "AR",
          is_first_appointment: true,
        },
        // Turno futuro cancelado
        {
          appointment_id: 5004,
          start_date: "2026-11-12T15:00:00.000Z",
          end_date: "2026-11-12T15:30:00.000Z",
          patient_id: 200,
          professional_ids: [20],
          patient_attended: "Canceled with Notice",
        },
      ],
      bloqueos_agenda: [
        {
          event_id: 70,
          name: "outOfService",
          type: "outOfService",
          start_date: "2026-11-23T03:00:00.000Z",
          end_date: "2026-11-24T02:59:59.999Z",
          professional_id: 10,
          notes: "Feriado nacional",
        },
      ],
    };

    const parsed = parseSmileConnectPayload(raw, { now: NOW });
    expect(parsed.patients).toHaveLength(3);
    expect(parsed.patients.find((p) => p.externalId === "sc:100")).toMatchObject({
      fullName: "Ana Sintética",
      dni: "30111222",
      birthDate: "1990-04-15",
      sex: "femenino",
      coverage: "OSDE",
      coveragePlan: "210",
      lastAttendedDate: "2026-05-10",
    });
    expect(parsed.patients.find((p) => p.externalId === "sc:999")).toMatchObject({
      fullName: "Carlos Inline",
      phone: "5491155550999",
    });

    expect(parsed.preview).toMatchObject({
      patients: 3,
      appointmentsTotal: 4,
      appointmentsFuture: 2,
      appointmentsPast: 1,
      appointmentsCancelled: 1,
      remindersAlreadySent: 2,
      duplicatesMerged: 1,
      sobreturnos: 1,
      blocksTotal: 1,
      blocksFuture: 1,
    });

    const unified = parsed.appointments.find((a) => a.externalId === "sc:5001")!;
    expect(unified.mergedExternalIds).toEqual(["sc:5002"]);
    expect(unified.professionalExternalIds).toEqual(["10", "20"]);
    expect(unified.reminderSent).toBe(true);
    expect(unified.notes).toContain("Consultorio 1");
    expect(unified.notes).toContain("Consultorio 2");

    const pastOrphan = parsed.appointments.find((a) => a.externalId === "sc:4000")!;
    expect(pastOrphan.status).toBe("atendido");
    expect(pastOrphan.explicitlyAttended).toBe(false);

    expect(parsed.blocks[0]).toEqual({
      externalId: "sc:70",
      professionalExternalId: "10",
      startsAt: "2026-11-23T03:00:00.000Z",
      endsAt: "2026-11-24T03:00:00.000Z",
      reason: "Fuera de servicio · Feriado nacional",
    });

    const batches = splitSmileConnectBatches(parsed, 2);
    expect(batches).toHaveLength(2);
    expect(batches[0].blocks).toHaveLength(1);
    expect(batches[1].blocks).toHaveLength(0);
  });

  it("extrae datos-completos.json desde un ZIP comprimido y rechaza ZIPs de adjuntos", async () => {
    const sample = JSON.stringify({ turnos: [], pacientes: [], bloqueos_agenda: [] });
    const zipBytes = await buildFakeZip("datos-completos.json", sample);
    expect(await extractSmileConnectJsonText(zipBytes)).toBe(sample);

    const wrongZip = await buildFakeZip("adjunto-radiografia.png", "binario");
    await expect(extractSmileConnectJsonText(wrongZip)).rejects.toThrow("datos-completos.json");
  });
});
