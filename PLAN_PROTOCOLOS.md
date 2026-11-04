# Plan: protocolos odontológicos, base común y lo que configura cada consultorio

Escrito el 4/11/2026. Parte de una investigación que el usuario le pidió a otra IA sobre cómo Assort Health arma sus agentes («62.000 protocolos clínicos», integración con el software médico). Este documento compara esa respuesta con lo que Turnia ya hace, corrige lo que no es así y deja el plan para bajarlo al producto, con foco en consultorios odontológicos y en el panel.

Regla del repo que sigue valiendo: de Assort se toman ideas, no material (ni textos, ni videos, ni fotos).

## 1. Qué hace Assort, según lo que publica

Lo comprobado en su web (assorthealth.com/blog, noviembre de 2026):

- **Los números son de toda la empresa:** «300M+ interacciones, 62K protocolos y 1,6M caminos de decisión» en más de 80 especialidades. No son 62.000 reglas por clínica: es la suma de todas sus especialidades y prestadores.
- **De dónde salen los protocolos:** de una biblioteca por especialidad y del material del propio consultorio: sus manuales de recepción, las plantillas de agenda de su sistema, el historial de turnos y las grabaciones de llamadas.
- **Qué reglas codifican:**
  - las preferencias de cada profesional;
  - qué tipo de visita corresponde a cada pedido;
  - las reglas de cada cobertura;
  - las derivaciones;
  - los períodos posteriores a una práctica en los que los controles no se cobran aparte;
  - el triaje de urgencias.
- **Integración:** leen la agenda y escriben el turno durante la llamada en 37 sistemas (Epic, athenahealth, NextGen y otros).
- **Implementación:** 5 a 6 semanas, no 7, con ingenieros en el lugar que mapean la lógica de agenda de cada profesional. Va por etapas:
  1. mapear los flujos;
  2. automatizar primero lo de mucho volumen y reglas claras (dar, mover y confirmar turnos);
  3. definir qué pasa a una persona y con qué datos;
  4. medir cómo estaba antes;
  5. sumar un flujo o una sede por vez cuando la precisión se sostiene.
- **Después de salir:** miden por tipo de pedido (turnos dados sobre pedidos de turno, abandono, ausentismo, cuánto resuelve sin humanos, si derivó bien). El pase a una persona es en caliente, con la conversación a la vista.

**Lo que hay que llevarse:** la ventaja de Assort no está en el prompt. Está en tres cosas: mapear bien las reglas de cada consultorio, escribir en su agenda y medir. La afirmación de la otra IA de que «jamás meten las reglas en el prompt» no se puede comprobar con lo que publican. Lo que sí es cierto, y conviene para Turnia, es la idea de fondo: lo que se puede chequear en código no se deja librado al texto.

## 2. Lo que Turnia ya tiene

La respuesta de la otra IA describe como «el secreto» una arquitectura que Turnia ya usa:

| Propuesta | En Turnia | Dónde |
| --- | --- | --- |
| Un mismo prompt base para todas las clínicas | Sí. Es único y cada conversación recibe variables con los datos de su clínica. | `SYSTEM_PROMPT` en `src/lib/agent/prompt.ts`; las variables, en `buildDynamicVariables` (`src/lib/clinic.ts`). |
| Datos de identidad por clínica | Sí: nombre del agente y de la clínica, dirección, horario, preguntas frecuentes, políticas, formas de pago, fuera de horario, teléfono de derivación e instrucciones propias. | `clinicInfoText` y Panel → Configuración. |
| No inventar horarios | Sí. `consultar_disponibilidad` calcula los huecos en código: horarios, bloqueos, turnos tomados y Google Calendar. | `checkAvailability` en `src/lib/agent/service.ts`. |
| Validar en código antes de confirmar | Sí: duración, horario, superposición, Google en el momento, cobertura del profesional y «Solo la da el consultorio». | `assertBookable`, `acceptedCoverage` y `assertAgentCanBook`. |
| Catálogo de prestaciones | Sí: duración, precio de referencia, indicaciones previas, primera consulta, control periódico y «Solo la da el consultorio». | Panel → Configuración → Prestaciones. |
| Consulta antes de un tratamiento complejo | En parte. Se marca la colocación como «Solo la da el consultorio» y una regla del prompt da la consulta con su nombre («Consulta de implantes»). | Prompt, «Cómo dar un turno», punto 1. |
| Pase a una persona | Sí: tareas por tipo (`crear_tarea`), transferencia en llamadas y la bandeja «Para el equipo» del Inicio. | `TASK_TYPES` en `src/lib/types.ts`. |
| Reactivación | Sí: campañas con control periódico por prestación, meses sin venir y espera entre contactos. | Panel → Campañas (`PLAN_CAMPANAS.md`). |
| Integración con la agenda | Google Calendar lee lo ocupado y escribe el turno. Smile Connect (Guerra–Mininni) se sincroniza desde el navegador cada 10 minutos. | `src/lib/calendar`, `src/lib/smile-connect.ts`. |

