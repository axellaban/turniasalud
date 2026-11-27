import type { Professional } from "./types";

export type ProfessionalGender = "mujer" | "hombre";

/**
 * Si es una profesional o un profesional, para cuando el paciente pide «con una mujer».
 * Vale lo cargado en Configuración → Equipo; si no, el título del nombre («Dra.», «Dr.»).
 * Sin ninguno de los dos, no se sabe: nunca se adivina por el nombre de pila.
 */
export function professionalGender(p: Pick<Professional, "full_name"> & { gender?: string | null }): ProfessionalGender | null {
  if (p.gender === "mujer" || p.gender === "hombre") return p.gender;
  const title = p.full_name.trim().toLowerCase().match(/^(dra|dr)(?:\.|\s|$)/)?.[1];
  if (title === "dra") return "mujer";
  if (title === "dr") return "hombre";
  return null;
}
