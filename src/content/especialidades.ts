import type { Especialidad } from "./tipos";

// Páginas /especialidades/[slug]. Mismo recorrido que las páginas de especialidad
// de Assort (hero, flujos propios, ejemplo, demo de audio y preguntas), con texto
// propio y adaptado a Argentina. Sin métricas ni clientes inventados.

export const ESPECIALIDADES: Especialidad[] = [
  {
    slug: "traumatologia",
    nombre: "Traumatología",
    icono: "hueso",
    eyebrow: "IA para traumatología",
    titulo: "Tu agenda de traumatología, atendida las 24 horas",
    bajada:
      "Turnos de primera vez, controles post-quirúrgicos, kinesiología y accidentes laborales, resueltos por WhatsApp y teléfono con las reglas de cada profesional.",
    flujos: [
      {
        titulo: "Controles post-quirúrgicos",
        texto: "Agenda los controles a los 7, 15 y 30 días con el mismo cirujano y le avisa al paciente qué estudios traer.",
      },
      {
        titulo: "Estudios previos y órdenes",
        texto: "Pide la foto de la orden y de la RX o la resonancia antes del turno, y la deja adjunta como tarea para el consultorio.",
      },
      {
        titulo: "ART y accidentes laborales",
        texto: "Distingue la consulta por ART de la de obra social, toma el número de siniestro y la deriva al circuito que corresponde.",
      },
      {
        titulo: "Kinesiología en serie",
        texto: "Reserva series de sesiones respetando la frecuencia indicada y reprograma la que el paciente no puede.",
      },
      {
        titulo: "Triage de lesiones agudas",
        texto: "Ante deformidad, fractura expuesta o pérdida de sensibilidad, indica guardia o 107 y crea una tarea urgente.",
      },
    ],
    ejemplo: {
      paciente: "Hola, me operaron la rodilla hace una semana con el Dr. Fernández y me dijeron que tenía que volver a control.",
      agente:
        "¡Hola! Te puedo dar el control con el Dr. Fernández el jueves a las 9:20 o el viernes a las 11:00. Traé la última placa si te la hiciste.",
    },
    faqs: [
      {
        pregunta: "¿Puede manejar distintas duraciones de turno por profesional?",
        respuesta:
          "Sí. Cada tipo de turno (primera vez, control, infiltración, kinesiología) tiene su duración y se ofrecen solo los profesionales que lo hacen.",
      },
      {
        pregunta: "¿Qué pasa con los pacientes que vienen por ART?",
        respuesta:
          "El agente pregunta si se trata de un accidente laboral, registra la ART y el número de siniestro, y sigue las reglas que definas para esos turnos.",
      },
      {
        pregunta: "¿Da indicaciones médicas sobre la lesión?",
        respuesta:
          "No. Nunca diagnostica ni indica tratamientos. Si hay signos de alarma deriva a guardia o 107 y le avisa al equipo.",
      },
    ],
  },
  {
    slug: "dermatologia",
    nombre: "Dermatología",
    icono: "piel",
    eyebrow: "IA para dermatología",
    titulo: "Dermatología clínica y estética, sin agenda trabada",
    bajada:
      "Turnos de control de lunares, consultas clínicas y tratamientos estéticos, con la cobertura correcta para cada profesional y cada práctica.",
    flujos: [
      {
        titulo: "Control de lunares",
        texto: "Agenda la dermatoscopía con quien la hace y programa el recall anual para que el paciente no se olvide.",
      },
      {
        titulo: "Cobertura por profesional",
        texto: "Sabe qué dermatólogo atiende cada obra social o prepaga y ofrece particular cuando corresponde.",
      },
      {
        titulo: "Clínica vs. estética",
        texto: "Separa la consulta médica del tratamiento estético, con duraciones, precios de referencia e indicaciones previas distintas.",
      },
      {
        titulo: "Resultados de biopsias",
        texto: "Toma el pedido de resultados como tarea para el profesional y le responde al paciente por WhatsApp cuando el equipo lo resuelve.",
      },
      {
        titulo: "Recetas de tratamientos crónicos",
        texto: "Registra el pedido de renovación de recetas de acné, psoriasis o dermatitis con los datos completos para el médico.",
      },
    ],
    ejemplo: {
      paciente: "Quiero que me revisen un lunar que me cambió de color, tengo Swiss Medical.",
      agente:
        "Te ayudo. La Dra. Ruiz atiende Swiss Medical y hace dermatoscopía: tengo el martes a las 10:40. ¿Te lo reservo?",
    },
    demo: "dermatologia",
    faqs: [
      {
        pregunta: "¿Puede ofrecer turnos solo con quien atiende mi cobertura?",
        respuesta:
          "Sí. Cada profesional tiene su lista de coberturas y el agente solo ofrece horarios compatibles con la del paciente.",
      },
      {
        pregunta: "¿Informa precios de tratamientos estéticos?",
        respuesta:
          "Puede informar los precios de referencia que cargues en el panel. Si no hay precio cargado, deja la consulta como tarea.",
      },
      {
        pregunta: "¿Opina sobre una foto del lunar?",
        respuesta:
          "No. El agente no evalúa lesiones: agenda la consulta y, si el paciente describe sangrado o cambios rápidos, prioriza el turno y avisa al equipo.",
      },
    ],
  },
  {
    slug: "oftalmologia",
    nombre: "Oftalmología",
    icono: "ojo",
    eyebrow: "IA para oftalmología",
    titulo: "Oftalmología con agenda llena y sin esperas",
    bajada:
      "Controles anuales, estudios, prequirúrgicos de cataratas y urgencias oculares, resueltos por WhatsApp con las indicaciones de cada práctica.",
    flujos: [
      {
        titulo: "Controles y recetas de anteojos",
        texto: "Agenda el control anual y avisa cuando ya pasó el año desde la última consulta.",
      },
      {
        titulo: "Estudios con indicaciones",
        texto: "Para campo visual, OCT o fondo de ojo con dilatación, envía las indicaciones previas (venir acompañado, no manejar).",
      },
      {
        titulo: "Circuito de cataratas",
        texto: "Ordena los turnos de evaluación, estudios prequirúrgicos y control posterior, y toma la autorización de la obra social.",
      },
      {
        titulo: "Urgencias oculares",
        texto: "Ante golpe, químicos en el ojo o pérdida brusca de visión, indica guardia oftalmológica de inmediato y crea una tarea urgente.",
      },
    ],
    ejemplo: {
      paciente: "Necesito hacerme el campo visual que me pidió el doctor, tengo PAMI.",
      agente:
        "Perfecto. Tengo el miércoles a las 15:00 en la sede de Belgrano. Traé la orden y tus anteojos. ¿Te lo reservo?",
    },
    faqs: [
      {
        pregunta: "¿Puede diferenciar estudios con y sin dilatación?",
        respuesta: "Sí. Cada estudio tiene su duración e indicaciones previas, que el agente manda al confirmar el turno.",
      },
      {
        pregunta: "¿Maneja las órdenes de PAMI?",
        respuesta:
          "Pide la foto de la orden y la deja adjunta en una tarea para que el equipo la valide. No reemplaza la validación administrativa.",
      },
      {
        pregunta: "¿Qué hace ante una urgencia?",
        respuesta: "Indica ir a la guardia o llamar al 107 y crea una tarea urgente para que el equipo haga seguimiento.",
      },
    ],
  },
  {
    slug: "ginecologia-obstetricia",
    nombre: "Ginecología y obstetricia",
    icono: "mujer",
    eyebrow: "IA para ginecología y obstetricia",
    titulo: "Acompañá cada control, del PAP al parto",
    bajada:
      "Controles anuales, seguimiento del embarazo y estudios, con verificación de cobertura y la calidez que necesita cada paciente.",
    flujos: [
      {
        titulo: "Controles prenatales",
        texto: "Agenda los controles según la semana de gestación y recuerda las ecografías y análisis de cada trimestre.",
      },
      {
        titulo: "Verificación de cobertura",
        texto: "Toma obra social, plan y número de afiliado, y ofrece solo profesionales que atienden esa cobertura.",
      },
      {
        titulo: "PAP y control anual",
        texto: "Recall automático para el control ginecológico anual, con las indicaciones previas para el estudio.",
      },
      {
        titulo: "Resultados y recetas",
        texto: "Pedidos de resultados y de anticonceptivos quedan como tareas con todos los datos, y la respuesta vuelve por WhatsApp.",
      },
      {
        titulo: "Signos de alarma en el embarazo",
        texto: "Ante sangrado, pérdida de líquido o falta de movimientos, indica guardia obstétrica de inmediato y avisa al equipo.",
      },
    ],
    ejemplo: {
      paciente: "Estoy de 12 semanas y necesito el turno de control con la Dra. Gómez, tengo OSDE 310.",
      agente:
        "¡Felicitaciones! La Dra. Gómez atiende OSDE 310: tengo el lunes a las 9:00 o el miércoles a las 17:20. ¿Cuál preferís?",
    },
    demo: "ginecologia-obstetricia",
    faqs: [
      {
        pregunta: "¿Puede agendar con la misma obstetra durante todo el embarazo?",
        respuesta:
          "Sí. La memoria del paciente guarda con quién se atiende y el agente prioriza a esa profesional en cada control.",
      },
      {
        pregunta: "¿Cómo trata los temas sensibles?",
        respuesta:
          "Con un tono cuidado y sin pedir más información de la necesaria. Las consultas clínicas quedan como tarea para la profesional.",
      },
      {
        pregunta: "¿Qué hace si la paciente describe un síntoma de alarma?",
        respuesta: "Indica guardia obstétrica o 107 sin demoras y crea una tarea urgente para el equipo.",
      },
    ],
  },
  {
    slug: "pediatria",
    nombre: "Pediatría",
    icono: "bebe",
    eyebrow: "IA para pediatría",
    titulo: "Atención pediátrica que las familias valoran",
    bajada:
      "Controles de niño sano, vacunas, certificados y consultas por fiebre, con respuestas claras para madres y padres a cualquier hora.",
    flujos: [
      {
        titulo: "Turnos para hijos",
        texto: "Registra al menor con sus datos y cobertura, vinculado al adulto que escribe, y agenda con su pediatra de cabecera.",
      },
      {
        titulo: "Controles de niño sano",
        texto: "Recall según la edad: controles del primer año, chequeos anuales y certificados de aptitud escolar.",
      },
      {
        titulo: "Vacunas y calendario",
        texto: "Responde dónde y cuándo se vacuna según la información que cargue la clínica, sin dar indicaciones médicas.",
      },
      {
        titulo: "Triage de fiebre",
        texto: "Pregunta por signos de alarma y, si los hay, indica guardia pediátrica o 107; si no, ofrece el primer turno disponible.",
      },
      {
        titulo: "Certificados y recetas",
        texto: "Toma pedidos de certificados y recetas como tareas para la pediatra, con respuesta por WhatsApp.",
      },
    ],
    ejemplo: {
      paciente: "Mi hijo tiene fiebre desde ayer, ¿me dan un turno para hoy?",
      agente:
        "Te ayudo. ¿Tiene dificultad para respirar, manchas en la piel o está muy decaído? Si no, te puedo dar hoy a las 18:10 con la Dra. Paz.",
    },
    demo: "pediatria",
    faqs: [
      {
        pregunta: "¿Puede manejar varios hijos desde el mismo WhatsApp?",
        respuesta: "Sí. El agente pregunta para quién es el turno y registra a cada menor con su propia cobertura.",
      },
      {
        pregunta: "¿Da consejos sobre medicación o dosis?",
        respuesta:
          "No. No indica medicación ni dosis. Deriva la consulta a la pediatra como tarea o, si hay signos de alarma, a guardia.",
      },
      {
        pregunta: "¿Funciona de noche y fines de semana?",
        respuesta: "Sí. Da turnos a cualquier hora y aplica el protocolo de fuera de horario que defina la clínica.",
      },
    ],
  },
  {
    slug: "clinica-medica",
    nombre: "Clínica médica",
    icono: "estetoscopio",
    eyebrow: "IA para clínica médica",
    titulo: "Atención primaria sin teléfonos colapsados",
    bajada:
      "Chequeos, seguimientos, derivaciones a especialistas y recetas crónicas, resueltos por WhatsApp para que tu equipo se dedique a atender.",
    flujos: [
      {
        titulo: "Chequeos y aptos",
        texto: "Agenda el chequeo anual, el apto físico o laboral y envía las indicaciones de ayuno para los análisis.",
      },
      {
        titulo: "Derivaciones a especialistas",
        texto: "Con la orden del clínico, busca el turno con el especialista de la misma institución que atiende la cobertura.",
      },
      {
        titulo: "Recetas crónicas",
        texto: "Toma la renovación de la medicación habitual como tarea y le avisa al paciente cuando está lista.",
      },
      {
        titulo: "Seguimiento de pacientes",
        texto: "Recall de controles de hipertensión, diabetes o colesterol según la frecuencia que defina el profesional.",
      },
      {
        titulo: "Consultas generales",
        texto: "Responde horarios, direcciones, coberturas y requisitos con la información de la clínica, sin inventar.",
      },
    ],
    ejemplo: {
      paciente: "Necesito renovar la receta de la presión y sacar turno para el control.",
      agente:
        "Le dejo el pedido de receta al Dr. Sosa y te aviso por acá cuando esté. Para el control tengo el viernes a las 8:40, ¿te sirve?",
    },
    demo: "clinica-medica",
    faqs: [
      {
        pregunta: "¿Puede resolver varios pedidos en una misma conversación?",
        respuesta: "Sí. Puede dar un turno, registrar un pedido de receta y responder una consulta en el mismo mensaje.",
      },
      {
        pregunta: "¿Cómo se entera el médico de los pedidos?",
        respuesta:
          "Quedan como tareas en el panel con el resumen y los datos del paciente. Cuando el equipo responde, el paciente recibe la respuesta por WhatsApp.",
      },
      {
        pregunta: "¿Recuerda lo que el paciente contó antes?",
        respuesta: "Sí. La memoria del paciente resume preferencias, cobertura y pedidos pendientes para la próxima conversación.",
      },
    ],
  },
  {
    slug: "otorrinolaringologia",
    nombre: "Otorrino y alergia",
    icono: "oido",
    eyebrow: "IA para otorrinolaringología y alergia",
    titulo: "Otorrino y alergia, con cada estudio en su lugar",
    bajada:
      "Consultas, audiometrías, tests alérgicos y vacunas de alergia, agendados con la preparación y la frecuencia correcta.",
    flujos: [
      {
        titulo: "Audiometrías y estudios",
        texto: "Agenda audiometría, impedanciometría o videoendoscopía con la duración y las indicaciones de cada estudio.",
      },
      {
        titulo: "Tests de alergia",
        texto: "Envía las indicaciones previas, como suspender antihistamínicos si el profesional lo pide, y confirma el día anterior.",
      },
      {
        titulo: "Vacunas de alergia en serie",
        texto: "Reserva las aplicaciones periódicas y recupera las que el paciente pierde.",
      },
      {
        titulo: "Triage respiratorio",
        texto: "Ante dificultad para respirar o hinchazón de cara o garganta, indica guardia o 107 de inmediato.",
      },
    ],
    ejemplo: {
      paciente: "Me pidieron una audiometría, ¿tengo que hacer algo antes?",
      agente:
        "Te recomendamos no exponerte a ruidos fuertes el día anterior. Tengo el martes a las 16:30, ¿te lo reservo?",
    },
    faqs: [
      {
        pregunta: "¿Puede agendar un estudio y la consulta el mismo día?",
        respuesta: "Sí, si la agenda lo permite: busca horarios consecutivos con el técnico y el profesional.",
      },
      {
        pregunta: "¿Manda las indicaciones previas?",
        respuesta: "Sí. Cada tipo de turno tiene sus indicaciones y el agente las envía al confirmar.",
      },
      {
        pregunta: "¿Qué hace ante una reacción alérgica grave?",
        respuesta: "Indica llamar al 107 o ir a la guardia sin demora y crea una tarea urgente.",
      },
    ],
  },
  {
    slug: "tratamiento-del-dolor",
    nombre: "Tratamiento del dolor",
    icono: "dolor",
    eyebrow: "IA para tratamiento del dolor",
    titulo: "Pacientes con dolor, atendidos sin demoras",
    bajada:
      "Consultas, procedimientos y seguimientos de pacientes crónicos, con autorizaciones, indicaciones y un trato paciente.",
    flujos: [
      {
        titulo: "Procedimientos con autorización",
        texto: "Pide la foto de la orden y la autorización de la obra social antes de confirmar un bloqueo o una infiltración.",
      },
      {
        titulo: "Indicaciones previas",
        texto: "Envía ayuno, acompañante y suspensión de medicación según las indicaciones de la clínica.",
      },
      {
        titulo: "Seguimiento de crónicos",
        texto: "Recall de controles periódicos y renovación de recetas como tareas para el profesional.",
      },
      {
        titulo: "Signos de alarma",
        texto: "Ante pérdida de fuerza, de control de esfínteres o dolor súbito intenso, indica guardia o 107.",
      },
    ],
    ejemplo: {
      paciente: "Ya tengo la autorización de IOMA para la infiltración, ¿cuándo me la pueden hacer?",
      agente:
        "Mandame una foto de la autorización y te reservo. Tengo el jueves a las 10:00; vení acompañado y con 6 horas de ayuno.",
    },
    faqs: [
      {
        pregunta: "¿Puede bloquear turnos hasta que llegue la autorización?",
        respuesta: "Puede dejar el pedido como tarea con la orden adjunta para que el equipo confirme el turno cuando esté autorizado.",
      },
      {
        pregunta: "¿Renueva recetas de analgésicos?",
        respuesta: "No las emite: toma el pedido completo como tarea para el profesional, que decide.",
      },
      {
        pregunta: "¿Cómo trata a pacientes que escriben angustiados?",
        respuesta: "Con empatía y respuestas cortas. Si hace falta una persona, deriva la conversación con todo el contexto.",
      },
    ],
  },
  {
    slug: "cardiologia",
    nombre: "Cardiología",
    icono: "corazon",
    eyebrow: "IA para cardiología",
    titulo: "Cardiología con estudios en orden y alarmas claras",
    bajada:
      "Consultas, electrocardiogramas, ecocardiogramas, ergometrías y holter, agendados en la secuencia correcta y con triage de síntomas.",
    flujos: [
      {
        titulo: "Estudios antes de la consulta",
        texto: "Cuando el cardiólogo necesita ECG o eco previo, agenda primero el estudio y después la consulta.",
      },
      {
        titulo: "Ergometría y holter",
        texto: "Envía las indicaciones (ropa cómoda, medicación, bañarse antes del holter) y confirma el día anterior.",
      },
      {
        titulo: "Prequirúrgicos",
        texto: "Ordena el riesgo quirúrgico con los estudios que pide el cirujano y toma la orden por foto.",
      },
      {
        titulo: "Seguimiento de crónicos",
        texto: "Recall de controles de hipertensión, arritmias o post-infarto según la frecuencia que defina el equipo.",
      },
      {
        titulo: "Dolor de pecho",
        texto: "Ante dolor de pecho, falta de aire o desmayo, indica llamar al 107 de inmediato y crea una tarea urgente.",
      },
    ],
    ejemplo: {
      paciente: "Necesito el riesgo quirúrgico para operarme de la vesícula, tengo Galeno.",
      agente:
        "Te armo el circuito: electrocardiograma el lunes a las 8:00 y consulta con el Dr. Ibarra a las 8:30, el mismo día. ¿Te sirve?",
    },
    demo: "cardiologia",
    faqs: [
      {
        pregunta: "¿Puede encadenar el estudio y la consulta?",
        respuesta: "Sí. Busca horarios consecutivos para que el paciente haga todo en una sola visita.",
      },
      {
        pregunta: "¿Qué hace si alguien escribe con dolor de pecho?",
        respuesta: "No da un turno: indica llamar al 107 o ir a la guardia de inmediato y avisa al equipo con una tarea urgente.",
      },
      {
        pregunta: "¿Envía las indicaciones de cada estudio?",
        respuesta: "Sí. Cada tipo de turno tiene sus indicaciones previas, que el agente manda al confirmar y en el recordatorio.",
      },
    ],
  },
  {
    slug: "urologia",
    nombre: "Urología",
    icono: "rinon",
    eyebrow: "IA para urología",
    titulo: "Urología con privacidad y agenda ordenada",
    bajada:
      "Controles prostáticos, estudios urodinámicos, ecografías y procedimientos, con la discreción y la preparación que cada uno requiere.",
    flujos: [
      {
        titulo: "Control prostático anual",
        texto: "Recall del control anual con el pedido de PSA previo, según las indicaciones del profesional.",
      },
      {
        titulo: "Estudios con preparación",
        texto: "Ecografía vesical, urodinamia o cistoscopía: envía la preparación y confirma que el paciente la recibió.",
      },
      {
        titulo: "Resultados y recetas",
        texto: "Pedidos de resultados y renovaciones quedan como tareas, y la respuesta vuelve por WhatsApp.",
      },
      {
        titulo: "Urgencias urológicas",
        texto: "Ante retención urinaria, sangrado abundante o dolor intenso con fiebre, indica guardia de inmediato.",
      },
    ],
    ejemplo: {
      paciente: "Me toca el control de próstata, ¿tengo que hacerme algo antes?",
      agente:
        "El Dr. Molina pide el PSA antes del control. Te doy el turno de laboratorio el lunes a las 7:30 y la consulta el lunes siguiente a las 10:00.",
    },
    faqs: [
      {
        pregunta: "¿Cómo cuida la privacidad?",
        respuesta: "Pide solo los datos necesarios para el turno y no comenta síntomas en los recordatorios.",
      },
      {
        pregunta: "¿Puede programar estudios previos?",
        respuesta: "Sí, si están cargados como tipos de turno: agenda primero el estudio y después la consulta.",
      },
      {
        pregunta: "¿Da indicaciones médicas?",
        respuesta: "No. Envía solo las indicaciones de preparación cargadas por la clínica y deriva lo clínico al profesional.",
      },
    ],
  },
  {
    slug: "neurologia",
    nombre: "Neurología",
    icono: "cerebro",
    eyebrow: "IA para neurología",
    titulo: "Neurología: turnos largos, estudios y seguimiento",
    bajada:
      "Primeras consultas, electroencefalogramas, seguimientos de pacientes crónicos y un triage cuidadoso de síntomas de alarma.",
    flujos: [
      {
        titulo: "Primera consulta extendida",
        texto: "Reserva el bloque largo de primera vez y pide traer estudios previos e informes.",
      },
      {
        titulo: "EEG y estudios",
        texto: "Envía las indicaciones del electroencefalograma o el electromiograma y confirma el día anterior.",
      },
      {
        titulo: "Pacientes con acompañante",
        texto: "Registra al familiar que gestiona los turnos y mantiene el contexto en la memoria del paciente.",
      },
      {
        titulo: "Signos de ACV",
        texto: "Ante pérdida de fuerza, dificultad para hablar o desviación de la boca, indica llamar al 107 sin demora.",
      },
    ],
    ejemplo: {
      paciente: "Escribo por mi papá, necesita un turno con neurología por los temblores, tiene PAMI.",
      agente:
        "Claro. La Dra. Vidal atiende PAMI: tengo una primera consulta el martes 12 a las 11:00. Traé los estudios que tenga y la orden del médico de cabecera.",
    },
    faqs: [
      {
        pregunta: "¿Puede gestionar turnos para familiares?",
        respuesta: "Sí. El agente registra al paciente y a quien escribe, y lo recuerda para las próximas conversaciones.",
      },
      {
        pregunta: "¿Qué hace ante síntomas de ACV?",
        respuesta: "Indica llamar al 107 de inmediato, sin ofrecer turnos, y crea una tarea urgente.",
      },
      {
        pregunta: "¿Maneja órdenes de PAMI?",
        respuesta: "Pide la foto de la orden y la deja adjunta como tarea para que el equipo la valide.",
      },
    ],
  },
  {
    slug: "gastroenterologia",
    nombre: "Gastroenterología",
    icono: "estomago",
    eyebrow: "IA para gastroenterología",
    titulo: "Endoscopías con la preparación bien explicada",
    bajada:
      "Videocolonoscopías, endoscopías y consultas, con indicaciones claras, autorizaciones y confirmación para reducir suspensiones.",
    flujos: [
      {
        titulo: "Videocolonoscopía",
        texto: "Agenda el estudio, envía la preparación paso a paso y la recuerda el día anterior.",
      },
      {
        titulo: "Autorizaciones y órdenes",
        texto: "Pide la orden y la autorización de la cobertura por foto y las deja adjuntas al turno.",
      },
      {
        titulo: "Anestesia y acompañante",
        texto: "Recuerda el ayuno, la necesidad de acompañante y que no puede manejar después del estudio.",
      },
      {
        titulo: "Consultas y seguimiento",
        texto: "Recall de controles después de una polipectomía y pedidos de resultados como tareas.",
      },
      {
        titulo: "Signos de alarma",
        texto: "Ante sangrado digestivo o dolor abdominal intenso, indica guardia o 107 y avisa al equipo.",
      },
    ],
    ejemplo: {
      paciente: "Me pidieron una videocolonoscopía, ¿qué tengo que hacer?",
      agente:
        "Te doy el turno y te mando la preparación. Tengo el sábado a las 8:00; dos días antes empezás la dieta sin fibras y vas con acompañante.",
    },
    demo: "gastroenterologia",
    faqs: [
      {
        pregunta: "¿Envía la preparación completa?",
        respuesta: "Sí. Envía las indicaciones cargadas por la clínica al confirmar y las recuerda antes del estudio.",
      },
      {
        pregunta: "¿Puede reducir las suspensiones por mala preparación?",
        respuesta: "Ayuda: confirma que el paciente entendió las indicaciones y responde dudas a cualquier hora.",
      },
      {
        pregunta: "¿Qué pasa si el paciente cancela?",
        respuesta: "El turno se libera y se ofrece automáticamente a la lista de espera de ese estudio.",
      },
    ],
  },
  {
    slug: "podologia",
    nombre: "Podología",
    icono: "pie",
    eyebrow: "IA para podología",
    titulo: "Podología: sesiones periódicas sin perder pacientes",
    bajada:
      "Turnos de primera vez, sesiones periódicas y pie diabético, con recordatorios y recall para que nadie abandone el tratamiento.",
    flujos: [
      {
        titulo: "Sesiones periódicas",
        texto: "Recall automático según la frecuencia indicada y reprogramación en la misma conversación.",
      },
      {
        titulo: "Pie diabético",
        texto: "Prioriza los controles de pacientes diabéticos y avisa al equipo si describen heridas o cambios de color.",
      },
      {
        titulo: "Plantillas y estudios",
        texto: "Agenda baropodometría y la entrega de plantillas con la duración de cada práctica.",
      },
      {
        titulo: "Preguntas frecuentes",
        texto: "Responde precios de referencia, coberturas y cómo prepararse para la sesión.",
      },
    ],
    ejemplo: {
      paciente: "Hola, ya me toca la sesión del mes, ¿tienen el sábado?",
      agente: "¡Hola Marta! Tengo el sábado a las 10:30 con Laura, como la vez pasada. ¿Te lo reservo?",
    },
    faqs: [
      {
        pregunta: "¿Puede recordar con quién se atiende cada paciente?",
        respuesta: "Sí. La memoria del paciente guarda su profesional y sus horarios preferidos.",
      },
      {
        pregunta: "¿Avisa a los pacientes que dejaron de venir?",
        respuesta: "Sí. Las campañas de recall y reactivación les escriben por WhatsApp para retomar las sesiones.",
      },
      {
        pregunta: "¿Funciona para consultorios chicos?",
        respuesta: "Sí. Se configura con uno o varios profesionales y la agenda propia de Turnia.",
      },
    ],
  },
  {
    slug: "salud-mental",
    nombre: "Salud mental",
    icono: "mente",
    eyebrow: "IA para salud mental",
    titulo: "Salud mental: acceso cuidado desde el primer mensaje",
    bajada:
      "Primeras entrevistas, sesiones semanales y renovación de recetas, con un tono contenedor y un protocolo claro ante riesgo.",
    flujos: [
      {
        titulo: "Primera entrevista",
        texto: "Toma los datos mínimos, la cobertura y la preferencia de modalidad (presencial o virtual) y asigna profesional.",
      },
      {
        titulo: "Sesiones semanales",
        texto: "Mantiene el mismo día y horario de cada paciente y reprograma solo cuando hace falta.",
      },
      {
        titulo: "Recetas de psiquiatría",
        texto: "Toma el pedido de renovación como tarea para el psiquiatra, con respuesta por WhatsApp.",
      },
      {
        titulo: "Protocolo de riesgo",
        texto: "Ante ideas de hacerse daño, brinda la línea de salud mental (0800-999-0091 o 135 en CABA y GBA), indica 107 o guardia y crea una tarea urgente.",
      },
    ],
    ejemplo: {
      paciente: "Quiero empezar terapia, ¿cómo hago?",
      agente:
        "Gracias por escribir. ¿Preferís atención presencial o virtual? Con eso te ofrezco los primeros turnos disponibles.",
    },
    faqs: [
      {
        pregunta: "¿El agente hace contención o terapia?",
        respuesta: "No. Gestiona turnos e información con un tono cuidado; lo clínico queda siempre en manos de los profesionales.",
      },
      {
        pregunta: "¿Qué hace ante un riesgo?",
        respuesta: "Brinda las líneas de ayuda, indica 107 o guardia y crea una tarea urgente para el equipo.",
      },
      {
        pregunta: "¿Puede manejar sesiones virtuales?",
        respuesta: "Sí, como un tipo de turno más, y envía las indicaciones o el enlace que defina la clínica.",
      },
    ],
  },
  {
    slug: "diagnostico-por-imagenes",
    nombre: "Diagnóstico por imágenes",
    icono: "imagen",
    eyebrow: "IA para diagnóstico por imágenes",
    titulo: "Imágenes: cada estudio con su preparación y su orden",
    bajada:
      "Ecografías, resonancias, tomografías y mamografías, con órdenes por foto, autorizaciones y preparación para cada estudio.",
    flujos: [
      {
        titulo: "Órdenes por foto",
        texto: "El paciente manda la foto de la orden y el agente identifica el estudio y la deja adjunta al turno.",
      },
      {
        titulo: "Preparación por estudio",
        texto: "Ayuno, vejiga llena, contraste o retirar objetos metálicos: envía las indicaciones de cada práctica.",
      },
      {
        titulo: "Autorizaciones",
        texto: "Pide la autorización de la obra social cuando corresponde y deja el caso como tarea si falta.",
      },
      {
        titulo: "Entrega de informes",
        texto: "Responde cuándo y cómo se retira el informe según la información de la clínica.",
      },
      {
        titulo: "Lista de espera",
        texto: "Cuando alguien cancela una resonancia, ofrece el turno a quien estaba esperando.",
      },
    ],
    ejemplo: {
      paciente: "Te mando la orden de la eco abdominal, tengo Medifé.",
      agente:
        "Recibida. Tengo el jueves a las 8:20; tenés que venir con 6 horas de ayuno. ¿Te lo reservo?",
    },
    faqs: [
      {
        pregunta: "¿Puede leer la orden médica?",
        respuesta: "Puede leer la foto para identificar el estudio y la deja adjunta como tarea para que el equipo la valide.",
      },
      {
        pregunta: "¿Pregunta por contraindicaciones?",
        respuesta: "Hace las preguntas que la clínica cargue (por ejemplo, marcapasos o embarazo) y deriva al equipo si hay dudas.",
      },
      {
        pregunta: "¿Llena huecos de equipos caros?",
        respuesta: "Sí. La lista de espera automática ofrece cada turno liberado a otros pacientes.",
      },
    ],
  },
  {
    slug: "oncologia",
    nombre: "Oncología",
    icono: "celula",
    eyebrow: "IA para oncología",
    titulo: "Oncología: acompañamiento sin fricción en cada etapa",
    bajada:
      "Consultas, sesiones de tratamiento, estudios de control y pedidos al equipo, con un trato humano y respuestas rápidas.",
    flujos: [
      {
        titulo: "Sesiones de tratamiento",
        texto: "Coordina las sesiones según el plan y avisa al equipo cuando el paciente necesita mover una.",
      },
      {
        titulo: "Estudios de control",
        texto: "Recuerda los estudios previos a cada consulta de seguimiento.",
      },
      {
        titulo: "Pedidos al equipo",
        texto: "Recetas, certificados y trámites quedan como tareas con todo el contexto, y la respuesta vuelve por WhatsApp.",
      },
      {
        titulo: "Síntomas de alarma",
        texto: "Ante fiebre durante el tratamiento u otros síntomas que defina el equipo, indica guardia y crea una tarea urgente.",
      },
    ],
    ejemplo: {
      paciente: "Mi mamá tiene sesión el martes pero ese día no la puedo llevar.",
      agente:
        "Entiendo. Le dejo el pedido al equipo para mover la sesión, porque depende del plan de tratamiento, y te escribimos por acá con la nueva fecha.",
    },
    faqs: [
      {
        pregunta: "¿El agente decide cambios en el tratamiento?",
        respuesta: "No. Cualquier cambio que dependa del plan queda como tarea para el equipo médico.",
      },
      {
        pregunta: "¿Puede derivar a una persona?",
        respuesta: "Sí. Por teléfono puede transferir la llamada y por WhatsApp crea una tarea de derivación con el resumen.",
      },
      {
        pregunta: "¿Cómo cuida el tono?",
        respuesta: "El prompt prioriza la empatía, mensajes cortos y no pedir información de más.",
      },
    ],
  },
  {
    slug: "guardia-y-emergencias",
    nombre: "Guardia y emergencias",
    icono: "ambulancia",
    eyebrow: "IA para guardias y emergencias",
    titulo: "Que la guardia atienda urgencias, no el teléfono",
    bajada:
      "Información de demoras, direcciones, coberturas y turnos de seguimiento, con derivación inmediata al 107 cuando hace falta.",
    flujos: [
      {
        titulo: "Información de la guardia",
        texto: "Responde dirección, coberturas que atiende y qué llevar, con la información que cargue la institución.",
      },
      {
        titulo: "Derivación al 107",
        texto: "Ante síntomas de riesgo, indica llamar al 107 o al servicio de emergencias de la cobertura, sin demoras.",
      },
      {
        titulo: "Turnos de seguimiento",
        texto: "Agenda el control con el especialista después del alta de guardia.",
      },
      {
        titulo: "Fuera de horario de consultorios",
        texto: "De noche, distingue lo urgente de lo que puede esperar al turno del día siguiente.",
      },
    ],
    ejemplo: {
      paciente: "Me dieron el alta de la guardia y me dijeron que vea a un traumatólogo esta semana.",
      agente:
        "Te ayudo. Tengo traumatología el miércoles a las 9:00 con el Dr. Fernández. Traé el informe de la guardia y las placas.",
    },
    faqs: [
      {
        pregunta: "¿Atiende emergencias?",
        respuesta: "No. Ante una emergencia indica llamar al 107 o ir a la guardia, y crea una tarea urgente para el equipo.",
      },
      {
        pregunta: "¿Puede informar demoras en tiempo real?",
        respuesta: "Solo si la institución carga esa información. Hoy no se conecta a sistemas de guardia.",
      },
      {
        pregunta: "¿Sirve para turnos post-alta?",
        respuesta: "Sí. Agenda el seguimiento con el especialista de la institución que atienda la cobertura.",
      },
    ],
  },
  {
    slug: "odontologia",
    nombre: "Odontología",
    icono: "diente",
    eyebrow: "IA para odontología",
    titulo: "Consultorios odontológicos con la agenda siempre llena",
    bajada:
      "Limpiezas, urgencias, ortodoncia e implantes, con recall cada seis meses y lista de espera automática.",
    flujos: [
      {
        titulo: "Recall de limpiezas",
        texto: "Le escribe a cada paciente a los seis meses de su última limpieza para que vuelva.",
      },
      {
        titulo: "Controles de ortodoncia",
        texto: "Mantiene la frecuencia mensual de los controles y reprograma sin perder el lugar.",
      },
      {
        titulo: "Urgencias odontológicas",
        texto: "Ante dolor intenso o un diente roto, ofrece el primer turno de urgencia disponible.",
      },
      {
        titulo: "Tratamientos largos",
        texto: "Encadena las sesiones de implantes o endodoncias con el mismo profesional.",
      },
      {
        titulo: "Coberturas y presupuestos",
        texto: "Informa qué prácticas cubre cada obra social según lo cargado y deja los presupuestos como tarea.",
      },
    ],
    ejemplo: {
      paciente: "Se me rompió una muela y me duele bastante, ¿me atienden hoy?",
      agente: "Uy, lo siento. Tengo un turno de urgencia hoy a las 17:40 con el Dr. Paredes. ¿Te lo reservo?",
    },
    faqs: [
      {
        pregunta: "¿Puede manejar turnos de distinta duración?",
        respuesta: "Sí. Limpieza, control, urgencia o tratamiento tienen su propia duración y profesionales.",
      },
      {
        pregunta: "¿Cómo funciona el recall?",
        respuesta: "Turnia detecta a quienes ya pasaron su período de control y les ofrece turno por WhatsApp, de forma automática.",
      },
      {
        pregunta: "¿Qué pasa si alguien cancela a último momento?",
        respuesta: "El hueco se ofrece a la lista de espera y el primero que confirma se queda con el turno.",
      },
    ],
  },
];

export function getEspecialidad(slug: string): Especialidad | undefined {
  return ESPECIALIDADES.find((e) => e.slug === slug);
}