**Conclusión:** no hace falta rehacer la arquitectura. Lo que falta es que la capa estructurada pueda expresar más reglas odontológicas, para que dejen de ir en texto libre o en código escrito para una sola clínica.

## 3. Lo que falta de verdad

Ordenado por lo que más riesgo saca.

1. **La disponibilidad no mira la cobertura.**
   - `consultar_disponibilidad` filtra profesionales solo por especialidad. La cobertura recién se valida en `reservar_turno`.
   - Puede pasar esto: Sofi ofrece un horario con un profesional que no atiende la cobertura del paciente, el paciente dice que sí y la reserva falla.
   - Hoy lo evita solo el prompt («Verificá que la cobertura esté aceptada»).
2. **Profesional y prestación se unen por el texto de la especialidad** (`pro.specialty === type.specialty`).
   - Cada profesional tiene una sola especialidad.
   - Un odontólogo general que también hace conductos, o una endodoncista que solo los hace los jueves, no se pueden cargar bien.
   - Es lo que en `PENDIENTES.md` quedó resuelto con un truco para Lara (horarios con la duración de la endodoncia y la especialidad de esa prestación).
3. **Hay reglas de Guerra–Mininni escritas en el código.** `GUERRA_MININNI` aparece en `reschedule-policy.ts`, `clinic.ts` y `service.ts`, con tres reglas:
   - qué prestaciones mueve solo recepción (colocación de implantes, cirugías de regeneración, extracciones, visitas de más de 120 minutos);
   - conservar la duración al mover;
   - las 24 horas de aviso.

   Es el problema que la investigación marca, aunque en código y no en el prompt. Con la segunda clínica no escala.
4. **El aviso mínimo para cancelar o mover es texto.** Las 24 horas están en «Políticas» y las cumple el modelo, no el código. Funcionó en la prueba del 02/11, pero no está garantizado.
5. **Las coberturas no tienen plan ni prestación.** Faltan estos casos:
   - OSDE 310 sí y 210 con copago;
   - implantes y ortodoncia solo particular;
   - reintegro;
   - prácticas que necesitan autorización u orden de la prepaga.
6. **No hay turnos de urgencia.**
   - El triaje manda al 107 o a la guardia y crea una tarea urgente.
   - En odontología, el «me late la muela» casi nunca es para el 107: es un turno en el día.
   - La demo ya muestra esa promesa: el ejemplo de endodoncia de `src/lib/demo/dental-services.ts` dice «tengo un turno de urgencia hoy a las 18». Pero el producto no tiene cupo de urgencias, y la base no acepta sobreturnos de Sofi.
7. **El prompt base no es odontológico.** Es de salud en general (recetas, resultados, 107). Lo odontológico está disperso: la consulta de implantes en el prompt, el catálogo de la demo y los ejemplos de «Probar a Sofi». No hay un lugar que diga, igual para todos los consultorios:
   - qué es urgente;
   - qué prestación corresponde a «me sangran las encías»;
   - qué preguntar antes de un implante.
