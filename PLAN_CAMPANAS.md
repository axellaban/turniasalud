# Turnia Activa — campañas para activar la base de pacientes

Actualizado: 24/11/2026. Qué es Panel → Campañas, qué se decidió sobre el CRM, qué quedó hecho en la versión 1 y qué sigue. No contiene credenciales.

## Referencia: Activate de Assort

- Assort lanzó **Activate** (su producto saliente) en mayo de 2026, como segunda línea junto a la atención entrante. Cubre controles y prevención (care gaps), reactivación de inactivos, ausentes y cancelaciones con relleno desde la lista de espera, derivaciones pendientes y cobranzas.
- **No usa un CRM aparte:** la fuente es el sistema clínico de cada consultorio (EHR/PM), con integraciones que detectan los eventos y escriben el resultado de vuelta. Arranca por llamada y sigue por SMS y email, con varios contactos por paciente.
- No hay datos públicos de cuánto factura cada producto. Lo que publican son casos de clientes autorreportados. **No usar esas cifras como propias** (regla del proyecto: no inventar métricas).

## Decisión: ¿CRM?

- **No se integra un CRM de ventas** (HubSpot, Salesforce). Para la clínica, el «CRM» es Turnia: la ficha del paciente (memoria, baja, próximo control), su historial, las campañas y las conversaciones.
- La base de pacientes entra por tres caminos:
  1. La agenda de Turnia: los turnos atendidos.
  2. **Importación desde Excel o CSV** (versión 1): lo que exporta el sistema que la clínica ya usa, o su planilla.
  3. Más adelante, conectores con los sistemas de gestión locales (Dentalink, Medilink, AgendaPro, Doctoralia u otros; falta investigar sus APIs). Leen pacientes y turnos y devuelven el resultado. Es el equivalente a las integraciones con EHR de Assort, y la ventaja difícil de copiar.
- El seguimiento comercial de Turnia (pedidos de demo, Comercial) es otra cosa y ya existe en el panel.

## Versión 1 (hecha el 25/10/2026)

**Panel → Campañas**

- Arriba, «Tu base para volver a agendar»: pacientes únicos con algo pendiente y el valor estimado según los precios de referencia de cada prestación. Al lado, el tamaño de la base y la invitación a importar.
- Oportunidades para volver a agendar, cada una con su cantidad, su valor y el botón «Revisar y enviar»:
  - controles vencidos;
  - pacientes inactivos;
  - faltaron y no volvieron;
  - lista de espera.
- «Del día a día»: recordatorios de mañana y encuesta post-consulta.
- «Controles periódicos»: cada prestación con su frecuencia (mensual, trimestral, semestral, anual…). Se guarda al elegirla y muestra cuántos pacientes tienen el control vencido.
- «Reglas de contacto»: a partir de cuántos meses sin venir un paciente cuenta como inactivo (12 por defecto). También el tope de mensajes por paciente entre campañas de controles, inactivos y ausentes (uno por mes por defecto; recordatorios y lista de espera no cuentan).
- Historial de campañas con su embudo: enviados, respondieron, sacaron turno y valor.
- «Aviso a todos» para novedades (vacaciones, cambio de horario).

**Una campaña** (`/panel/campanas/[id]`)

- La lista queda guardada al crearla. Se puede quitar a alguien, volver a sumarlo o actualizar la lista (suma a quien ahora cumple y saca a quien ya no).
- **Desde tu WhatsApp:** «Abrir chat» abre WhatsApp Web (o la app en el celular) con el mensaje escrito y el paciente queda marcado como enviado. El botón grande va al siguiente de la lista. Sin integraciones, desde el número que el paciente ya conoce.
- **Con Sofi, automático:** de a 50, con pausas, por Meta o WAHA. Requiere WhatsApp conectado a Sofi (hoy pausado). Antes de cada envío se vuelve a comprobar que el paciente siga cumpliendo.
- Mensaje editable con `{nombre}` y `{detalle}`, lo que tiene que lograr Sofi si responde y una vista previa del mensaje como burbuja de WhatsApp. Por el WhatsApp oficial se sigue usando el template aprobado.
- Resultados: un turno sacado después del mensaje cuenta para la campaña, se haya sacado con Sofi, en el panel o por teléfono, con su valor de referencia y si el paciente vino.

**Pacientes**

