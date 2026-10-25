// Tratamientos odontológicos que el profesional declara (por ejemplo, en Doctoralia: «Ortodoncia,
// Implantes odontológicos, Estética dental»): arman los turnos de su demo y el ejemplo de su página.
// Puro: lo usan la demo (servidor) y la página pública de la prospección.

export type DentalService = {
  key: "implantes" | "ortodoncia" | "estetica" | "endodoncia" | "odontopediatria" | "protesis" | "periodoncia" | "cirugia";
  /** Cómo se dice en una frase: «hace implantes», «atiende ortodoncia». */
  label: string;
  /** Turno de primera vez que suma a la demo. */
  turno: string;
  duracion_min: number;
  re: RegExp;
};

// En orden de cuánto pesan para el consultorio: el primero que aparece es el del ejemplo.
export const DENTAL_SERVICES: DentalService[] = [
  { key: "implantes", label: "implantes", turno: "Evaluación de implantes", duracion_min: 30, re: /implant/i },
  { key: "ortodoncia", label: "ortodoncia", turno: "Consulta de ortodoncia", duracion_min: 30, re: /ortodon|ortopedia/i },
  { key: "estetica", label: "estética dental", turno: "Consulta de estética dental y blanqueamiento", duracion_min: 30, re: /est[eé]tic|blanque|carillas/i },
  { key: "endodoncia", label: "endodoncia", turno: "Consulta de endodoncia (tratamiento de conducto)", duracion_min: 30, re: /endodon|conducto/i },
  { key: "odontopediatria", label: "odontopediatría", turno: "Consulta de odontopediatría", duracion_min: 30, re: /pediatr|niñ/i },
  { key: "protesis", label: "prótesis", turno: "Consulta de prótesis y rehabilitación", duracion_min: 30, re: /pr[oó]tesis|rehabilit/i },
  { key: "periodoncia", label: "periodoncia", turno: "Consulta de periodoncia", duracion_min: 30, re: /periodon|enc[ií]as/i },
  { key: "cirugia", label: "cirugía bucal", turno: "Consulta de cirugía bucal", duracion_min: 30, re: /cirug/i },
];

/** Los tratamientos que se reconocen en el texto, sin repetir y en el orden de arriba. */
export function dentalServices(text: string | null | undefined): DentalService[] {
  if (!text) return [];
  return DENTAL_SERVICES.filter((s) => s.re.test(text));
}

/** «ortodoncia, implantes y estética dental». */
export function servicesPhrase(services: DentalService[]): string {
  const labels = services.map((s) => s.label);
  return labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} y ${labels.at(-1)}`;
}

/**
 * La conversación de ejemplo de su página y de la vista previa en WhatsApp: sobre su tratamiento
 * principal, con su nombre. Sin precios: Sofi no los sabe en la demo.
 */
export function demoExample(services: DentalService[], professional: string, business: string, short = false): { paciente: string; agente: string } {
  switch (services[0]?.key) {
    case "implantes":
      return { paciente: "Hola, ¿hacen implantes? Quería una evaluación.", agente: `¡Hola! Sí. Tengo el martes a las 10:30 para la evaluación con ${professional}. ¿Te lo reservo?` };
    case "ortodoncia":
      return { paciente: "Hola, ¿atienden ortodoncia? Es para mi hija.", agente: `¡Hola! Sí. Tengo el jueves a las 17 para la consulta con ${professional}. ¿Te lo reservo?` };
    case "estetica":
      return { paciente: "Hola, quería hacerme un blanqueamiento. ¿Tienen turno?", agente: `¡Hola! Sí: el martes a las 10:30 con ${professional}, para ver tu caso. ¿Te lo reservo?` };
    case "endodoncia":
      return { paciente: "Hola, me duele mucho una muela. ¿Me pueden atender?", agente: `¡Hola! Sí: tengo un turno de urgencia hoy a las 18 con ${professional}. ¿Te lo reservo?` };
    case "odontopediatria":
      return { paciente: "Hola, ¿atienden chicos? Mi hijo tiene 6 años.", agente: `¡Hola! Sí: ${professional} atiende odontopediatría. Tengo el jueves a las 17. ¿Te lo reservo?` };
    default:
      return {
        paciente: "Hola, ¿tienen turno para una limpieza esta semana?",
        // En la vista previa de WhatsApp entra poco texto: va sin presentación.
        agente: short
          ? `¡Hola! Sí: el martes a las 10:30 con ${professional}. ¿Te lo reservo?`
          : `¡Hola! Soy Sofi, ${business}. Tengo el martes a las 10:30 o el jueves a las 16 con ${professional}. ¿Cuál te queda mejor?`,
      };
  }
}
