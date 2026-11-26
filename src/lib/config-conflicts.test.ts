import { describe, expect, it } from "vitest";
import { amountsInText, configConflicts, faqMentionsPayment, noticeHoursInText, type ConflictInput } from "./config-conflicts";

const base: ConflictInput = { faq: null, policies: null, agent_context: null, payment_methods: null, cancel_notice_hours: null, reschedule_notice_hours: null };

describe("noticeHoursInText", () => {
  it("lee las horas de aviso para cancelar y para mover", () => {
    const text = "- Cancelaciones con al menos 24 h de anticipación.\n- Para reprogramar, avisar con 48 horas.";
    expect(noticeHoursInText(text, "cancelar")).toBe(24);
    expect(noticeHoursInText(text, "mover")).toBe(48);
  });

  it("entiende días y no confunde la tolerancia con el aviso", () => {
    expect(noticeHoursInText("Si cancelás, avisá con 1 día de anticipación.", "cancelar")).toBe(24);
    expect(noticeHoursInText("- Tolerancia de 15 minutos.", "cancelar")).toBeNull();
  });
});

describe("configConflicts", () => {
  it("avisa cuando el texto pide 24 h pero el campo está vacío (el caso de la auditoría)", () => {
    const [c] = configConflicts({ ...base, policies: "- Cancelaciones con al menos 24 h de anticipación." }, []);
    expect(c.key).toBe("aviso-cancelar");
    expect(c.message).toContain("24 horas");
    expect(c.href).toContain("/turnos");
  });

  it("avisa si el texto y el campo dicen números distintos, y calla si coinciden", () => {
    const policies = "Cancelaciones con 24 h de aviso.";
    expect(configConflicts({ ...base, policies, cancel_notice_hours: 12 }, [])[0].message).toContain("12 horas");
    expect(configConflicts({ ...base, policies, cancel_notice_hours: 24 }, [])).toEqual([]);
  });

  it("marca un precio de las preguntas frecuentes que no es de ninguna prestación", () => {
    const faq = "- Consulta particular: $45.000. Limpieza $ 40000.";
    expect(amountsInText(faq)).toEqual([45000, 40000]);
    expect(configConflicts({ ...base, faq }, [40000, 45000])).toEqual([]);
    expect(configConflicts({ ...base, faq }, [40000, 50000])[0].key).toBe("precios");
    // Sin precios cargados no hay con qué comparar: lo pide el indicador de ficha completa.
    expect(configConflicts({ ...base, faq }, [])).toEqual([]);
  });

  it("formas de pago en dos lugares", () => {
    const faq = "Se aceptan efectivo, débito y transferencia.";
    expect(faqMentionsPayment(faq)).toBe(true);
    expect(configConflicts({ ...base, faq, payment_methods: "Efectivo" }, [])[0].key).toBe("pago");
    expect(configConflicts({ ...base, faq }, [])).toEqual([]);
  });
});

describe("configConflicts con la agenda", () => {
  const r = (professional_id: string, weekday: number, start: string, end: string) => ({ professional_id, weekday, start_time: `${start}:00`, end_time: `${end}:00`, urgent_only: false, appointment_type_ids: null });
  const agenda = {
    schedules: [r("c", 1, "09:00", "17:30"), r("m", 1, "10:00", "17:30"), r("m", 4, "10:00", "18:30"), r("m", 5, "11:00", "17:30")],
    professionals: new Map([["c", "Coldeira"], ["m", "Mininni"]]),
  };

  it("avisa si el horario que dice Sofi quedó viejo contra la agenda", () => {
    const [c] = configConflicts({ ...base, hours_text: "Lunes de 10 a 17:30, jueves de 10 a 18:30 y viernes de 11 a 17:30" }, [], agenda);
    expect(c).toMatchObject({ key: "horario", href: "/panel/configuracion#datos" });
    expect(c.message).toContain("Lunes de 9 a 17:30, jueves de 10 a 18:30 y viernes de 11 a 17:30»");
    expect(configConflicts({ ...base, hours_text: "Lunes de 9 a 17:30, jueves de 10 a 18:30 y viernes de 11 a 17:30" }, [], agenda)).toEqual([]);
  });

  it("cuenta, como dato y no como error, el día con horarios en que Sofi no da turnos (el viernes de la auditoría)", () => {
    const [c] = configConflicts({ ...base, booking_weekdays: [1, 2, 3, 4] }, [], agenda);
    expect(c).toMatchObject({ key: "dias-sin-turnos", tone: "info" });
    expect(c.message).toContain("viernes (Mininni)");
    expect(configConflicts({ ...base, booking_weekdays: null }, [], agenda)).toEqual([]);
  });

  it("marca el trato del texto que contradice el selector", () => {
    expect(configConflicts({ ...base, agent_context: "Tratá siempre de usted." }, [])[0].key).toBe("trato");
    expect(configConflicts({ ...base, tone: "usted", agent_context: "Tratá siempre de usted." }, [])).toEqual([]);
    expect(configConflicts({ ...base, tone: "usted", faq: "Tuteá a los pacientes." }, [])[0].key).toBe("trato");
  });

  it("no marca el matiz condicional del mismo trato (el falso positivo de la segunda revisión)", () => {
    const agent_context = "Tratar siempre de usted, en todos los mensajes. Solo tutear si el paciente lo pide.";
    expect(configConflicts({ ...base, tone: "usted", agent_context }, [])).toEqual([]);
    expect(configConflicts({ ...base, tone: "usted", agent_context: "Tratá de vos si es un chico." }, [])).toEqual([]);
    expect(configConflicts({ ...base, tone: "vos", agent_context: "Hablá de usted cuando el paciente es mayor." }, [])).toEqual([]);
    // Lo que no es una orden de trato tampoco cuenta.
    expect(configConflicts({ ...base, tone: "usted", faq: "Atendemos de vos a vos, sin intermediarios." }, [])).toEqual([]);
  });
});