- Importación (`/panel/pacientes/importar`):
  - Se pegan celdas de Excel o Google Sheets, o se sube un CSV (UTF-8 o Windows-1252).
  - Las columnas se reconocen por su título y se pueden corregir. Hay vista previa y una lista de las filas con problemas.
  - Sirve con una fila por paciente o una fila por visita.
  - **Todo lo de la ficha del sistema anterior** (02/11/2026, probado con la exportación completa de Smile Connect de Guerra–Mininni): nombre, celular, DNI, mail, nacimiento, **sexo**, **dirección**, cobertura, plan, afiliado, visitas con prestación y profesional, próximo control y notas. La edad no se importa porque sale de la fecha de nacimiento (la ficha la muestra). Lo que no tiene un lugar propio queda en las notas de la ficha: un mail mal escrito, el celular que no sirve, otro nombre con el que figura, otro mail, o el profesional y la prestación de una fila sin fecha.
  - **Familias:** varias personas con el mismo celular quedan en fichas aparte (otro DNI, otra fecha de nacimiento u otro sexo, o nombres distintos). La misma persona escrita de dos maneras («Ricci» / «Riccis», «Enrique» / «Henrique», un error de tipeo) se junta en una ficha. La vista previa lista los celulares que aparecen en más de una fila y deja corregirlo fila por fila.
  - **Sin celular que sirva:** la ficha entra igual (sin celular, con el número de la planilla en las notas). En campañas figura como «No tiene un celular que sirva para WhatsApp».
  - **Código de área:** los números locales («4555-0123», «15 4555-0123») se completan con el código que se elige (sugerido 11 cuando casi toda la planilla es del AMBA). Un `+` con otro código de país (+1, +598) se respeta.
  - Une cada prestación con las de la clínica. Las fichas que ya existían (mismo DNI; o mismo celular y nombre; o, sin celular, mismo nombre) solo completan los datos que les faltan. Reimportar el mismo archivo no duplica fichas ni visitas.
  - Pide confirmar que se puede escribir a esos pacientes y se puede deshacer.
  - Hay una planilla de ejemplo en `public/plantilla-pacientes.csv`.
- En la ficha del paciente: «Próximo control» (fecha y motivo), indicado por el profesional, y las visitas importadas.

**Código**

- Audiencias, oportunidades, lista guardada, envíos y resultados: `src/lib/campaigns.ts`.
- Lectura de planillas, compartida entre navegador y servidor: `src/lib/patient-import.ts`.
- Acciones: `src/app/panel/campaign-actions.ts`.
- Tablas nuevas: `patient_imports` y `patient_visits`. Columnas nuevas:
  - `patients.next_control_at`, `next_control_reason` e `import_id`;
  - `clinics.reactivation_months` y `contact_cooldown_days`;
  - `campaigns.message`;
  - `campaign_recipients.detail`, `context`, `value`, `manual` y `created_at`, más el estado `excluido`.
- Pruebas: `src/lib/patient-import.test.ts` y `src/test/campaigns.integration.test.ts`; familias en `src/test/patients.integration.test.ts`.

**Perfiles de demo:** se puede importar y armar campañas para mostrar la lista y el mensaje. Sofi no envía nada. Abrir el chat desde el panel sí funciona, porque lo manda una persona desde su WhatsApp.

## Versión 2: Turnia Activa (desde el 24/11/2026)

El rediseño está en el artefacto de diseño «Turnia Activa · Campañas» (tres pantallas) y se hace en cinco PRs. El avance de cada uno está en `PENDIENTES.md`. Ideas tomadas de cómo trabaja DentiPilot, sin copiar su material: recuperar pacientes por señales, seguimiento automático a quien no responde, un piloto chico antes de escalar y resultados en 4 etapas.

**PR 1 (hecho): arreglos de fondo**

- **Automáticas por clínica, apagadas por defecto.** `clinics.auto_campaigns` lista los tipos que corren solos en esa clínica: recordatorios, ausentes, encuesta, controles e inactivos. La lista de espera no está: avisa sola cuando se libera un turno.
  - Las prende o apaga el administrador en Panel → Campañas → Automáticas, con una confirmación al prender. El consultorio ve si están prendidas o apagadas.
  - `POST /api/automations/<job>` corre en cada clínica real que la tiene prendida. Con `{ clinic_id }` corre solo en esa, y solo si está prendida. Responde `clinicas: [...]` con lo que pasó en cada una (enviada, salteada y por qué, o error).
- **El tope de 50 no deja a nadie afuera.** Antes, cada corrida creaba una campaña nueva: los que quedaban después del 50 se perdían, porque la audiencia vuelve a ordenarse con los más recientes primero. Ahora la automática retoma su campaña abierta (`campaigns.automatic = true`, estado `enviando`). Suma a los nuevos al final y les escribe primero a los que esperaban. Los borradores del equipo nunca los toma una automática, y «Revisar y enviar» nunca abre una automática.
- **Ventana de atribución de 14 días** (`ATTRIBUTION_DAYS` en `src/lib/types.ts`). Un turno cuenta para la campaña si se sacó dentro de los 14 días del mensaje; antes contaba cualquier turno posterior, sin límite. Vale para los resultados y para marcar «agendó» cuando el paciente responde.

**PR 2 (hecho): secuencias**

