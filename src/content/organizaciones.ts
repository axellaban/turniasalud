import type { Organizacion } from "./tipos";

// Páginas /organizaciones/[slug]. Equivalentes argentinos de FQHC, Health Systems
// y Multi-Specialty de Assort, con texto propio. Sin clientes ni métricas inventadas.

export const ORGANIZACIONES: Organizacion[] = [
  {
    slug: "caps-centros-de-salud",
    nombre: "CAPS y centros de salud",
    icono: "hospital",
    eyebrow: "Para CAPS y centros de atención primaria",
    titulo: "Más acceso para la comunidad, con el mismo equipo",
    bajada:
      "Turnos, información y seguimiento por WhatsApp para centros de salud con alta demanda, pacientes sin prepaga y equipos que no dan abasto.",
    bloques: [
      {
        titulo: "Acceso para toda la comunidad",
        items: [
          {
            titulo: "WhatsApp y audios",
            texto: "Los vecinos piden turno como ya se comunican: por WhatsApp, por escrito o con audios, a cualquier hora.",
          },
          {
            titulo: "Sin filas a las 6 de la mañana",
            texto: "Los turnos programados se dan por mensaje y la demanda espontánea queda para lo que no puede esperar.",
          },
          {
            titulo: "Lenguaje simple",
            texto: "Respuestas claras y cortas, sin tecnicismos, pensadas para cualquier paciente.",
          },
        ],
      },
      {
        titulo: "Cobertura pública y social",
        items: [
          {
            titulo: "Pacientes sin cobertura",
            texto: "Registra al paciente con su DNI aunque no tenga obra social y lo asigna a los turnos que correspondan.",
          },
          {
            titulo: "PAMI e Incluir Salud",
            texto: "Toma la cobertura y el número de afiliado para que el equipo no tenga que pedirlos de nuevo.",
          },
          {
            titulo: "Órdenes por foto",
            texto: "Las derivaciones y órdenes llegan por foto y quedan adjuntas como tarea para el equipo.",
          },
        ],
      },
      {
        titulo: "Seguimiento que llega",
        items: [
          {
            titulo: "Controles y vacunas",
            texto: "Recall de controles de niño sano, embarazo y crónicos según lo que defina el centro.",
          },
          {
            titulo: "Menos ausentismo",
            texto: "Recordatorios con confirmación y recupero de ausentes para reutilizar cada turno.",
          },
          {
            titulo: "Equipo enfocado",
            texto: "Lo que necesita una persona llega como tarea con el resumen, para atender sin repetir preguntas.",
          },
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿Sirve para centros con mucha demanda espontánea?",
        respuesta:
          "Sí. Turnia ordena los turnos programados y la información, y deja la demanda espontánea para la atención presencial.",
      },
      {
        pregunta: "¿Funciona con pacientes sin smartphone?",
        respuesta: "Puede atender también por teléfono si se conecta una línea, con el mismo agente y la misma agenda.",
      },
      {
        pregunta: "¿Puede manejar varios centros de un municipio?",
        respuesta:
          "El esquema es multi-clínica. Hoy cada despliegue opera una clínica activa; la gestión centralizada de varias sedes está en desarrollo.",
      },
      {
        pregunta: "¿Se integra con el sistema de historia clínica del municipio?",
        respuesta: "Hoy Turnia usa su propia agenda. Las integraciones con sistemas locales se evalúan a pedido.",
      },
      {
        pregunta: "¿Cómo se cuidan los datos personales?",
        respuesta:
          "Los datos quedan en la base de la institución, solo el servidor accede, y la política sigue la Ley 25.326. Recomendamos revisarla con su área legal.",
      },
    ],
  },
  {
    slug: "sanatorios-y-redes",
    nombre: "Sanatorios y redes",
    icono: "red",
    eyebrow: "Para sanatorios y redes de salud",
    titulo: "Un solo agente para todas tus sedes",
    bajada:
      "Descomprimí el call center: turnos, información y derivaciones para múltiples especialidades y sedes, con reglas por profesional y cobertura.",
    bloques: [
      {
        titulo: "Descomprimí el call center",
        items: [
          {
            titulo: "Volumen sin límites",
            texto: "El agente atiende todas las conversaciones a la vez, en horas pico y fuera de horario.",
          },
          {
            titulo: "Derivación con contexto",
            texto: "Cuando hace falta una persona, transfiere la llamada o crea una tarea con el resumen completo.",
          },
          {
            titulo: "Guardia y turnos separados",
            texto: "Distingue lo urgente, que va a guardia o al 107, de lo que se resuelve con un turno.",
          },
        ],
      },
      {
        titulo: "Reglas complejas, bien aplicadas",
        items: [
          {
            titulo: "Por profesional y cobertura",
            texto: "Cada profesional tiene sus tipos de turno, horarios y obras sociales. El agente solo ofrece lo compatible.",
          },
          {
            titulo: "Estudios y consultas encadenados",
            texto: "Agenda el estudio previo y la consulta en la secuencia correcta.",
          },
          {
            titulo: "Feriados y bloqueos",
            texto: "Respeta feriados, vacaciones y bloqueos de agenda cargados en el panel.",
          },
        ],
      },
      {
        titulo: "Visibilidad para la gestión",
        items: [
          {
            titulo: "Métricas de contención",
            texto: "Cuántas conversaciones se resolvieron sin humanos, cuántos turnos dio la IA y cuántos se recuperaron.",
          },
          {
            titulo: "Transcripciones y resúmenes",
            texto: "Cada conversación queda registrada con su resumen, motivo y resultado.",
          },
          {
            titulo: "Encuestas post-consulta",
            texto: "Puntaje de satisfacción de 0 a 10 después de cada visita, por WhatsApp.",
          },
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿Reemplaza al call center?",
        respuesta: "No. Absorbe lo repetitivo y deja al equipo humano los casos que necesitan criterio.",
      },
      {
        pregunta: "¿Puede manejar varias sedes?",
        respuesta: "El esquema es multi-clínica y cada agente puede atender una sede. El selector de sedes y los roles están en desarrollo.",
      },
      {
        pregunta: "¿Se integra con nuestro sistema de turnos actual?",
        respuesta: "Hoy Turnia funciona con su propia agenda. La integración con sistemas existentes se evalúa caso por caso.",
      },
      {
        pregunta: "¿Puede transferir llamadas a una persona?",
        respuesta: "Sí, por teléfono transfiere al número que configures. Por WhatsApp crea una tarea de derivación.",
      },
      {
        pregunta: "¿Qué pasa con la privacidad de los pacientes?",
        respuesta:
          "Los datos se guardan en tu base, con acceso solo desde el servidor. Para producción recomendamos activar el modo sin retención en ElevenLabs y una revisión legal.",
      },
    ],
  },
  {
    slug: "multiespecialidad",
    nombre: "Centros multiespecialidad",
    icono: "edificio",
    eyebrow: "Para centros multiespecialidad",
    titulo: "Cada especialidad, con sus propias reglas",
    bajada:
      "Pediatría, ginecología, traumatología y más en un solo número de WhatsApp, con tipos de turno, coberturas e indicaciones por especialidad.",
    bloques: [
      {
        titulo: "Un solo canal, todas las especialidades",
        items: [
          {
            titulo: "Un número para todo",
            texto: "El paciente escribe a un solo WhatsApp y el agente lo lleva a la especialidad correcta.",
          },
          {
            titulo: "Varios pedidos a la vez",
            texto: "Un turno con el clínico, un estudio y una receta, resueltos en la misma conversación.",
          },
          {
            titulo: "Memoria del paciente",
            texto: "Sabe con quién se atiende, su cobertura y sus pendientes en cada especialidad.",
          },
        ],
      },
      {
        titulo: "Reglas por especialidad",
        items: [
          {
            titulo: "Tipos de turno y duraciones",
            texto: "Primera vez, control, estudio o procedimiento, cada uno con su duración y profesionales.",
          },
          {
            titulo: "Indicaciones previas",
            texto: "Ayuno, preparación o documentación: envía las indicaciones de cada práctica al confirmar.",
          },
          {
            titulo: "Coberturas por profesional",
            texto: "Ofrece solo profesionales que atienden la obra social o prepaga del paciente.",
          },
        ],
      },
      {
        titulo: "Agenda llena en todas las áreas",
        items: [
          {
            titulo: "Lista de espera automática",
            texto: "Cada cancelación se ofrece a quien estaba esperando en esa especialidad.",
          },
          {
            titulo: "Recall por especialidad",
            texto: "Controles anuales, limpiezas, PAP o chequeos: cada área define su frecuencia.",
          },
          {
            titulo: "Recupero de ausentes",
            texto: "A quien faltó, le ofrece reprogramar por WhatsApp el mismo día.",
          },
        ],
      },
    ],
    faqs: [
      {
        pregunta: "¿Cuántas especialidades puede manejar?",
        respuesta: "Las que tenga el centro: se configuran profesionales y tipos de turno desde el panel.",
      },
      {
        pregunta: "¿Cada especialidad puede tener reglas distintas?",
        respuesta: "Sí. Duraciones, coberturas, indicaciones previas y frecuencias de control se definen por tipo de turno.",
      },
      {
        pregunta: "¿Cómo se entera el equipo de los pedidos?",
        respuesta: "Llegan como tareas al panel con el resumen, y la respuesta vuelve al paciente por WhatsApp.",
      },
      {
        pregunta: "¿Hace falta cambiar de sistema de turnos?",
        respuesta: "Turnia incluye su agenda. Las integraciones con sistemas existentes se evalúan a pedido.",
      },
      {
        pregunta: "¿Cuánto tarda en estar funcionando?",
        respuesta:
          "Con los profesionales, horarios y coberturas cargados, el agente queda listo para probar en la demo el mismo día. WhatsApp depende de tener el número conectado.",
      },
    ],
  },
];

export function getOrganizacion(slug: string): Organizacion | undefined {
  return ORGANIZACIONES.find((o) => o.slug === slug);
}
