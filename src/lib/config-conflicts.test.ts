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
