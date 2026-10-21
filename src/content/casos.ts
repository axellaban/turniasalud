import type { CasoDeUso } from "./tipos";

// Los 9 casos de uso, con la misma estructura que las páginas de Assort
// (hero + formulario, 3 bloques de 3 beneficios, "por qué Turnia", FAQ).
// Texto propio: nada de métricas ni clientes inventados.

export const CASOS: CasoDeUso[] = [
  {
    slug: "turnos",
    nombre: "Turnos y agenda",
    icono: "calendario",
    eyebrow: "Turnos automáticos, de punta a punta",
    titulo: "Una agenda que crece con tu consultorio",
    bajada:
      "Desde el primer mensaje hasta el turno confirmado, Turnia agenda por WhatsApp, teléfono y web las 24 horas, para que tu equipo atienda pacientes y no la línea.",
    bloques: [
      {
        titulo: "Más turnos, más ingresos",
        items: [
          { titulo: "Todos los canales a la vez", texto: "WhatsApp (texto y audios), teléfono y chat web con el mismo agente y la misma agenda, en paralelo." },
          { titulo: "Agenda que se llena sola", texto: "Campañas que ofrecen los huecos libres, recuperan ausentes y reactivan pacientes que no volvieron." },
          { titulo: "Nada queda sin respuesta", texto: "Los mensajes de la noche, del fin de semana y de los feriados también terminan en turno." },
        ],
      },
      {
        titulo: "Mejor experiencia para el paciente",
        items: [
          { titulo: "Sin esperas", texto: "Cada paciente recibe respuesta en segundos, aunque escriban cien a la vez." },
          { titulo: "Cuando le queda cómodo", texto: "Saca, cambia o cancela su turno a la hora que quiera, sin esperar a que abra la recepción." },
          { titulo: "Turnos bien dados", texto: "Respeta duración, profesional, cobertura e indicaciones previas de cada tipo de turno." },
        ],
      },
      {
        titulo: "Más capacidad sin sumar costos fijos",
        items: [
          { titulo: "Mismo equipo, más volumen", texto: "El agente atiende conversaciones simultáneas sin límite: tu equipo deja de correr detrás del teléfono." },
          { titulo: "Recepción para lo importante", texto: "Las personas se dedican a lo que necesita criterio humano: el paciente en el mostrador." },
          { titulo: "Huecos que se recuperan solos", texto: "Cuando alguien cancela, Turnia le ofrece el turno a la lista de espera sin que nadie llame." },
        ],
      },
    ],
    porque: {
      titulo: "Pensado para la complejidad real de una agenda médica",
      items: [
        "Agenda sobre los horarios reales de cada profesional, con feriados, vacaciones y bloqueos.",
        "Confirma, cancela y reprograma de punta a punta, sin intervención humana.",
        "Nunca da dos veces el mismo turno: la base de datos impide superposiciones.",
      ],
    },
    faqs: [
      {
        pregunta: "¿Qué es un sistema de turnos con IA y en qué se diferencia de un bot?",
        respuesta:
          "Un bot de menú te obliga a elegir opciones. Turnia entiende lo que el paciente escribe o dice con sus palabras, consulta la agenda real y resuelve: da el turno, lo confirma, lo cambia o deriva a una persona cuando hace falta.",
      },
      {
        pregunta: "¿Funciona con mi agenda actual?",
        respuesta:
          "Hoy Turnia trae su propia agenda, que tu equipo maneja desde el panel. Las integraciones con sistemas de gestión existentes se evalúan caso por caso.",
      },
      {
        pregunta: "¿Cómo maneja las reglas de cada profesional?",
        respuesta:
          "Cada tipo de turno tiene duración, profesionales, coberturas aceptadas e indicaciones previas. El agente solo ofrece horarios que cumplen todas esas reglas.",
      },
      {
        pregunta: "¿Reemplaza a la recepción?",
        respuesta:
          "No. Le saca el trabajo repetitivo (turnos, confirmaciones, cambios) para que el equipo se enfoque en lo que necesita una persona. Lo que no puede resolver llega como tarea con todo el contexto.",
      },
      {
        pregunta: "¿Cuánto tarda en estar funcionando?",
        respuesta:
          "Con los profesionales, horarios y tipos de turno cargados, el agente queda listo para atender el mismo día. Conectar el número de WhatsApp depende de la aprobación de Meta.",
      },
    ],
  },
  {
    slug: "triage",
    nombre: "Triage y derivación",
    icono: "triage",
    eyebrow: "Triage y derivación inteligente",
    titulo: "Cada paciente, al lugar correcto",
    bajada:
      "Turnia entiende el motivo de cada consulta, detecta señales de alarma y deriva: al turno indicado, a la persona indicada o al 107, sin menús ni esperas.",
    bloques: [
      {
        titulo: "Seguridad clínica primero",
        items: [
          { titulo: "Señales de alarma", texto: "Ante dolor de pecho, falta de aire u otros síntomas graves, indica llamar al 107 o ir a la guardia en el momento." },
          { titulo: "Tarea urgente para el equipo", texto: "Cada urgencia queda registrada como tarea prioritaria y le avisa al equipo." },
          { titulo: "Nunca diagnostica", texto: "El agente no da indicaciones médicas: orienta, registra y deriva según tus protocolos." },
        ],
      },
      {
        titulo: "Derivación sin fricción",
        items: [
          { titulo: "El turno correcto", texto: "Distingue primera vez, control, estudio o procedimiento y ofrece el tipo de turno que corresponde." },
          { titulo: "La persona correcta", texto: "Facturación, resultados o un pedido especial van a la bandeja del área que corresponde." },
          { titulo: "Transferencia telefónica", texto: "Por teléfono, puede pasar la llamada a una persona cuando el paciente lo necesita." },
        ],
      },
      {
        titulo: "Menos carga para el equipo",
        items: [
          { titulo: "Contexto completo", texto: "Cada derivación llega con resumen, transcripción y datos del paciente: nadie vuelve a preguntar." },
          { titulo: "Prioridades claras", texto: "Las tareas se ordenan por urgencia para que lo importante se atienda primero." },
          { titulo: "Protocolos propios", texto: "Las instrucciones de urgencia y derivación se configuran por clínica." },
        ],
      },
    ],
    porque: {
      titulo: "Triage pensado para salud, no para atención al cliente",
      items: [
        "Protocolo de urgencias configurable con derivación al 107 y a la guardia.",
        "Clasifica cada conversación por motivo y resultado para que lo veas en el panel.",
        "Evaluación automática de seguridad clínica en cada conversación.",
      ],
    },
    faqs: [
      {
        pregunta: "¿Qué pasa si un paciente describe una urgencia?",
        respuesta:
          "El agente le indica llamar al 107 o ir a la guardia más cercana, no intenta dar un turno y crea una tarea urgente para que el equipo haga el seguimiento.",
      },
      {
        pregunta: "¿Puedo definir mis propios criterios de urgencia?",
        respuesta: "Sí. Las instrucciones de urgencia se cargan por clínica en Configuración y el agente las recibe en cada conversación.",
      },
      {
        pregunta: "¿El agente da consejos médicos?",
        respuesta: "No. Está instruido para no diagnosticar ni indicar tratamientos. Toma el pedido y lo deriva al profesional.",
      },
      {
        pregunta: "¿Cómo sé a dónde se derivó cada conversación?",
        respuesta: "En el panel cada conversación muestra motivo, resultado (resuelta, derivada, sin resolver), resumen y las tareas creadas.",
      },
      {
        pregunta: "¿Puede pasar la llamada a una persona?",
        respuesta: "Por teléfono sí, si cargás un número de derivación. En WhatsApp, deja una tarea con el contexto para que alguien responda.",
      },
    ],
  },
  {
    slug: "admision",
    nombre: "Admisión de pacientes",
    icono: "admision",
    eyebrow: "Admisión digital",
    titulo: "Datos completos antes de que llegue el paciente",
    bajada:
      "Nombre, DNI, fecha de nacimiento, obra social, plan y número de afiliado: Turnia los toma durante la conversación y los guarda sin que nadie tipee.",
    bloques: [
      {
        titulo: "Admisión sin papeles",
        items: [
          { titulo: "En la misma conversación", texto: "Mientras da el turno, pide los datos que faltan. Si el paciente ya existe, no vuelve a preguntar." },
          { titulo: "Foto de la credencial", texto: "Por WhatsApp, el paciente manda la foto de su credencial y el agente lee y guarda los datos." },
          { titulo: "Coberturas de tu clínica", texto: "Verifica que la obra social o prepaga esté entre las que atiende el profesional elegido." },
        ],
      },
      {
        titulo: "Menos errores",
        items: [
          { titulo: "Datos confirmados", texto: "El agente repite y confirma cada dato importante antes de guardarlo." },
          { titulo: "Ficha única", texto: "Cada paciente tiene una ficha con sus datos, turnos, conversaciones y memoria." },
          { titulo: "Nada se pierde", texto: "Lo que el paciente contó queda guardado y disponible para la próxima vez." },
        ],
      },
      {
        titulo: "Mostrador más ágil",
        items: [
          { titulo: "Llegan listos", texto: "La recepción recibe al paciente con la admisión ya hecha." },
          { titulo: "Indicaciones previas", texto: "Ayuno, estudios o documentación: el agente las envía al confirmar el turno." },
          { titulo: "Órdenes médicas", texto: "Si el paciente manda una orden, el agente la usa para dar el turno o la deja como tarea." },
        ],
      },
    ],
    porque: {
      titulo: "Admisión hecha para obras sociales y prepagas",
      items: [
        "Pensado para OSDE, Swiss Medical, Galeno, PAMI, IOMA y el resto de las coberturas de tu clínica.",
        "Lee credenciales y órdenes que el paciente manda por WhatsApp.",
        "Guarda la ficha del paciente sin carga manual del equipo.",
      ],
    },
    faqs: [
      {
        pregunta: "¿Qué datos toma el agente?",
        respuesta: "Nombre y apellido, DNI, fecha de nacimiento, obra social o prepaga, plan y número de afiliado. Podés definir cuáles son obligatorios por tipo de turno.",
      },
      {
        pregunta: "¿Verifica la cobertura con la obra social?",
        respuesta: "Hoy verifica que la cobertura esté entre las que acepta la clínica y el profesional. La validación en línea con cada financiador está en el plan de producto.",
      },
      {
        pregunta: "¿Puede leer la foto de la credencial?",
        respuesta: "Sí, por WhatsApp oficial. El agente lee la imagen, confirma los datos con el paciente y los guarda.",
      },
      {
        pregunta: "¿Dónde quedan los datos?",
        respuesta: "En la base de datos de tu clínica, accesible solo desde el servidor. El panel está protegido con contraseña.",
      },
      {
        pregunta: "¿Y si el paciente ya existe?",
        respuesta: "Turnia lo reconoce por su número de WhatsApp o teléfono y arranca la conversación con sus datos y su historial.",
      },
    ],
  },
  {
    slug: "fuera-de-horario",
    nombre: "Atención fuera de horario",
    icono: "luna",
    eyebrow: "Cobertura fuera de horario",
    titulo: "La clínica cierra. La atención, no.",
    bajada:
      "De noche, los fines de semana y los feriados Turnia sigue dando turnos, respondiendo dudas y dejando todo listo para cuando el equipo vuelve.",
    bloques: [
      {
        titulo: "Disponible siempre",
        items: [
          { titulo: "24/7, todo el año", texto: "Feriados, fines de semana largos y vacaciones del equipo incluidos." },
          { titulo: "Sabe si estás abierto", texto: "El agente conoce tu horario de atención y cambia lo que dice según si hay alguien en la clínica." },
          { titulo: "Protocolo fuera de horario", texto: "Configurás qué hacer de noche: a quién derivar, qué informar y qué dejar para la mañana." },
        ],
      },
      {
        titulo: "Cero oportunidades perdidas",
        items: [
          { titulo: "Turnos de noche", texto: "Quien escribe a las 23 h sale con su turno, en vez de buscar otra clínica." },
          { titulo: "Bandeja lista a la mañana", texto: "Recetas, pedidos y consultas quedan como tareas ordenadas para el equipo." },
          { titulo: "Urgencias bien derivadas", texto: "Ante una urgencia, indica 107 o guardia y deja la tarea prioritaria." },
        ],
      },
      {
        titulo: "Sin servicios de guardia telefónica",
        items: [
          { titulo: "Sin mensajes perdidos", texto: "Nada de contestadores que nadie escucha: cada conversación queda transcripta y resumida." },
          { titulo: "Mismo tono, siempre", texto: "El paciente recibe la misma atención a las 3 de la mañana que a las 10." },
          { titulo: "Todo medido", texto: "El panel muestra cuántas conversaciones llegaron fuera de horario y cómo terminaron." },
        ],
      },
    ],
    porque: {
      titulo: "Mucho más que un contestador",
      items: [
        "Resuelve de verdad: turnos, cambios y cancelaciones fuera de horario.",
        "Respeta feriados y bloqueos de agenda de cada profesional.",
        "Deja la bandeja del día siguiente ordenada por prioridad.",
      ],
    },
    faqs: [
      {
        pregunta: "¿Cómo sabe el agente si la clínica está abierta?",
        respuesta: "Calcula el horario de atención a partir de las agendas de los profesionales, los feriados y los bloqueos que cargues.",
      },
      {
        pregunta: "¿Puedo dar instrucciones distintas para la noche?",
        respuesta: "Sí. Hay un campo de instrucciones fuera de horario que el agente recibe cuando la clínica está cerrada.",
      },
      {
        pregunta: "¿Qué pasa con los pedidos de recetas a la noche?",
        respuesta: "El agente toma el pedido completo y lo deja como tarea. Cuando el equipo lo resuelve, la respuesta le llega al paciente por WhatsApp.",
      },
      {
        pregunta: "¿Sirve para los feriados?",
        respuesta: "Sí. Los feriados y vacaciones se cargan como bloqueos y el agente no ofrece turnos esos días.",
      },
      {
        pregunta: "¿Reemplaza a la guardia médica?",
        respuesta: "No. Turnia es atención administrativa. Ante cualquier urgencia deriva al 107 o a la guardia.",
      },
    ],
  },
  {
    slug: "seguimiento-proactivo",
    nombre: "Seguimiento proactivo",
    icono: "megafono",
    eyebrow: "Campañas a pacientes",
    titulo: "Llegá a tus pacientes antes de que te busquen",
    bajada:
      "Turnia Activa le escribe a cada paciente en el momento justo: controles vencidos, recordatorios, ausentes, lista de espera y reactivación.",
    bloques: [
      {
        titulo: "Agenda llena",
        items: [
          { titulo: "Recall de controles", texto: "Detecta pacientes con el control vencido y les ofrece turno por WhatsApp." },
          { titulo: "Lista de espera automática", texto: "Cuando se libera un turno, se lo ofrece a quien estaba esperando." },
          { titulo: "Reactivación", texto: "Les escribe a los pacientes que no vienen hace más de un año." },
        ],
      },
      {
        titulo: "Menos ausentismo",
        items: [
          { titulo: "Recordatorio con confirmación", texto: "El día anterior pide confirmar. Si el paciente no puede, reprograma en la misma conversación." },
          { titulo: "Recupero de ausentes", texto: "Quien faltó recibe un mensaje para reprogramar, en lugar de perderse." },
          { titulo: "Encuesta post-consulta", texto: "Pregunta cómo le fue al paciente y registra un puntaje de 0 a 10." },
        ],
      },
      {
        titulo: "Conversaciones, no avisos",
        items: [
          { titulo: "El paciente responde", texto: "Cuando contesta, lo atiende el mismo agente con el contexto de la campaña." },
          { titulo: "Plantillas aprobadas", texto: "Los mensajes salientes usan plantillas aprobadas por Meta para WhatsApp." },
          { titulo: "Baja respetada", texto: "Si alguien pide no recibir más mensajes, queda excluido de todas las campañas." },
        ],
      },
    ],
    porque: {
      titulo: "Campañas que terminan en turnos",
      items: [
        "Cada respuesta continúa en una conversación que puede dar el turno en el momento.",
        "Automatizadas con n8n: horarios y frecuencias que podés tocar sin programar.",
        "Resultados por campaña en el panel: enviados, respondidos y turnos recuperados.",
      ],
    },
    faqs: [
      {
        pregunta: "¿Qué campañas incluye?",
        respuesta: "Recordatorios, recall de controles, lista de espera, recupero de ausentes, reactivación y encuesta post-consulta.",
      },
      {
        pregunta: "¿Necesito plantillas de WhatsApp?",
        respuesta: "Con WhatsApp oficial, sí: los mensajes que inicia la clínica usan plantillas aprobadas por Meta. Te damos los textos sugeridos.",
      },
      {
        pregunta: "¿Cada cuánto se envían?",
        respuesta: "Vos definís los horarios. Por defecto: recordatorios a las 10, ausentes a las 18, recall los lunes y reactivación una vez por mes.",
      },
      {
        pregunta: "¿Qué pasa cuando el paciente responde?",
        respuesta: "Lo atiende el agente con el contexto de la campaña: si responde \"sí\" a un recall, le ofrece horarios y le da el turno.",
      },
      {
        pregunta: "¿Puedo excluir pacientes?",
        respuesta: "Sí. Los pacientes que piden la baja quedan excluidos automáticamente y podés marcar otros desde el panel.",
      },
    ],
  },
  {
    slug: "recetas",
    nombre: "Recetas y pedidos",
    icono: "receta",
    eyebrow: "Renovación de recetas",
    titulo: "Recetas sin llamadas ni idas y vueltas",
    bajada:
      "Turnia toma el pedido completo (medicación, dosis, farmacia y cobertura), lo deja como tarea para el profesional y le avisa al paciente cuando está listo.",
    bloques: [
      {
        titulo: "Pedidos completos",
        items: [
          { titulo: "Todos los datos, una vez", texto: "Medicación, dosis, presentación, obra social y número de afiliado en una sola conversación." },
          { titulo: "Sin errores de transcripción", texto: "El agente confirma el pedido con el paciente antes de registrarlo." },
          { titulo: "Por audio también", texto: "El paciente puede mandar un audio y el agente entiende el pedido." },
        ],
      },
      {
        titulo: "Circuito cerrado",
        items: [
          { titulo: "Tarea para el profesional", texto: "El pedido llega a la bandeja con todo lo necesario para resolverlo." },
          { titulo: "Respuesta por WhatsApp", texto: "Cuando el equipo lo resuelve, la respuesta le llega al paciente automáticamente." },
          { titulo: "Estado a mano", texto: "Si el paciente pregunta, el agente le dice en qué estado está su pedido." },
        ],
      },
      {
        titulo: "Menos carga",
        items: [
          { titulo: "Fuera del teléfono", texto: "Los pedidos de recetas dejan de ocupar la línea de la recepción." },
          { titulo: "Priorizado", texto: "Los pedidos urgentes se marcan para que se atiendan primero." },
          { titulo: "Historial", texto: "Cada pedido queda en la ficha del paciente." },
        ],
      },
    ],
    porque: {
      titulo: "Seguro y trazable",
      items: [
        "El agente nunca indica medicación: solo registra el pedido.",
        "Cada pedido tiene responsable, estado y respuesta.",
        "Funciona igual a cualquier hora.",
      ],
    },
    faqs: [
      {
        pregunta: "¿El agente receta?",
        respuesta: "No. Solo toma el pedido. La decisión siempre es del profesional.",
      },
      {
        pregunta: "¿Cómo le llega la receta al paciente?",
        respuesta: "El equipo resuelve la tarea con una respuesta (por ejemplo, el link de la receta electrónica) y Turnia se la manda por WhatsApp.",
      },
      {
        pregunta: "¿Puede pedir resultados de estudios?",
        respuesta: "Sí, funcionan igual: el pedido queda como tarea y la respuesta vuelve por WhatsApp.",
      },
      {
        pregunta: "¿Qué pasa si el pedido es urgente?",
        respuesta: "Se marca como urgente. Si el paciente describe síntomas de alarma, se le indica el 107 o la guardia.",
      },
      {
        pregunta: "¿Se integra con receta electrónica?",
        respuesta: "Hoy el profesional genera la receta en su sistema y comparte el link desde el panel. La integración directa está en evaluación.",
      },
    ],
  },
  {
    slug: "derivaciones",
    nombre: "Órdenes y derivaciones",
    icono: "derivacion",
    eyebrow: "Órdenes médicas y derivaciones",
    titulo: "Cada orden médica, convertida en turno",
    bajada:
      "El paciente manda la foto de su orden por WhatsApp y Turnia le da el turno que corresponde, o la deja como tarea si necesita autorización.",
    bloques: [
      {
        titulo: "De la orden al turno",
        items: [
          { titulo: "Foto de la orden", texto: "El agente lee la orden, identifica el estudio o especialidad y busca turno." },
          { titulo: "Estudios con preparación", texto: "Envía las indicaciones previas al confirmar." },
          { titulo: "Cuando hace falta autorización", texto: "Deja una tarea para que el equipo gestione la autorización con la cobertura." },
        ],
      },
      {
        titulo: "Derivaciones internas",
        items: [
          { titulo: "Entre especialidades", texto: "Si el clínico deriva al cardiólogo, el agente coordina el turno siguiente." },
          { titulo: "Contexto completo", texto: "El profesional que recibe al paciente ve la conversación y el motivo." },
          { titulo: "Nadie se pierde", texto: "Las órdenes sin turno quedan visibles para hacer seguimiento." },
        ],
      },
      {
        titulo: "Menos papeles",
        items: [
          { titulo: "Sin escanear", texto: "La orden llega por WhatsApp y queda asociada al paciente." },
          { titulo: "Bandeja ordenada", texto: "Las órdenes que necesitan una persona llegan como tareas del tipo orden médica." },
          { titulo: "Seguimiento", texto: "Desde el panel ves qué órdenes ya tienen turno." },
        ],
      },
    ],
    porque: {
      titulo: "Hecho para cómo funcionan las órdenes en Argentina",
      items: [
        "Órdenes en papel, foto o PDF por WhatsApp.",
        "Autorizaciones de obras sociales y prepagas como tareas con contexto.",
        "Turno e indicaciones previas en la misma conversación.",
      ],
    },
    faqs: [
      {
        pregunta: "¿Qué formatos de orden acepta?",
        respuesta: "Fotos y PDF por WhatsApp oficial. El agente lee la orden y confirma con el paciente lo que entendió.",
      },
      {
        pregunta: "¿Gestiona la autorización con la obra social?",
        respuesta: "Hoy deja la autorización como tarea para el equipo. La gestión automática con cada financiador está en el plan de producto.",
      },
      {
        pregunta: "¿Sirve para derivaciones de otros médicos?",
        respuesta: "Sí. Cualquier orden que traiga el paciente sirve para buscar el turno correspondiente.",
      },
      {
        pregunta: "¿Qué pasa si la orden no se entiende?",
        respuesta: "El agente pide una foto más clara o deja la orden como tarea para que la revise una persona.",
      },
      {
        pregunta: "¿Puede contactar a pacientes con órdenes pendientes?",
        respuesta: "Es parte del plan de Turnia Activa: campañas para agendar órdenes que todavía no tienen turno.",
      },
    ],
  },
  {
    slug: "cobranzas",
    nombre: "Pagos y cobranzas",
    icono: "pago",
    eyebrow: "Pagos y saldos",
    titulo: "Cobrá sin llamadas incómodas",
    bajada:
      "Turnia responde dudas sobre aranceles, bonos y copagos, y en el plan de producto suma recordatorios de saldos con link de pago.",
    bloques: [
      {
        titulo: "Respuestas claras",
        items: [
          { titulo: "Aranceles y bonos", texto: "Informa precios de consultas particulares, bonos y copagos según lo que cargues." },
          { titulo: "Medios de pago", texto: "Explica cómo y dónde pagar: efectivo, transferencia, tarjeta o link." },
          { titulo: "Facturación", texto: "Las consultas de facturación llegan como tarea al área administrativa." },
        ],
      },
      {
        titulo: "Próximamente",
        items: [
          { titulo: "Recordatorio de saldos", texto: "Mensajes amables por WhatsApp para saldos pendientes." },
          { titulo: "Link de pago", texto: "Integración con Mercado Pago para pagar desde la conversación." },
          { titulo: "Seña de turnos", texto: "Seña opcional para reducir el ausentismo en turnos largos." },
        ],
      },
      {
        titulo: "Menos carga administrativa",
        items: [
          { titulo: "Sin llamadas de cobranza", texto: "El equipo deja de hacer llamadas incómodas." },
          { titulo: "Todo registrado", texto: "Cada consulta de pago queda en la conversación del paciente." },
          { titulo: "Con contexto", texto: "Si el paciente tiene dudas, la tarea llega con el resumen." },
        ],
      },
    ],
    porque: {
      titulo: "Cobranzas con el mismo tono de tu clínica",
      items: [
        "Mensajes cordiales, en el idioma de tus pacientes.",
        "Consultas de facturación derivadas al área correcta.",
        "Pagos con Mercado Pago en el plan de producto.",
      ],
    },
    faqs: [
      {
        pregunta: "¿Turnia ya cobra?",
        respuesta: "Hoy responde consultas de aranceles y deriva facturación. Los recordatorios de saldo con link de pago están en desarrollo.",
      },
      {
        pregunta: "¿Qué medio de pago va a usar?",
        respuesta: "El primero planificado es Mercado Pago, por ser el más usado por pacientes en Argentina.",
      },
      {
        pregunta: "¿Puedo cargar mis aranceles?",
        respuesta: "Sí. Los precios de referencia por tipo de turno se cargan en el panel y el agente los informa.",
      },
      {
        pregunta: "¿Y los copagos de las prepagas?",
        respuesta: "Podés indicar copagos por cobertura en la información de la clínica y el agente los informa.",
      },
      {
        pregunta: "¿Es seguro?",
        respuesta: "Turnia no pide ni guarda datos de tarjetas. Los pagos se harán siempre en la plataforma de pago.",
      },
    ],
  },
  {
    slug: "tareas",
    nombre: "Gestión de tareas",
    icono: "tareas",
    eyebrow: "Bandeja de tareas",
    titulo: "Lo que necesita una persona, llega listo",
    bajada:
      "Cada pedido que el agente no puede resolver se convierte en una tarea con resumen, transcripción y datos del paciente, y la respuesta vuelve por WhatsApp.",
    bloques: [
      {
        titulo: "Todo en una bandeja",
        items: [
          { titulo: "Tareas tipificadas", texto: "Recetas, resultados, órdenes, facturación, derivación humana y urgencias." },
          { titulo: "Prioridades", texto: "Urgente, alta o normal, para atender primero lo importante." },
          { titulo: "Avisos al equipo", texto: "Con n8n, cada tarea urgente puede avisar por mail, Slack o WhatsApp interno." },
        ],
      },
      {
        titulo: "Contexto completo",
        items: [
          { titulo: "Resumen con IA", texto: "Cada tarea trae lo que pidió el paciente en dos líneas." },
          { titulo: "Transcripción", texto: "Un clic para ver la conversación completa." },
          { titulo: "Ficha del paciente", texto: "Datos, cobertura, turnos y memoria en el mismo lugar." },
        ],
      },
      {
        titulo: "Circuito cerrado",
        items: [
          { titulo: "Respuesta al paciente", texto: "El equipo escribe la respuesta y Turnia se la manda por WhatsApp." },
          { titulo: "Estado visible", texto: "El agente sabe qué pedidos están pendientes si el paciente vuelve a escribir." },
          { titulo: "Métricas", texto: "Cuántas tareas se crearon, por tipo, y cuánto tardaron en resolverse." },
        ],
      },
    ],
    porque: {
      titulo: "El agente y tu equipo, trabajando juntos",
      items: [
        "Nada se pierde entre un mensaje y otro.",
        "Cada tarea resuelta vuelve al paciente automáticamente.",
        "Todo queda registrado en la ficha.",
      ],
    },
    faqs: [
      {
        pregunta: "¿Qué tipos de tareas existen?",
        respuesta: "Recetas, resultados, órdenes médicas, facturación, derivación a una persona, urgencias y otras.",
      },
      {
        pregunta: "¿Cómo se entera el equipo?",
        respuesta: "En el panel, en la bandeja de tareas. Con n8n podés sumar avisos por mail, Slack o WhatsApp interno.",
      },
      {
        pregunta: "¿Puedo responderle al paciente desde la tarea?",
        respuesta: "Sí. Al resolver la tarea escribís la respuesta y Turnia se la manda por WhatsApp.",
      },
      {
        pregunta: "¿Hay usuarios por persona?",
        respuesta: "Hoy el panel tiene un acceso compartido. Usuarios y roles por persona están en el plan de producto.",
      },
      {
        pregunta: "¿Se puede exportar?",
        respuesta: "Los eventos de tareas salen por n8n, así que podés llevarlos a una planilla o a otro sistema sin programar.",
      },
    ],
  },
];

export function getCaso(slug: string): CasoDeUso | undefined {
  return CASOS.find((c) => c.slug === slug);
}
