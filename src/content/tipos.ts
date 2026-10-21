// Tipos del contenido de la web pública. Todo el texto vive en src/content/*.ts
// para poder editarlo sin tocar los componentes.

export type Beneficio = { titulo: string; texto: string };

export type BloqueBeneficios = { titulo: string; items: Beneficio[] };

export type Faq = { pregunta: string; respuesta: string };

/** Ícono de línea dibujado en `src/components/site/iconos.tsx`. */
export type IconoClave =
  | "calendario"
  | "triage"
  | "admision"
  | "luna"
  | "megafono"
  | "receta"
  | "derivacion"
  | "pago"
  | "tareas"
  | "hueso"
  | "piel"
  | "ojo"
  | "mujer"
  | "bebe"
  | "estetoscopio"
  | "oido"
  | "dolor"
  | "corazon"
  | "rinon"
  | "cerebro"
  | "estomago"
  | "pie"
  | "mente"
  | "imagen"
  | "celula"
  | "ambulancia"
  | "diente"
  | "hospital"
  | "edificio"
  | "red"
  | "whatsapp"
  | "telefono"
  | "chat"
  | "web"
  | "escudo"
  | "memoria"
  | "rayo"
  | "grafico"
  | "reloj"
  | "lista";

export type CasoDeUso = {
  slug: string;
  /** Nombre corto para menús y footer. */
  nombre: string;
  icono: IconoClave;
  /** Línea chica sobre el título del hero. */
  eyebrow: string;
  titulo: string;
  bajada: string;
  /** Tres bloques de tres beneficios, como las páginas de casos de uso de Assort. */
  bloques: BloqueBeneficios[];
  porque: { titulo: string; items: string[] };
  faqs: Faq[];
};

export type Especialidad = {
  slug: string;
  nombre: string;
  icono: IconoClave;
  eyebrow: string;
  titulo: string;
  bajada: string;
  /** Flujos propios de la especialidad que resuelve el agente (4 a 6). */
  flujos: Beneficio[];
  /** Ejemplo de lo que pide un paciente y cómo lo resuelve Turnia. */
  ejemplo: { paciente: string; agente: string };
  /** Slug de `src/content/conversaciones.ts` si hay demo de audio. */
  demo?: string;
  faqs: Faq[];
};

export type Organizacion = {
  slug: string;
  nombre: string;
  icono: IconoClave;
  eyebrow: string;
  titulo: string;
  bajada: string;
  bloques: BloqueBeneficios[];
  faqs: Faq[];
};
