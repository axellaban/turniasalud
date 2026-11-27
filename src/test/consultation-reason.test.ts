import { describe, expect, it } from 'vitest';
import { consultationFields } from '@/lib/consultation-reason';
import { withBookingNote } from '@/lib/smile-connect-note';

describe('motivo de consulta y recuperación de notas', () => {
  it('pide el motivo faltante solo cuando la clínica lo exige; acepta consulta general', () => {
    expect(() => consultationFields({}, true)).toThrow('pregunte el motivo');
    expect(() => consultationFields({ motivo_consulta: 'Consulta general' }, true)).toThrow('Clasifique');
    expect(consultationFields({ motivo_consulta: ' Consulta  general ', categorias_motivo: 'general' }, true))
      .toEqual({ consultation_reason: 'Consulta general', consultation_categories: ['general'], patient_first_visit: null });
    expect(consultationFields({}, false).consultation_reason).toBeNull();
  });
  it('conserva las palabras y varios intereses expresados, sin inferir primera vez', () => {
    expect(consultationFields({ motivo_consulta: 'Quiero consultar por un implante y una corona', categorias_motivo: 'implantes,protesis,implantes' }, true))
      .toMatchObject({ consultation_categories: ['implantes', 'protesis'], patient_first_visit: null });
    expect(consultationFields({ primera_vez: false }, false).patient_first_visit).toBe(false);
    expect(() => consultationFields({ categorias_motivo: 'urgencia' }, false)).toThrow('categorías');
  });
  it('completa una nota aparte, de forma idempotente y sin borrar lo que escribió recepción', () => {
    const desired = 'Consulta · Lo dio Sofi (Turnia)\nMotivo: consultar por implante';
    const next = withBookingNote('Prefiere por la tarde', desired);
    expect(next).toBe(`Prefiere por la tarde\n${desired}`);
    expect(withBookingNote(next, desired)).toBe(next);
    expect(withBookingNote('Nota del equipo\n\nObra social: OSDE\nFicha de salud: actualizada',
      'Obra social: Particular\nFicha de salud: anterior\nMotivo: control'))
      .toBe('Nota del equipo\n\nObra social: OSDE\nFicha de salud: actualizada\nMotivo: control');
    expect(() => withBookingNote('Motivo: otro motivo corregido por recepción', desired)).toThrow('Recepción cambió');
    expect(() => withBookingNote('x'.repeat(2000), desired)).toThrow('espacio');
  });
});