8. **Una cuenta nueva arranca vacía.** `createClinic` crea la clínica sin prestaciones. Las demos sí arman un catálogo desde la web, pero la cuenta de un cliente no. Para la garantía de 14 días conviene arrancar con una plantilla.
9. **El panel no muestra lo que se vende en el Programa Fundadores.** Las 50 interacciones del primer mes y «Operativa desde» existen en la planilla de Chapa Labs (#105), pero el consultorio no las ve. Tampoco ve cuántos turnos dio Sofi fuera del horario de atención.

## 4. Qué es común y qué configura cada consultorio

Esta es la respuesta a la pregunta de fondo. Son cuatro capas; la nueva es la 2.

| Capa | Qué tiene | Quién la cambia | Dónde vive |
| --- | --- | --- | --- |
| **1. Base de Turnia** (todas las clínicas) | Identidad de asistente con IA, no diagnosticar, no inventar horarios, privacidad de fichas, cómo dar, mover y cancelar turnos, pase a una persona, estilo por canal. | Solo Turnia, con pruebas. | `SYSTEM_PROMPT` (existe). |
| **2. Módulo odontológico** (todos los consultorios odontológicos) | Qué es urgente hoy y qué es para el 107; qué prestación corresponde a cada pedido; tratamientos que siempre empiezan con una consulta; qué preguntar antes; cómo hablar de precios; vocabulario; chicos; quejas después de una práctica. | Turnia, **validado por un odontólogo** (Mininni). No se escribe por suposición. | Nuevo: `src/lib/agent/modules/odontologia.ts`, inyectado como `{{specialty_protocol}}`. |
| **3. Identidad y textos del consultorio** | Nombre, agente, dirección, horario en texto, preguntas frecuentes, políticas, formas de pago, fuera de horario, teléfono de derivación, tono (vos o usted) e instrucciones adicionales. | El consultorio desde el panel, o Turnia en el setup. | `clinics` (existe; falta el tono como campo). |
| **4. Reglas estructuradas del consultorio** | Prestaciones, qué hace cada profesional, horarios, coberturas, urgencias, aviso mínimo, quién puede mover qué, bloqueos y calendario. | El consultorio desde el panel. | Tablas, validadas en las herramientas. |

**Regla para decidir dónde va algo:**

- **Si se puede chequear en código, va en la capa 4**, como un campo, y la herramienta lo hace cumplir.
- **«Instrucciones adicionales» queda como válvula de escape.** Cuando la misma instrucción aparece en dos consultorios, se convierte en un campo o pasa al módulo odontológico.
- **El código no tiene IDs de clínicas.** Si una regla es de un solo consultorio, es un campo con su valor.

## 5. Plan por etapas

Cada etapa se puede publicar sola. Todo cambio de base es aditivo (`alter table … add column if not exists`), como pide `scripts/migrate-db.mjs`.

### Etapa 0: antes del segundo cliente

1. **Plantilla odontológica al crear la cuenta.** Al crear una clínica odontológica, se cargan unas 12 prestaciones con valores por defecto, que el consultorio después confirma, cambia o desactiva:
   - primera consulta;
   - urgencia o dolor;
   - limpieza (control periódico de 6 meses);
   - caries u obturación;
   - conducto;
   - consulta de implantes;
   - colocación de implantes («Solo la da el consultorio»);
   - consulta de ortodoncia;
   - prótesis o corona;
   - extracción o muela de juicio;
   - blanqueamiento;
   - odontopediatría;
   - control.

   También se cargan el protocolo de urgencias y un esqueleto de preguntas frecuentes. Las duraciones son un punto de partida para la llamada de setup, no un dato del consultorio. Se puede reusar `DENTAL_SERVICES` (`src/lib/demo/dental-services.ts`).
2. **Sacar a Guerra–Mininni del código.** Nuevos campos de prestación, con los valores de hoy para Guerra–Mininni, y después se borran las comparaciones con `GUERRA_MININNI`:
   - «Sofi puede moverla» (`appointment_types.agent_can_reschedule`);
   - «Conservar la duración al mover».

   El límite de 120 minutos pasa a ser un dato de la clínica.
3. **Aviso mínimo para cancelar o mover** (`clinics.change_notice_hours`).
   - `cancelar_turno` y `reprogramar_turno` lo hacen cumplir.
   - Con menos aviso, devuelven el error que hoy produce el modelo por su cuenta: crear la tarea para recepción y decirle al paciente que conserva su turno.
4. **Tono como campo** (`clinics.tone`: vos o usted), en vez de una línea en «Instrucciones adicionales». El prompt ya sabe tratar de usted.
5. **La disponibilidad filtra por cobertura.**
   - `consultar_disponibilidad` deja afuera a los profesionales que no atienden la cobertura de la ficha.
   - Si nadie la atiende, lo dice para ofrecer particular.

   Es un arreglo chico que saca el riesgo número 1.

### Etapa 1: quién hace qué y con qué cobertura

6. **Profesional ↔ prestaciones.**
   - Tabla `professional_appointment_types`, de muchos a muchos. Si un profesional no tiene filas, sigue valiendo la especialidad, así lo cargado hoy no cambia.
   - En Panel → Equipo y horarios, casillas de «Qué prestaciones hace».
   - Opcional: que un horario sea solo para algunas prestaciones (Lara, endodoncia los jueves).
7. **Matriz de coberturas** (`coverage_rules`).
   - Cada fila tiene cobertura, plan (opcional), prestación (opcional) y profesional (opcional). El modo es uno de estos: acepta, con copago (monto), reintegro o no acepta.
   - Dos casillas más: «necesita autorización u orden» y una nota.
   - Panel → Coberturas: lista de sugerencias editable con las prepagas y obras sociales más comunes. En provincia de Buenos Aires conviene que estén IOMA y PAMI.
   - Las herramientas la aplican al buscar y al reservar. El agente recibe un resumen y no la tabla entera.

### Etapa 2: módulo odontológico y urgencias

8. **Módulo odontológico en el prompt.**
   - Es un bloque versionado en el código que se inyecta cuando la clínica es odontológica.
   - Agregar la variable obliga a volver a subir el prompt de cada agente una vez (`setupAgent`). Después, los cambios del módulo van sin tocar ElevenLabs.
   - La demo arma sus variables aparte (`src/lib/demo/session.ts`) y también la necesita.
   - Se escribe un borrador y lo valida Mininni antes de prenderlo.
9. **Cupo de urgencias.**
   - Una prestación marcada «Urgencia», y horas reservadas por profesional que solo puede usar esa prestación.
   - `consultar_disponibilidad` con urgencia busca hoy y mañana. Si no hay lugar, crea la tarea urgente y deriva.
   - **Decisión para el consultorio:** si el cupo que no se usó se libera para turnos comunes, y a qué hora.
   - El módulo separa la urgencia odontológica (turno en el día) de la emergencia (107 o guardia: hinchazón que dificulta respirar o tragar, sangrado que no para, golpe fuerte en la cara). Los criterios finales los define el odontólogo.
10. **Prestación previa obligatoria.**
    - En la prestación: «Para pacientes nuevos, antes: <prestación>» (`requires_type_id`), y «Qué preguntar antes» (por ejemplo, si tiene una panorámica reciente). La respuesta va a las notas del turno.
    - `reservar_turno` lo hace cumplir en código, en lugar de la regla del prompt.
11. **Cómo decir el precio** (`appointment_types.price_mode`): no informar, exacto o «desde». Así la consulta tiene precio cerrado y el implante, un «desde» con la aclaración de que el presupuesto se da en la consulta.

### Etapa 3: el panel que retiene

12. **Garantía del primer mes en el Inicio:**
    - «Interacciones: 34 de 50» y «Operativa desde»;
    - con los mismos cálculos que las columnas de la planilla de Chapa Labs (#105), para que los dos lados den lo mismo.
13. **Turnos que dio Sofi fuera de horario:** de noche, el fin de semana o mientras el profesional atendía. Se calcula con `appointments.created_at` contra los horarios del consultorio.
14. **Valor estimado de los turnos de Sofi:**
    - la suma de los precios de referencia cargados;
    - solo se muestra si hay precios, y con el rótulo «estimado con tus precios»;
    - no se inventa un valor por defecto.

### Etapa 4: integraciones, según lo que use cada cliente

15. **Google Calendar en las dos direcciones.**
    - Si el odontólogo mueve o borra un turno en su calendario, Turnia lo detecta y avisa al paciente por WhatsApp. Se hace con notificaciones de Google o con una consulta periódica.
    - Es el pendiente «Avisar al paciente cuando la clínica cancela o mueve un turno».
    - Para clínicas reales, antes hay que pasar la verificación de Google.
16. **Dentalink.** Tiene API pública (`api.dentalink.healthatom.com/docs`): crear, modificar y reprogramar citas (`POST /citas`, `PUT /citas/{id}`, `POST /citas/changeDate`) y pacientes. Es chileno y se usa en Latinoamérica. Solo vale la pena si un cliente lo usa.
17. **Software sin API** (Smile Connect, Excel). El camino ya probado es el de Guerra–Mininni: sincronizar desde el navegador hacia Turnia. Falta escribir de vuelta (el «Copiar para Smile Connect» de la ficha de salud).
18. **Abstracción de agenda.**
    - No se arma una capa común de agendas hasta la segunda integración real.
    - Mientras, en Prospección se anota qué software de agenda usa cada consultorio, para saber qué integrar primero.
19. **Seña para turnos largos:** no se construye hasta que un cliente la pida. Necesita cobros (por ejemplo, un link de Mercado Pago del consultorio), un estado «pendiente de seña» que vence y avisos. Mientras, queda como texto en «Políticas».

## 6. El setup de 14 días con este plan

Es la versión de Turnia de lo que Assort hace en 5 o 6 semanas con ingenieros en el lugar:

1. **Día 1:** crear la cuenta con la plantilla odontológica y dar el código de acceso.
2. **Días 2 y 3:** una llamada de 30 a 45 minutos con el odontólogo, completando juntos:
   - prestaciones (duración, precio y cómo decirlo, prestación previa, quién la mueve);
   - equipo y horarios (qué hace cada uno);
   - coberturas;
   - cupo de urgencias;
   - aviso mínimo.

   Es el «mapeo de protocolos».
3. **Días 4 a 7:** conectar el canal y el calendario, y correr los casos de prueba de abajo en Panel → Probar a Sofi.
4. **Días 8 a 14:** en vivo, primero con lo de mucho volumen (dar, mover y confirmar turnos). Se revisan las conversaciones y lo derivado. Cada instrucción nueva se carga como campo si existe, o en «Instrucciones adicionales» si no.

## 7. Casos de prueba odontológicos

Un set fijo, para correr antes de prender el módulo odontológico y después de cada cambio. Primero a mano en «Probar a Sofi»; automatizarlo después.

1. «Me late toda la cara desde anoche» → urgencia: turno en el día o derivación, nunca un turno en 12 días.
2. «Se me cayó el provisorio de adelante» → urgencia en el día.
3. «Tengo la cara hinchada y me cuesta tragar» → 107 o guardia primero, y tarea urgente.
4. «Quiero ponerme un implante» → consulta de implantes, pregunta por la panorámica, nunca la colocación.
5. «Me sangran las encías» → la prestación de limpieza o periodoncia del catálogo.
6. «Tengo OSDE 210» con un profesional que solo atiende OSDE 310 → no se ofrece ese profesional; se ofrece otro o particular.
7. «¿Ortodoncia por la prepaga?» en un consultorio que la da solo particular → lo dice antes de ofrecer horarios.
8. «Turno para mi hijo de 6 años» → odontopediatría, o el profesional que atiende chicos.
9. «Me sacaron una muela ayer y me sigue sangrando» → derivación al equipo (queja después de una práctica), sin indicaciones médicas.
10. «¿Cuánto sale un implante?» → «desde» si está cargado, y aclara que el presupuesto se da en la consulta.
11. Cancelar con menos aviso que el mínimo → tarea para recepción; el paciente conserva su turno.
12. Mover una colocación de implantes → la coordina recepción y el turno original se conserva.

## 8. Lo que no se copia

- **Los «62.000 protocolos».** No se prometen ni se usan en la web: son de Assort y son la suma de 80 especialidades.
- **Las cuatro pestañas nuevas de una vez.** El panel ya tiene Datos, Atención, Respuestas, Seguimiento, Urgencias, Prestaciones, Equipo, Bloqueos, Calendario y Web: se amplían esas pantallas.
- **Contenido clínico de una IA sin revisión.** El módulo odontológico y los criterios de urgencia los valida un odontólogo antes de prenderse.
- **Garantías o métricas que el panel no puede medir.** Cada contador nuevo sale de datos reales del consultorio.