- **Pasos:** `campaign_steps` guarda los pasos de cada campaña, del 2 en adelante; el 1 es el mensaje de la campaña. Controles, inactivos y ausentes nacen con el seguimiento sugerido: a los 5 días, con un máximo de 2 mensajes por paciente (`campaigns.max_messages`).
- **Por paciente:** se guarda `messages_sent`, `last_message_at`, `next_step_at` (cuándo toca el próximo) y `sequence_stopped` (por qué se cortó).
- **Cuándo corren:** en la tarea de cada 10 minutos (`runSequences` en `src/lib/campaign-sequences.ts`), solo en las clínicas con `sequences_enabled`. Se prende en Panel → Campañas → Automáticas → «Seguimiento a quien no responde», solo el administrador. Mandan hasta 10 por corrida.
- **Se cortan si el paciente:**
  - responde (estado «respondió» o «agendó», o un mensaje suyo en el chat);
  - saca turno por cualquier canal (Sofi, panel, teléfono o Smile Connect);
  - pide la baja;
  - o ya recibió el máximo de mensajes.
  - Lo enviado a mano desde el WhatsApp de la clínica no tiene seguimiento de Sofi.
- **Pasos vencidos:** un paso que venció hace más de 4 días (por ejemplo, con las secuencias apagadas) se cierra sin mandarse.
- **Solo por WAHA:** por el WhatsApp oficial un seguimiento necesita un template aprobado.
- **Límites de la línea** (`src/lib/campaign-limits.ts`):
  - Horario de envío: de lunes a viernes, de 9 a 20, para lo que sale solo (las secuencias y las automáticas de controles, inactivos y ausentes). Los recordatorios y la encuesta no lo respetan porque son del turno.
  - Tope de 60 mensajes de campaña por día y por línea WAHA, contando lo que manda Sofi y lo que el equipo marca como enviado a mano. Cada mensaje queda en `campaign_messages`.
  - «Enviar con Sofi» se frena en el tope y avisa que se sigue mañana.
- **La llamada de Sofi como paso:** queda a futuro, porque requiere autorización.

**PR 4 (hecho): nueva audiencia**

- **Pantalla:** `/panel/campanas/audiencia` (`audience-builder.tsx`). Las reglas están en `src/lib/audience-rules.ts`, compartidas entre el navegador y el servidor y validadas con zod. `describeRules` arma la frase, por ejemplo: «Pacientes que no vienen hace más de 9 meses, se atendieron de ortodoncia, con cualquier profesional».
- **Filtros, solo con datos que Turnia tiene:**
  - meses sin venir: última visita en la agenda (incluido Smile Connect) o en las visitas importadas;
  - prestación;
  - profesional: el de la agenda o el nombre en la visita importada;
  - cobertura;
  - edad;
  - cumpleaños este mes;
  - faltó a un turno en el último año;
  - control indicado por el profesional que ya llegó.
- **Presupuestos sin iniciar:** deshabilitado hasta que haya de dónde leerlos.
- **Vista previa en vivo:** `previewAudienceAction` muestra la cantidad, el valor, el desglose de quiénes quedan afuera y por qué (`audienceBreakdown` con las reglas) y tres nombres.
- **Audiencias guardadas:** `saved_audiences` (`src/lib/saved-audiences.ts`). En Campañas aparecen como tarjetas, con la cantidad y el valor de hoy, «Crear campaña +» y «Editar», más la tarjeta «Nueva audiencia». «+ Nueva campaña» lleva al constructor.
- **Campañas de audiencia propia:** `type = 'audiencia'`, con `audience_id` y `audience_rules` (las reglas al crearla).
  - Cuentan como campaña para volver: respetan el tope entre campañas y a quien ya tiene turno, y traen el seguimiento sugerido.
  - Traen un mensaje sugerido que nombra la prestación si la regla la tiene.

## Qué sigue (lo anterior a Turnia Activa)

1. **Secuencias:** si no responde en unos días, un segundo mensaje y después una llamada de Sofi. Twilio ya está configurado; las llamadas se hacen solo con autorización.
2. **Respuestas de lo enviado a mano:** marcar «Respondió», «No le interesa» o «Pidió la baja» desde la lista, porque esas respuestas llegan al WhatsApp de la clínica y no a Sofi.
3. ~~Automáticas por clínica~~: hecho en el PR 1 de Turnia Activa. El workflow de n8n sigue desactivado.
4. **Segmentos preventivos por edad y sexo** (mamografía anual, antigripal, chequeo por edad). El sexo y la fecha de nacimiento ya están en la ficha (02/11/2026); falta armar los segmentos.
5. **Órdenes y derivaciones pendientes:** las tareas `orden_medica` sin turno, como campaña.
6. Ventanas horarias de envío y prueba A/B del mensaje.
7. Versión 3: conectores con sistemas de gestión y cobranzas (saldos con link de pago).

## Riesgos y reglas

- **Envíos masivos por WAHA:** es WhatsApp no oficial, con riesgo de bloqueo del número. Hay tope por paciente, tandas de 50 y pausas al azar. Para escalar conviene el WhatsApp oficial de Meta, con templates de marketing que se pagan por mensaje.
- **No automatizar WhatsApp Web** (computer use, extensiones, bots): va contra los términos de WhatsApp y es frágil. El envío asistido, con un toque por paciente, sí.
- **Antes de pacientes reales:** revisar el consentimiento y la Ley 25.326 con un abogado. Las campañas automáticas siguen desactivadas (workflow de n8n `g0H8xbQvRNv5FxQj`).
