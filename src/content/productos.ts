import type { IconoClave } from "./tipos";

// Páginas de producto: misma plantilla que /concierge y /activate de Assort.

export type Producto = {
  slug: "recepcion" | "activa" | "plataforma";
  eyebrow: string;
  titulo: [string, string];
  bajada: string;
  imagen: string;
  chat: { quien: "agente" | "paciente"; texto: string }[];
  problema: { titulo: [string, string]; bajada: string; items: { t: string; d: string; i: IconoClave }[] };
  presentacion: { eyebrow: string; titulo: [string, string]; bajada: string; pilares: { t: string; d: string }[] };
  datos: { eyebrow: string; titulo: [string, string]; bajada: string; items: { v: string; d: string }[] };
  secciones: { eyebrow: string; titulo: string; texto: string; bullets: string[]; href: string; enlace: string; mock: { quien: "agente" | "paciente" | "sistema"; texto: string }[] }[];
  canales: { titulo: [string, string]; bajada: string; items: { t: string; d: string; i: IconoClave }[] };
  pasos: { titulo: [string, string]; bajada: string; items: { t: string; d: string }[] };
  cta: { titulo: string; bajada: string };
  demo?: string;
};

export const PRODUCTOS: Record<Producto["slug"], Producto> = {
  recepcion: {
    slug: "recepcion",
    eyebrow: "Turnia Recepción",
    titulo: ["Agentes de IA para cada", "conversación con pacientes"],
    bajada:
      "Turnia Recepción atiende cada WhatsApp, audio y llamada al instante, las 24 horas: da turnos sobre tu agenda real, responde dudas, hace la admisión y deriva lo que necesita una persona.",
    imagen: "/img/hero.jpg",
    chat: [
      { quien: "agente", texto: "¡Hola! Soy Sofi, de Centro Médico Plaza. ¿En qué te ayudo?" },
      { quien: "paciente", texto: "Tengo una duda con un cobro de la última consulta" },
      { quien: "agente", texto: "Te entiendo. Le dejo el pedido al área de facturación con tus datos y te responden por acá. ¿Querés aprovechar para sacar el próximo control?" },
    ],
    problema: {
      titulo: ["Tu recepción", "no da abasto"],
      bajada: "Los mensajes y las llamadas crecen, el equipo no. Los pacientes esperan, se cansan y se van a otro lado.",
      items: [
        { t: "Tu mayor fuente de ingresos, tu mayor cuello de botella", d: "WhatsApp sin responder, líneas ocupadas y mensajes que se pierden entre turno y turno.", i: "telefono" },
        { t: "Mensajes sin respuesta, pacientes perdidos", d: "El que no recibe respuesta en minutos le escribe a otra clínica. Y no vuelve.", i: "chat" },
        { t: "Contratar más no escala", d: "Sumar personas para atender WhatsApp y teléfono es caro, lento y no cubre noches ni feriados.", i: "grafico" },
      ],
    },
    presentacion: {
      eyebrow: "Presentamos Turnia Recepción",
      titulo: ["Ningún mensaje sin respuesta.", "Ninguna carga manual."],
      bajada: "Agentes de IA que atienden cada conversación entrante: turnos, preguntas, admisión y derivaciones, de punta a punta.",
      pilares: [
        { t: "Siempre activa", d: "Cada mensaje y cada llamada se responden al instante, a cualquier hora y en paralelo, sin colas de espera." },
        { t: "Hecha para salud", d: "Turnos con reglas por profesional, coberturas, indicaciones previas y triage con derivación al 107." },
        { t: "Sobre tu agenda real", d: "Cada turno, cambio y cancelación se escribe en la agenda al instante. Sin doble carga." },
      ],
    },
    datos: {
      eyebrow: "Atención real, todo el día",
      titulo: ["Menos carga.", "Más turnos. Ningún mensaje perdido."],
      bajada: "Lo que Turnia Recepción hace desde el primer día:",
      items: [
        { v: "24/7", d: "Atención todos los días del año, incluidos feriados" },
        { v: "9", d: "Acciones que el agente ejecuta sobre la agenda y la ficha" },
        { v: "0", d: "Turnos superpuestos: la base de datos lo impide" },
      ],
    },
    secciones: [
      {
        eyebrow: "Turnos y agenda",
        titulo: "Toda la complejidad de la agenda, resuelta sola",
        texto: "Ya sea primera vez, control o estudio, Turnia aplica las reglas de cada profesional y tipo de turno, sin errores ni esperas.",
        bullets: [
          "Da, confirma, cancela y reprograma turnos las 24 horas.",
          "Respeta duración, cobertura, feriados y bloqueos de cada profesional.",
          "Cuando alguien cancela, le ofrece el turno a la lista de espera.",
        ],
        href: "/soluciones/turnos",
        enlace: "Ver turnos y agenda",
        mock: [
          { quien: "paciente", texto: "Quiero un turno con traumato, me duele la rodilla" },
          { quien: "agente", texto: "Con el Dr. Fernández tengo el martes 18 a las 16:20 o el miércoles 19 a las 9:00. ¿Cuál te queda mejor?" },
          { quien: "sistema", texto: "Turno reservado · Mar 18, 16:20 · Dr. Fernández · Swiss Medical" },
        ],
      },
      {
        eyebrow: "Admisión",
        titulo: "Los datos del paciente, completos y bien cargados",
        texto: "Mientras da el turno, Turnia toma y confirma DNI, cobertura, plan y número de afiliado. Por WhatsApp, también desde la foto de la credencial.",
        bullets: [
          "Datos confirmados con el paciente antes de guardarlos.",
          "Reconoce a los pacientes que ya existen por su número.",
          "Envía las indicaciones previas al confirmar el turno.",
        ],
        href: "/soluciones/admision",
        enlace: "Ver admisión",
        mock: [
          { quien: "sistema", texto: "Ficha del paciente · Laura Gómez · DNI 32.456.789" },
          { quien: "sistema", texto: "OSDE · Plan 310 · Afiliado 61 234567 8 01" },
          { quien: "agente", texto: "Perfecto Laura, ya tengo tus datos. Recordá venir 10 minutos antes con tu credencial." },
        ],
      },
      {
        eyebrow: "Tareas y derivación",
        titulo: "Automatizá el día a día de tu equipo",
        texto: "Lo que necesita una persona llega como tarea con resumen y transcripción. Y la respuesta vuelve al paciente por WhatsApp.",
        bullets: [
          "Recetas, resultados, órdenes y facturación como tareas tipificadas.",
          "Urgencias derivadas al 107 o a la guardia, con tarea prioritaria.",
          "Respuestas del equipo enviadas al paciente automáticamente.",
        ],
        href: "/soluciones/tareas",
        enlace: "Ver gestión de tareas",
        mock: [
          { quien: "sistema", texto: "Nueva tarea · Receta · Prioridad normal" },
          { quien: "sistema", texto: "Jorge Pérez pide renovar ibuprofeno 600 mg. Farmacia de siempre. Swiss Medical SMG20." },
          { quien: "agente", texto: "Listo Jorge, le dejé el pedido a la Dra. Fernández. Te aviso por acá cuando esté." },
        ],
      },
    ],
    canales: {
      titulo: ["Conversaciones continuas", "en todos los canales"],
      bajada: "El mismo agente, con la misma memoria del paciente, en cada canal.",
      items: [
        { t: "WhatsApp", d: "Texto, audios, fotos de credenciales y órdenes. El canal que tus pacientes ya usan.", i: "whatsapp" },
        { t: "Teléfono", d: "Voz natural en rioplatense, con transferencia a una persona cuando hace falta.", i: "telefono" },
        { t: "Chat web", d: "En tu sitio, para que los pacientes saquen turno sin descargar nada.", i: "web" },
      ],
    },
    pasos: {
      titulo: ["Así se ve cuando un paciente", "le escribe a tu clínica"],
      bajada: "Un paciente escribe para sacar un turno y, de paso, pide una receta. Así lo resuelve Turnia, de punta a punta.",
      items: [
        { t: "Mensaje respondido al instante", d: "El paciente escribe a las 22 h. Sofi responde en segundos, lo reconoce por su número y lo saluda por su nombre." },
        { t: "Datos del paciente", d: "Confirma su cobertura y completa lo que falta de la admisión." },
        { t: "Motivo entendido", d: "Entiende que quiere un control y también renovar una receta." },
        { t: "Turno reservado", d: "Ofrece horarios del profesional que atiende su cobertura y reserva el elegido." },
        { t: "Receta pedida", d: "Toma el pedido completo y lo deja como tarea para el profesional." },
        { t: "Circuito cerrado", d: "Envía la confirmación con indicaciones y, cuando la receta está lista, se la avisa por WhatsApp." },
      ],
    },
    cta: { titulo: "Tus pacientes están escribiendo. Turnia está lista para responder.", bajada: "Mirá cómo atiende en tu especialidad." },
    demo: "home",
  },
  activa: {
    slug: "activa",
    eyebrow: "Turnia Activa",
    titulo: ["Campañas que llenan", "tu agenda solas"],
    bajada:
      "Turnia Activa le escribe a cada paciente en el momento justo (recordatorios, controles vencidos, ausentes, lista de espera y reactivación) y convierte cada respuesta en un turno.",
    imagen: "/img/familia.jpg",
    chat: [
      { quien: "agente", texto: "¡Hola María! Ya pasaron 6 meses de tu última limpieza dental. ¿Querés que te busque un turno?" },
      { quien: "paciente", texto: "Sí! Puede ser a la mañana?" },
      { quien: "agente", texto: "Con la Dra. Ruiz tengo el martes 11 a las 10:00. ¿Te lo reservo?" },
    ],
    problema: {
      titulo: ["Tu agenda tiene huecos", "que nadie llega a llenar"],
      bajada: "Pacientes que faltan, controles que se vencen y turnos cancelados que quedan vacíos.",
      items: [
        { t: "Ausentes sin aviso", d: "El paciente se olvida, el turno se pierde y nadie lo llama para reprogramar.", i: "calendario" },
        { t: "Controles que se vencen", d: "Los pacientes que deberían volver cada seis meses no vuelven si nadie les avisa.", i: "reloj" },
        { t: "Llamar no escala", d: "La recepción no tiene tiempo de llamar a la lista de espera ni a los pacientes inactivos.", i: "telefono" },
      ],
    },
    presentacion: {
      eyebrow: "Presentamos Turnia Activa",
      titulo: ["Menos ausentes.", "Más pacientes que vuelven."],
      bajada: "Campañas automáticas por WhatsApp que terminan en conversaciones, y las conversaciones en turnos.",
      pilares: [
        { t: "En el momento justo", d: "Cada campaña sale cuando corresponde: el día anterior al turno, cuando vence un control o cuando se libera un hueco." },
        { t: "Conversaciones, no avisos", d: "Cuando el paciente responde, lo atiende el agente con el contexto de la campaña y le da el turno." },
        { t: "Sin programar", d: "Horarios y frecuencias en n8n, resultados en el panel. Todo editable sin código." },
      ],
    },
    datos: {
      eyebrow: "Campañas incluidas",
      titulo: ["Seis campañas,", "un solo agente"],
      bajada: "Cada una con su plantilla de WhatsApp y su horario:",
      items: [
        { v: "6", d: "Campañas: recordatorio, recall, lista de espera, ausentes, reactivación y encuesta" },
        { v: "50", d: "Envíos máximos por corrida, para cuidar tu número" },
        { v: "1", d: "Mensaje alcanza para darse de baja: el agente lo entiende y lo respeta" },
      ],
    },
    secciones: [
      {
        eyebrow: "Recordatorios",
        titulo: "Recordatorios que confirman o reprograman",
        texto: "El día anterior, Turnia pide confirmar el turno. Si el paciente no puede venir, lo reprograma en la misma conversación.",
        bullets: ["Confirmación con una respuesta.", "Reprogramación inmediata si no puede asistir.", "Turno liberado para la lista de espera."],
        href: "/soluciones/seguimiento-proactivo",
        enlace: "Ver seguimiento proactivo",
        mock: [
          { quien: "agente", texto: "¡Hola Jorge! Te recordamos tu turno mañana 10:20 con la Dra. Fernández. ¿Confirmás?" },
          { quien: "paciente", texto: "No voy a poder, se puede pasar al jueves?" },
          { quien: "agente", texto: "Claro. El jueves tengo 11:00 o 15:40. ¿Cuál preferís?" },
        ],
      },
      {
        eyebrow: "Lista de espera",
        titulo: "Cada turno cancelado, ocupado de nuevo",
        texto: "Cuando un paciente cancela, Turnia le ofrece el horario a quien estaba en lista de espera para ese tipo de turno.",
        bullets: ["Oferta automática al instante.", "El primero que confirma se queda con el turno.", "Todo registrado en el panel."],
        href: "/soluciones/turnos",
        enlace: "Ver turnos y agenda",
        mock: [
          { quien: "sistema", texto: "Turno cancelado · Jue 20, 9:00 · Dermatología" },
          { quien: "agente", texto: "¡Hola Ana! Se liberó un turno el jueves 20 a las 9:00 con la Dra. Ruiz. ¿Lo querés?" },
          { quien: "paciente", texto: "Siii, dale!" },
        ],
      },
      {
        eyebrow: "Recall y reactivación",
        titulo: "Pacientes que vuelven, sin llamar a nadie",
        texto: "Turnia detecta controles vencidos y pacientes que no vienen hace más de un año, y les ofrece turno.",
        bullets: ["Recall por tipo de turno (limpieza, control anual, chequeo).", "Reactivación mensual de pacientes inactivos.", "Encuesta post-consulta con puntaje de 0 a 10."],
        href: "/soluciones/seguimiento-proactivo",
        enlace: "Ver campañas",
        mock: [
          { quien: "sistema", texto: "Campaña recall · 38 pacientes con control vencido" },
          { quien: "agente", texto: "¡Hola Marta! Ya es momento de tu control anual de cardiología. ¿Querés que te busquemos un turno?" },
          { quien: "paciente", texto: "Sí, gracias por avisar" },
        ],
      },
    ],
    canales: {
      titulo: ["Mensajes que llegan", "donde están tus pacientes"],
      bajada: "WhatsApp como canal principal, con plantillas aprobadas por Meta.",
      items: [
        { t: "WhatsApp", d: "Plantillas aprobadas para iniciar la conversación; después responde el agente.", i: "whatsapp" },
        { t: "Teléfono", d: "Llamadas salientes para pacientes que no usan WhatsApp (en el plan de producto).", i: "telefono" },
        { t: "Automatizaciones", d: "Disparadas por n8n en los horarios que elijas.", i: "rayo" },
      ],
    },
    pasos: {
      titulo: ["Un paciente cancela a último momento.", "Dos acciones, cero llamadas."],
      bajada: "Así funciona Turnia Activa cuando se libera un turno.",
      items: [
        { t: "Cancelación detectada", d: "Un paciente cancela su turno de mañana por WhatsApp. Turnia lo libera al instante." },
        { t: "Reprogramación ofrecida", d: "Al mismo tiempo, le ofrece al paciente nuevos horarios para no perderlo." },
        { t: "Lista de espera", d: "Turnia busca a los pacientes que esperaban ese tipo de turno." },
        { t: "Hueco ofrecido", d: "Les escribe con una plantilla aprobada por Meta." },
        { t: "Turno ocupado", d: "El primero que confirma se queda con el turno." },
        { t: "Todo registrado", d: "La campaña, las respuestas y el turno quedan en el panel." },
      ],
    },
    cta: { titulo: "Tu agenda tiene huecos. Turnia Activa los llena.", bajada: "Pedí una demo y vemos tus campañas." },
  },
  plataforma: {
    slug: "plataforma",
    eyebrow: "Plataforma Turnia",
    titulo: ["Una plataforma para todo", "el recorrido del paciente"],
    bajada:
      "Agentes de IA, agenda, memoria del paciente, campañas y bandeja de tareas en un solo lugar. Desde el primer mensaje hasta el seguimiento.",
    imagen: "/img/recepcion.jpg",
    chat: [
      { quien: "paciente", texto: "Hola, soy Jorge. Quería ver lo de la receta que pedí ayer" },
      { quien: "agente", texto: "¡Hola Jorge! La Dra. Fernández ya la firmó: te la mandé por acá a las 11:40. ¿Necesitás algo más?" },
    ],
    problema: {
      titulo: ["Herramientas sueltas,", "pacientes perdidos"],
      bajada: "Un sistema para la agenda, otro para WhatsApp, planillas para las campañas y la memoria en la cabeza de la recepcionista.",
      items: [
        { t: "Información dispersa", d: "Cada canal sabe algo distinto del paciente y nadie tiene la historia completa.", i: "lista" },
        { t: "Doble carga", d: "Lo que se habla por WhatsApp se vuelve a tipear en la agenda.", i: "admision" },
        { t: "Sin métricas", d: "No sabés cuántos pacientes se pierden ni por qué.", i: "grafico" },
      ],
    },
    presentacion: {
      eyebrow: "La plataforma",
      titulo: ["Cuatro productos.", "Una sola memoria del paciente."],
      bajada: "Recepción, Activa, Circuitos y Equipo comparten la agenda y la historia de cada paciente.",
      pilares: [
        { t: "Recepción", d: "Atiende WhatsApp, teléfono y web las 24 horas." },
        { t: "Activa", d: "Campañas que recuperan pacientes y llenan la agenda." },
        { t: "Equipo", d: "Bandeja de tareas, conversaciones, resúmenes y métricas." },
      ],
    },
    datos: {
      eyebrow: "Construida para salud",
      titulo: ["Seguridad, control", "y datos que se usan"],
      bajada: "Cómo está hecha la plataforma:",
      items: [
        { v: "1", d: "Ficha por paciente con datos, turnos, conversaciones y memoria" },
        { v: "100%", d: "De las conversaciones con transcripción, resumen y motivo" },
        { v: "2", d: "Criterios de evaluación automática: pedido resuelto y seguridad clínica" },
      ],
    },
    secciones: [
      {
        eyebrow: "Memoria del paciente",
        titulo: "Nadie tiene que repetir su historia",
        texto: "Cada conversación parte de la anterior: cobertura, preferencias de horario, turnos próximos y pedidos pendientes.",
        bullets: ["Memoria actualizada al final de cada conversación.", "Contexto disponible en todos los canales.", "Visible para el equipo en la ficha."],
        href: "/recepcion",
        enlace: "Ver Turnia Recepción",
        mock: [
          { quien: "sistema", texto: "Contexto del paciente · Jorge Pérez · Swiss Medical SMG20" },
          { quien: "sistema", texto: "Operado de rodilla derecha en marzo · Prefiere turnos a primera hora" },
          { quien: "sistema", texto: "Pendiente: renovar receta de antiinflamatorio" },
        ],
      },
      {
        eyebrow: "Panel de la clínica",
        titulo: "Todo lo que pasa, en un solo lugar",
        texto: "Agenda, conversaciones, tareas, pacientes, campañas y métricas, desde cualquier navegador.",
        bullets: ["Contención, turnos dados por IA y pacientes recuperados.", "Feriados, vacaciones y bloqueos de agenda.", "Configuración del agente en un clic."],
        href: "/panel",
        enlace: "Ingresar al panel",
        mock: [
          { quien: "sistema", texto: "Últimos 30 días · Conversaciones resueltas por IA" },
          { quien: "sistema", texto: "Turnos dados por el agente · Pacientes recuperados por campañas" },
          { quien: "sistema", texto: "Satisfacción promedio post-consulta" },
        ],
      },
      {
        eyebrow: "Automatizaciones",
        titulo: "Conectado a tus herramientas, sin programar",
        texto: "Cada evento (turno reservado, tarea urgente, conversación finalizada) sale a n8n para avisar al equipo o sincronizar otros sistemas.",
        bullets: ["Avisos por mail, Slack o WhatsApp interno.", "Sincronización con Google Calendar.", "Campañas programadas en los horarios que elijas."],
        href: "/activa",
        enlace: "Ver Turnia Activa",
        mock: [
          { quien: "sistema", texto: "Evento · tarea.creada · urgente" },
          { quien: "sistema", texto: "n8n → aviso a recepción" },
          { quien: "sistema", texto: "Evento · turno.reservado → Google Calendar" },
        ],
      },
    ],
    canales: {
      titulo: ["Un agente,", "todos los canales"],
      bajada: "La misma memoria del paciente en WhatsApp, teléfono y web.",
      items: [
        { t: "WhatsApp", d: "Texto, audios, fotos y plantillas.", i: "whatsapp" },
        { t: "Teléfono", d: "Voz natural y transferencia a una persona.", i: "telefono" },
        { t: "Web", d: "Chat y voz en tu sitio.", i: "web" },
      ],
    },
    pasos: {
      titulo: ["De la configuración", "al primer paciente atendido"],
      bajada: "Así se pone en marcha Turnia en tu clínica.",
      items: [
        { t: "Cargás tu clínica", d: "Profesionales, horarios, tipos de turno y coberturas." },
        { t: "Creás el agente", d: "Un clic en el panel crea el agente con tu información." },
        { t: "Conectás WhatsApp", d: "Con tu número de WhatsApp Business." },
        { t: "Activás campañas", d: "Elegís cuáles y en qué horarios." },
        { t: "Atiende pacientes", d: "Turnos, admisión, tareas y derivaciones las 24 horas." },
        { t: "Medís resultados", d: "Métricas y conversaciones en el panel." },
      ],
    },
    cta: { titulo: "Una plataforma para todo el recorrido del paciente.", bajada: "Pedí una demo y la vemos con tu agenda." },
    demo: "home",
  },
};
