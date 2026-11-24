# Turnia Salud — qué falta (traspaso para la próxima IA)

## Turnia Activa · Campañas: revertido el 24/11/2026

- **Qué se revirtió:** los PRs 1 a 3 (automáticas por clínica, secuencias, pantalla nueva de Campañas: [#255](https://github.com/axellaban/turniasalud/pull/255), [#257](https://github.com/axellaban/turniasalud/pull/257) y [#258](https://github.com/axellaban/turniasalud/pull/258)). Lo pidió el usuario mientras se investiga por qué Sofi dejó de funcionar. El código queda igual que antes del PR 1.
- **Hasta resolverlo:** no se publica nada de campañas.
- **La base de datos:** conserva lo que agregaron esos PRs (columnas `auto_campaigns`, `sequences_enabled`, `external_reminders`, `automatic`, `max_messages`, `stop_on_*`, `messages_sent`, `next_step_at`, `sequence_stopped`; tablas `campaign_steps` y `campaign_messages`). Es todo agregado y el código actual no lo usa.
- **Para volver a publicarlo:** revertir este revert. Todo está en la historia de la rama `claude/intelligent-edison-gi9t6b`. El PR 4 (nueva audiencia y audiencias guardadas) quedó hecho y probado, sin publicar, en el commit `395c409`. El plan completo (PRs 1 a 5) está en esa historia, en `PLAN_CAMPANAS.md`.

## WhatsApp y llamadas del consultorio — 24/11/2026

- La sesión propia de WAHA estaba en FAILED. Reiniciar conservando la autenticación no la recuperó; se renovó la vinculación y quedó WORKING con la cuenta correcta. El usuario confirmó una respuesta real y el mensaje y la respuesta se comprobaron en Turnia.
- No se pudo establecer el motivo original de la desconexión: el contenedor seguía activo con el digest fijado y sus volúmenes; la consulta de logs de Easypanel devolvió 400 y no había configuración de logs disponible. No atribuirlo a créditos, a un despliegue o a una acción del teléfono sin evidencia.
- Cambios de llamadas: nueva herramienta para consultar el resultado verificado de una gestión pendiente antes de despedirse, mención explícita de WhatsApp y revisión humana si ese canal no está operativo. Las fechas se ofrecen desde la última búsqueda, sin mezclar límites de ventanas anteriores.
- La lista de espera admite turno_id para una reserva existente, conserva las restricciones de cirugía/implantes/extracciones/duración/antelación y verifica que un adelanto sea compatible. No habilita nuevas reservas del tipo genérico importado.
- El cron existente controla cada diez minutos el estado real de las líneas propias: guarda transiciones, deja una tarea al caer y avisa a Axel (con el fallback existente de n8n), como máximo una vez por hora por incidente. El control no reinicia ni desvincula líneas.
- La confirmación que falló antes de recuperar la sesión sigue requiriendo revisión contra la agenda; no reenviar mensajes antiguos automáticamente.

## Incidente de créditos y entrega — 19/11/2026

- **Reprogramación y duración en Smile Connect (19/11):** reproducido con un turno ficticio a un año: 14:15–14:45 pasó el chequeo antiguo de celdas de 5 minutos, pero el PATCH devolvió `409 slot_unavailable`; 14:00–14:30 se aplicó y verificó en la agenda nativa. La oferta y la escritura ahora consultan la duración completa y conservan los inicios exactos del proveedor. Si otro turno ocupa el destino después de consultar, se vuelve a leer el original antes de decir que se conserva y pedir otra opción. La causa específica del rechazo histórico no se puede demostrar retrospectivamente: el registro antiguo guardó solo una frase genérica. El cliente ya conserva código, motivo y `request_id`. Validación previa: 704 pruebas en 84 archivos, ESLint y build correctos. El resultado del control posterior al despliegue y la limpieza de la prueba se registra en el cierre del [PR #247](https://github.com/axellaban/turniasalud/pull/247).

- A las 13:29 ElevenLabs agotó los 158.603 créditos del workspace compartido. Los callbacks fallaron por saldo, aunque el proveedor había generado texto y su transcripción lo mostraba. WAHA y la base seguían operativos.
- El usuario cargó 100.000 créditos. Se verificó el saldo y una respuesta real por la línea propia; no se confirmó el cambio de abono que se había preparado. Se cerraron cinco sesiones fallidas para evitar reutilizarlas.
- Se corrigieron cinco historiales afectados contra los mensajes realmente enviados por WAHA, conservando una copia privada previa. La reprogramación que el proveedor rechazó quedó resuelta manualmente por el consultorio: se verificó en Smile Connect, se actualizó Turnia y se cerró la revisión, sin volver a modificar el turno.
- Las transcripciones propias de WhatsApp prevalecen sobre texto generado que no se entregó. El panel muestra el fallo de entrega, las sesiones fallidas se cierran y una caída por saldo genera un aviso a Axel, como máximo uno por clínica y hora.
- Las pruebas de carga usan proveedores simulados y PostgreSQL descartable. Los créditos de las pruebas reales se comparten con las clínicas; no repetir baterías de llamadas en producción sin revisar primero el saldo.

## Días para turnos de Sofi — 19/11/2026

- Guerra–Mininni pidió que Sofi solo dé turnos de lunes a jueves. Los viernes quedan para cirugías y casos grandes de prótesis coordinados por el equipo. La regla también aplica al destino de una reprogramación, con todos los profesionales; no cambia los turnos existentes ni las reglas de cancelación.
- Configuración → Turnos y urgencias → «Días en que Sofi da turnos»: política independiente de los horarios reales. Smile Connect conserva su agenda de viernes y sus sincronizaciones no pisan esta selección. Las otras clínicas mantienen todos los días por defecto; el equipo puede operar los días reservados.
- Las instrucciones de la clínica se actualizaron en producción antes del despliegue de esta validación. La conversación de horarios de las 10:15 fue una prueba nuestra.
- La lista de espera también respeta los días permitidos: cancelar o mover un turno de viernes no ofrece ese lugar automáticamente. Las entradas siguen activas para un día válido.

## Plan Consultorio (19/11/2026)

Hecho: el plan está en su página privada `/pricing/consultorio`, a US$ 99 (ver `ESTADO_Y_PRIORIDADES.md`; el guion de venta, en `PLAN_PROSPECCION.md`). Lo que promete se cumple en el setup de cada consultorio:

- [ ] **Urgencias al celular de la profesional:** cargar su celular como teléfono de derivación y una instrucción del consultorio: «ante dolor fuerte, sangrado o hinchazón que no puede esperar al día siguiente, pasale el celular de la Dra. …». Hoy, sin esa instrucción, Sofi crea una tarea urgente y avisa al equipo. Si se repite en varios consultorios, convertirlo en una opción de «Turnos y urgencias».
- [ ] **Pausa automática** cuando la profesional escribe en el chat: Sofi y ella comparten el mismo WhatsApp. Se configura igual que en Guerra–Mininni (`message.any` en su instancia de WAHA y la opción en Equipo por WhatsApp).
- [ ] **Campañas:** importar su lista de pacientes en el setup (Excel, planilla o exportación de su sistema). Mandar la campaña en tandas chicas, en varios días: es WhatsApp no oficial, desde su número.
- [ ] **Costo real:** después del primer mes del primer consultorio, anotar el costo de IA, transcripción de audios y WAHA. La estimación es de US$ 10 a 18 por mes.

## Control de producción y configuración de Sofi (19/11/2026)

- [x] **Tarea 10 revisada:** modo «Crear, mover y cancelar», tres profesionales vinculados, sincronizaciones automáticas y copia de esta mañana aplicada a Turnia. Un turno ya creado por Sofi se comprobó en Smile Connect, con el mismo horario y profesional. La lista activa «Para revisar en Smile Connect» estaba vacía. El registro conserva un movimiento histórico con rechazo por cupo y la Agenda señala turnos pasados sin vínculo externo; no se modificaron para este control.
- [x] **Herramientas de Sofi actualizadas** desde «Equipo por WhatsApp», para el agente general de WhatsApp y el propio de llamadas.
- [x] **Pausa automática configurada y comprobada técnicamente:** `message,message.any` en la instancia exclusiva de Guerra–Mininni, sesión `WORKING` y opción prendida en Turnia. Se comprobó un evento propio de app simulado y firmado: crea la pausa, el entrante queda ignorado y «Reactivar» la retira. Los mensajes de la API no pausan. Se retiró la pausa del número ficticio; no se mandaron mensajes a pacientes.
- [ ] **Prueba de recepción desde la app de WhatsApp del consultorio:** requiere una sesión del 3765. El usuario confirmó el 19/11 que por ahora solo tiene acceso al 5483. Desde ese chat se comprobaron respuestas reales de Sofi sobre los horarios; la prueba manual desde el consultorio queda pendiente hasta contar con su sesión.
- [ ] **Bloqueos: rechazo real 403 de Smile Connect.** Después del [PR #238](https://github.com/axellaban/turniasalud/pull/238) se ejecutó una única sincronización manual a las 10:16 con la misma clave vigente: turnos y horarios correctos, pero `/events` devuelve 403. El usuario indicó que esa clave ya tenía todos los permisos y pidió conservarla. Revisar con Smile Connect la habilitación de `events:read` para esa clave; no generar otra ni revocarla por iniciativa propia. El arreglo distingue 403 de 404 y permite volver a probar desde «Sincronizar ahora» sin cambiar la clave. Sofi sigue verificando la disponibilidad en vivo.
- [x] **Recepción de un aviso de integración confirmada por Axel el 19/11.** Indicó que recibió un mensaje de «Turnia · Smile Connect» en su WhatsApp personal. No se revisó el contenido ni se envió otro aviso para esta confirmación.

## Feedback de Guerra–Mininni sobre Sofi (18/11/2026)

- Hecho y en producción (PR #223 a #227): primer turno del día, «molestia» no es urgencia (la guardia solo con mucho dolor, sangrado o hinchazón), no prometer días antes de mirar la agenda, datos juntos por WhatsApp, sin reglas internas ni «limpieza», radiografías en un párrafo aparte, y días que Smile Connect no confirmó a tiempo sin darlos por llenos. Prompt actualizado en los dos agentes de ElevenLabs.
- **Falta, en el panel:** [`TAREAS_COMPUTER_USE.md`](TAREAS_COMPUTER_USE.md), tarea 9. Copiar los horarios de Smile Connect (la fuente de verdad) a «Equipo y horarios», corregir el horario de atención y la línea de horarios de las instrucciones.
- Hecho (tarea 9, por computer use): horarios de los tres profesionales iguales a Smile Connect, horario de atención y línea de horarios de las instrucciones.
- **Guerra–Mininni es cliente** (migración `2026-11-18-guerra-mininni-cliente`): su ficha dejó de ser una demo conservada. Ahora Sofi avisa a la lista de espera cuando se libera un turno, la respuesta de recepción a un pedido le llega al paciente y vuelve a escribirle a quien no contestó los horarios. Las campañas salen solo si alguien las manda. El WhatsApp general de Turnia nunca toma una clínica con línea propia (`whatsappClinic`).
- **Smile Connect es la fuente de la verdad** (18/11). El consultorio no entra al panel de Turnia y todo lo que cambia en Smile Connect llega solo:
  - turnos y asistencia, cada 30 minutos;
  - lo que se cargue tarde (hasta 30 días atrás), los turnos de 61 a 120 días y los datos de los pacientes, con la copia diaria;
  - el horario de cada profesional, cada 6 horas;
  - las notas, la prestación y los bloqueos.

  La Agenda ya no pide marcar asistencia. Detalle en [`SMILE_CONNECT_API.md`](SMILE_CONNECT_API.md).

- [ ] Propuesta, sin pedir todavía (el 18/11 Axel dijo «por ahora no»): cuando recepción cancela un turno en Smile Connect, ofrecérselo a la lista de espera de Turnia. Hoy solo se ofrece lo que se cancela por Sofi o por el panel. Es un mensaje nuevo a pacientes en producción.
- **Pacientes en la copia diaria y avisos a Axel** (18/11):
  - los pacientes nuevos se leen todos los días y la lista completa, dos veces por semana, para no comerse el cupo de lecturas;
  - los problemas de la integración le llegan a Axel por WhatsApp.
- [x] Avisos a Axel con la demo pausada (18/11): ya no dependen del selector de la demo pública (`demo.canal = pausado`). Si la línea general de WAHA no responde, van a n8n (`axel.aviso`).
- [ ] **Pedirle a Smile Connect `updated_since`** (lo manda Mininni; texto en `SMILE_CONNECT_API.md` → «Pedido a Smile Connect»). Turnia ya está lista y lo usa sola en cuanto aparezca en el OpenAPI.
- Ideas evaluadas el 18/11, sin pedir:
  - ventana cercana de 4 a 8 días («la semana que viene», casi al mismo costo);
  - copia hasta 180 días (controles semestrales);
  - pedirle a Smile Connect un filtro `updated_since`;
  - precios de Sofi desde Smile Connect.

## Costo de Neon en producción (18/11/2026)

- [ ] **Revisar el consumo de Neon Launch el 25/11.** Se activó el 18/11 para recuperar Turnia después de que se agotó el cupo de Free. En Vercel → Integraciones → Neon → Usage, anotar el gasto real desde el cambio, separando producción de la otra base si el panel lo permite. Con ese dato, decidir si seguimos en Launch o evaluamos un PostgreSQL gratuito administrado (Supabase o Aiven) o en el VPS de Hostinger. Antes de evaluar el VPS, comprobar capacidad, backups externos y restauración.

## Smile Connect por API y avisos por WhatsApp (16/11/2026)

- **Actualizado el 18/11:** la escritura real está activa (`SMILE_CONNECT_WRITES=on`). Por pedido de Axel, el modo pasó a «Crear, mover y cancelar»: Sofi crea, mueve y cancela en Smile Connect, y las visitas combinadas siguen yendo a recepción. Lo de abajo es el estado del 16/11.
- [x] **Control en producción por computer use: tarea 10 de [`TAREAS_COMPUTER_USE.md`](TAREAS_COMPUTER_USE.md).** Revisado el 19/11; los faltantes concretos están al principio de este archivo. Se conserva la clave actual por indicación del usuario.
- **Lectura verificada y «Escritura de prueba» en producción (16/11).** El consultorio cargó la clave y el userscript de Tampermonkey quedó desactivado. Los 39 turnos vigentes de Smile Connect para el 17 y 18 estaban en Turnia. Seis turnos adicionales de Sofi por WhatsApp quedan para conciliar antes de activar la escritura real.
- **Siguiente paso.** Revisar el registro de operaciones de prueba con el consultorio y probar primero la creación de un turno. Ver [`SMILE_CONNECT_API.md`](SMILE_CONNECT_API.md) y la tarea 7 de [`TAREAS_COMPUTER_USE.md`](TAREAS_COMPUTER_USE.md).
- **Avisos por WhatsApp al consultorio:** van en el mismo PR. Falta saber a qué celulares mandarlos (se cargan en Configuración).

## Dominio y canales (14/11/2026)

- **Agenda y conversaciones en producción.** `APP_URL` usa `https://turniasalud.app`. El dominio anterior conserva el 308. La demo ofreció horarios con `consultar_disponibilidad`; una segunda charla se guardó con resumen y transcripción al cerrarla, por el nuevo webhook post-call de ElevenLabs. Google acepta ambos callbacks.
- **Telegram retirado de Turnia.** El selector pasa a pausado si apuntaba a Telegram. Se cierran sus sesiones activas y se conserva el historial. La demo funciona en el navegador y el WhatsApp de cada consultorio conserva su configuración. Las pruebas del producto usan WhatsApp o el navegador.
- **WAHA.** Los webhooks de la línea general y de Guerra–Mininni todavía apuntan al dominio anterior. Estado y alcance en [`TAREAS_COMPUTER_USE.md`](TAREAS_COMPUTER_USE.md).
- **Recuperación histórica.** `POST /api/prospeccion { followup: { op: "conversations-backfill", desde } }` trae las conversaciones de ElevenLabs sin duplicarlas ni disparar tareas y avisos. Chapa Labs lo ejecuta todos los días a las 8:20 para los últimos tres días. La ejecución del 14/11 desde el 05/11 recuperó el registro que faltaba y terminó sin errores.
- El trabajo de configuración restante está en [`TAREAS_COMPUTER_USE.md`](TAREAS_COMPUTER_USE.md).

## Smile Connect: después del QA del 18/11

- [ ] En Guerra–Mininni, mirar «Lecturas de hoy» en Configuración → Agenda e integraciones un par de días. Si pasa de 7.000, la sincronización ya se espacia sola; si sigue cerca, revisar la ventana cercana.
- [x] Pasar a la configuración de cada clínica lo que estaba atado a Guerra–Mininni en el código (18/11): verificación de identidad desde otro número, ficha de salud y días del resumen. Guerra–Mininni no cambia.

## Auditoría del panel: lo que quedó pendiente (18/11/2026)

Las seis fases de la auditoría están hechas (PR #210 a #215) y, después, lo pendiente (PR #216 y #217; ver `ESTADO_Y_PRIORIDADES.md`). Lo que falta es configuración, en la **tarea 8** de [`TAREAS_COMPUTER_USE.md`](TAREAS_COMPUTER_USE.md):

- [x] **«Actualizar a Sofi»** ejecutado el 19/11: herramientas renombradas (`equipo_buscar_pacientes`, `equipo_crear_paciente`) y nuevas (`pausar_chat`, `reactivar_chat`) en WhatsApp y llamadas.
- [x] **Pausa automática en Guerra–Mininni:** `message.any` agregado, opción prendida y circuito comprobado con un evento firmado de prueba el 19/11. La prueba desde la app del consultorio queda identificada arriba.
- [x] Pausa de Sofi por WhatsApp para el equipo (`pausar_chat`, `reactivar_chat`).
- [x] Pausa automática cuando recepción contesta desde el celular: Turnia anota lo que manda y lo distingue de lo que escribe el equipo. Ignora los automáticos de WhatsApp Business. Apagada por defecto.
- [x] Renombrar las herramientas parecidas, con alias de los nombres anteriores.

## Resumen diario de Sofi para Guerra–Mininni (16/11/2026)

El Dr. Mininni pidió **un resumen de Sofi a las 10** y poder **preguntarle a Sofi** por los datos del turno. Así recibe el motivo y la prestación que la API de Smile Connect todavía omite.

- [x] El celular del Dr. Mininni está cargado en «Acceso total por WhatsApp». El envío de prueba salió a los dos celulares configurados el 16/11, con el [PR #200](https://github.com/axellaban/turniasalud/pull/200) en producción.
- [ ] Verificar el primer resumen automático del martes 17/11 a partir de las 10.
- [x] Agentes actualizados por el usuario el 16/11: Sofi ya tiene `detalle_turno` y `turnos_de_sofi`.
- [x] Unificar listas (18/11, [PR #211](https://github.com/axellaban/turniasalud/pull/211)): Configuración → «Equipo por WhatsApp» muestra cada celular una vez con avisos, resumen y acceso total. Por dentro siguen las dos tablas.
- [x] Decir en el resumen si el turno ya quedó escrito en Smile Connect (18/11, [PR #216](https://github.com/axellaban/turniasalud/pull/216)).

## Resultados de Chapa Labs: ejecución de la cola (11/11/2026)

`GET /api/prospeccion?vista=followup` suma, en `results`, lo mismo que habita.: `execution` (la cola día por día y por tipo de acción: pendientes, ejecutadas por persona o bot, exitosas, bloqueadas, sin tomar, no salieron y reprogramadas), `weeklyByType` y `actionLabels`. Lógica en `src/lib/sales/followup-results.ts`; tabla `sales_followup_queue_days` y columna `sales_followup_executions.executed_by` en `supabase/schema.sql` (se aplican solas en el próximo build de producción).

- **Exitosa** en Turnia: la persona avanzó de paso después del envío (su definición de conversión de siempre; Turnia no guarda cuándo, así que no hay ventana).
- **11/11 (revisión):** la cola cuenta también los mensajes que salieron sin «Confirmar envío» (`messageExecutions` en `followup-results.ts`, desde `sales_outreach_events` kind «mensaje»): antes daba 0 ejecutadas. El saludo es exitoso si respondieron después (`sales_whatsapp_chats.last_received_at`); el resto, si avanzó de paso.
- La foto se guarda cuando Chapa pide la cola (como mucho cada 10 minutos). Turnia no tiene cron: un día en que nadie abre Chapa queda solo con lo ejecutado.
- Hoy no hay envíos automáticos: todo cuenta como «humano» hasta que un bot registre `executed_by = 'bot'`.
- Las cohortes con las etapas del panel (Por contactar … Cliente Fundador) se calculan en Chapa con las cuentas que ya manda Turnia; no hizo falta cambiar nada acá.

## Paridad con Commercial OS de Chapa Labs (09/11/2026)

La nueva UI de Chapa Labs se comparte con habita. y Turnia: General, Cola, Respuestas, Embudo por etapas, Prospectos, Reglas y Mensajes, Resultados y Etapas/Situaciones. **Turnia mantiene su cola y su embudo existentes** con confirmación de envío, horarios y secuencia a recepción; no hay cambio en sus datos ni cadencias por este rediseño.

**Pendiente para paridad funcional real (no fingir editor):**
1. Exponer `catalog: { stages, states, overrides, available }` en `GET /api/prospeccion?vista=followup`, adaptado a sus etapas `FOLLOWUP_STAGES`, sin copiar las claves de habita.
2. Persistencia y validación de situaciones custom por etapa, manteniendo estados de baja y clasificación de respuestas automáticas.
3. Reglas editables, orden y condiciones, con equivalentes seguros de `rule-save` y versiones editables `version-update`. No usar la secuencia de habita.: Turnia conserva saludo sin link, Paso 2 permiso, 3 mensajes, límites y horario.
4. Tests con Postgres real y reconciliación con Turnia Panel → Prospección y PostHog antes de habilitar edición en Chapa.
5. Revisar autenticación del operador y las dos líneas WAHA, evitando envíos repetidos en sesiones simultáneas.

El catálogo en Chapa se muestra por ahora en modo lectura para Turnia, con enlace al editor nativo. La paridad visual en Chapa sí está disponible; la paridad de API **todavía no**.


Actualizado: 08/11/2026 (Argentina). El centro comercial (Chapa Labs + Turnia + habita.) y la prospección tienen su traspaso en [`CENTRO_COMERCIAL.md`](CENTRO_COMERCIAL.md). Este archivo junta, en un solo lugar y por prioridad, todo lo que queda. El detalle de cada tema está en los documentos enlazados. No contiene credenciales.

## Antes de empezar

1. Leé [`AGENTS.md`](AGENTS.md): esta versión de Next.js (16.4) cambia APIs. Consultá `node_modules/next/dist/docs/` antes de escribir código.
2. Leé [`ESTADO_Y_PRIORIDADES.md`](ESTADO_Y_PRIORIDADES.md), que tiene el registro de lo hecho y prevalece sobre los documentos más viejos.
3. Ramas: se trabaja en una rama, se abre un PR contra `main`, CI (`verificar`) y Vercel tienen que dar verde, y se hace merge squash. Producción se publica sola desde `main` y cada deploy aplica `supabase/schema.sql` (idempotente) con `scripts/migrate-db.mjs`.
4. Diseño: hay skills en `.claude/skills` (`frontend-design`, `web-design-guidelines`, `react-best-practices`, `impeccable`); ver su `README.md`. Para auditar accesibilidad, axe-core está en `node_modules`.
5. Pruebas locales: `npx tsc --noEmit`, `npx eslint src`, `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx vitest run` (177 tests al 23/10) y `npx next build`. Para mirar la web, `next start` con un Postgres local; Chromium está en `/opt/pw-browsers`.
6. Google Calendar y Google Sheets: cómo están armados y qué falta configurar en `GOOGLE_CALENDAR.md` y `GOOGLE_SHEETS.md` (usan la misma conexión con Google).

## Reglas que no se rompen

- **No contratar planes ni cargar saldo** (Vercel está en Hobby, así que Skew Protection no se activa).
- **Conservar las instancias WAHA anteriores.** El 02/11 el usuario autorizó crear y configurar una nueva, `n8n/turnia-guerra-mininni-waha`, para el piloto de Guerra–Mininni. No modificar `n8n/waha` ni `n8n/turnia-waha`. La nueva copia usa la imagen exacta de las anteriores; no actualizarla al copiar una etiqueta mutable. Estado operativo y pruebas en `ESTADO_Y_PRIORIDADES.md`.
- **HolaVeggie y las líneas existentes de Twilio están operativas:** no modificar sus números, agentes, webhooks ni credenciales. Turnia usa la misma cuenta por decisión expresa del usuario; el saldo es compartido.
- No pegar credenciales en chat, repo ni documentos.
- No regenerar los audios de la web ni cambiar permisos de ElevenLabs sin que el usuario lo pida.
- Gmail de n8n está vencido y el usuario pidió **no** reconectarlo ni reintentar envíos hasta que lo retome.
- No usar material de Assort Health (videos, fotos, textos literales). La web es un copycat de estructura, no de contenido.
- No inventar clientes, testimonios ni métricas.

## 1. Pendiente del usuario (no se puede hacer desde el código)

- [ ] **Google Sheets (prospección y pedidos de demo):** en el proyecto de Google Cloud de Calendar, habilitar **Google Sheets API** y agregar el permiso `drive.file`. Después, Panel → Prospección → Google Sheets → «Conectar con Google». Para que el permiso no venza a los 7 días, publicar la app. Pasos en [`GOOGLE_SHEETS.md`](GOOGLE_SHEETS.md). Con esto ya no hace falta lo de Apps Script. A la planilla «Interesados TurnIA» conviene sacarle la edición pública o borrarla, porque está vacía.

- [ ] **Consultorios con web:** importar `consultorios-con-web-mdp-miramar.csv` (entregado por chat) en Panel → Prospección → Importar lista, con «Reemplazar los datos de los que ya están por los del archivo» marcado. Suma 13 personas y les carga la web y el WhatsApp del consultorio a 12 que ya estaban.
- [ ] **Prospección de la semana (26 al 30/10):** importar `lista-odontologos-mdp-miramar.csv` en Panel → Prospección → Importar lista (el archivo se entregó por chat; no va al repo), poner el perfil de Turnia en su WhatsApp Business y seguir «Para hoy». Plan en [`PLAN_PROSPECCION.md`](PLAN_PROSPECCION.md).
- [ ] **Lista 3 de prospección, Mar del Plata, Miramar y alrededores (02/11):** importar `lista-mdp-miramar-nuevos.csv` (entregado por chat; no va al repo) en Panel → Prospección → Importar lista, sin marcar «Reemplazar». 268 personas que no están en la lista 1 (salen de las cartillas de OSDE y Swiss Medical): 111 con celular y 157 con fijo. Detalle en [`PLAN_PROSPECCION.md`](PLAN_PROSPECCION.md).
- [x] **Lista 4 de prospección, alrededores de Mar del Plata (08/11), importada por el usuario el 08/11 (la base quedó en 967):** se importó `lista-4-alrededores-mdp.csv` (entregado por chat; no va al repo) en Panel → Prospección → Importar lista, sin marcar «Reemplazar». Son 258 personas que no están en la base: 154 con WhatsApp (117 de Tandil, Necochea, la Costa, Pinamar y Villa Gesell, y 37 consultorios de Mar del Plata que faltaban) y 104 fijos. Los que pagan anuncios en Google o en Instagram y Facebook van con prioridad 1 y la marca «Google Ads» o «Meta Ads» en Chapa Labs (cambio en `facundogregorini-lab/chapa-labs`, rama `claude/epic-fermi-pfi5jh`). Detalle en [`PLAN_PROSPECCION.md`](PLAN_PROSPECCION.md) → «Lista 4».
- [ ] **Volver a hablarles a los que pagan anuncios en Mar del Plata y Miramar (08/11)** (la marca en «Señales» ya se importó el 08/11; falta escribirles con el ángulo de anuncios): `recontactar-ads-mdp-miramar.csv` (entregado por chat) tiene 15 (11 con Google Ads, por SerpApi), con su estado y otro canal para los que ya usaron los tres WhatsApp. Para marcarlos en el panel, importar `marcar-ads-en-turnia.csv` con «Reemplazar» marcado (solo cambia «Señales»). Para repetir la búsqueda de anunciantes hace falta una clave de SerpApi propia (la usada era un secreto del entorno de la sesión de IA, no del proyecto); el lunes 9/11 tocaba repetir las búsquedas de Google con anuncios en horario de atención (ver [`CENTRO_COMERCIAL.md`](CENTRO_COMERCIAL.md)). Detalle en [`PLAN_PROSPECCION.md`](PLAN_PROSPECCION.md) → «Volver a hablarles a los que pagan anuncios».
- [ ] **Lista 2 de prospección, otras ciudades (02/11), si se quiere salir de la zona:** `lista-odontologos-2-sin-repetidos.csv` (la versión anterior `lista-odontologos-bahia-laplata-costa.csv` no se importa). 1.247 personas de Tucumán, La Rioja, Bahía Blanca y La Plata, sin repetir con las listas 1 y 3: 518 con celular.

- [ ] **Cierre de la demo con «Escribirle a Axel» (05/11), probarlo en producción:** abrir una demo `/p/<código>` desde el celular (no desde el panel), hablar con Sofi hasta reservar el turno de prueba y comprobar que Sofi dice «Esto fue la demo…», que al terminar aparece la nota de Axel y que el botón abre WhatsApp con el mensaje escrito al +54 9 11 3023-5483. Desde el 07/11 `/p/<código>` es una sola pantalla con la esfera: probarla también en un iPhone (Safari), por voz y por chat. En la ficha tiene que figurar «Tocó «Escribirle a Axel»». Detalle en [`PLAN_PROSPECCION.md`](PLAN_PROSPECCION.md) → «Después de la demo».
- [x] **Audios de seguimiento (06/11):** Turnia envía notas nativas desde el WhatsApp terminado en 0022. Se reutilizó `n8n/waha` con su sesión `default` sin webhooks, y `WAHA_PROSPECCION` quedó en Production. Confirmada la nota de voz del 0022 al 5483. Para «Mandármelo», usar el 5483: la prueba al chat propio del 0022 quedó pendiente.
- [ ] **La secuencia a la recepción (09/11):** probar en vivo desde Chapa («Audios y mensajes»): Paso 1 a uno nuevo; cuando responda, «Leer las respuestas» y el Paso 2; cuando diga que sí, el Paso 3; el Seguimiento 3 tiene que llegar como dos mensajes. Ver `PLAN_PROSPECCION.md` → «Los mensajes».
- [x] **El cierre de la demo `/p/<código>` para la recepción (09/11):** «Reenviárselo a los doctores» (el mensaje para los doctores del Seguimiento 3) y «Escribirle a Axel» por la línea que le escribió (WAHA) o, a mano, el 5483. Falta verlo en vivo al terminar una charla. Ver `PLAN_PROSPECCION.md` → «El cierre para la recepción».
- [ ] **Chapa Labs → Turnia → Odontólogos:** verificar en vivo «Mandar audios», autorizar con la sesión de Turnia, grabar y enviar una prueba al 5483. Se elige un audio por etapa. Para el 0022, seleccionar solo los contactos iniciados desde esa cuenta.

- [ ] **Comparar las dos versiones de la demo personal (08/11), cuando B tenga 15 a 20 visitas:** el 07/11 se sacó el botón «Probar la demo» (A) y quedó una sola pantalla con la esfera (B). El embudo se reconfiguró para compararlas de punta a punta, **visitaron → hablaron con Sofi**, en PostHog (tablero «Turnia · Prospección» → «Demo personal: A contra B»), en `npm run embudo` y en Chapa Labs. Al 08/11: A 10 de 16 (63%), B 1 de 4 (25%), y 3 de los 4 de B no tocaron la esfera. Todavía es poco para decidir. Detalle en [`EMBUDO.md`](EMBUDO.md) → «Las dos versiones de la demo personal».
- [ ] **Lectura diaria de WhatsApp (08/11): falta la línea 5483.** Las respuestas de los prospectos entran solas leyendo una vez por día los chats de las dos líneas de WAHA (solo lectura, no se toca `n8n/waha`). La dispara Chapa Labs a las 8 y su botón «Leer WhatsApp ahora». Primera lectura real, 08/11:
  - **0022: funciona.** 70 personas de la base con chat; 14 contestaron (sin contar respuestas automáticas); 2 esperan respuesta. La primera pasada contó como respuesta las automáticas de WhatsApp Business y la segunda corrigió a 4 que solo tenían eso (turniasalud#151).
  - **5483 (el WhatsApp desde donde sale la prospección): no se pudo leer.** WAHA no devuelve sus chats porque esa sesión usa NOWEB sin historial. Hay que prender el store de esa sesión en WAHA (`config.noweb.store.enabled = true` y `fullSync = true`) y reiniciarla. Es un cambio en WAHA: lo decide el usuario.
  - Detalle en [`CENTRO_COMERCIAL.md`](CENTRO_COMERCIAL.md) → «Lectura diaria de WhatsApp».
- [ ] **Chapa Labs como centro comercial (08/11):** con la base actualizada (el build aplica `supabase/schema.sql`), abrir `/prospecting` en Chapa Labs → «Hoy» con «Todas» y ejecutar una tanda real de 10 por producto: tomar, abrir WhatsApp, confirmar. Comprobar que la otra persona ve «Lo tiene …» y que el contacto aparece en Panel → Prospección. El panel de Chapa sigue abierto sin contraseña por decisión del usuario (08/11): definir el login antes de compartir el link. Detalle en [`PLAN_PROSPECCION.md`](PLAN_PROSPECCION.md) → «La cola, operada desde Chapa Labs».
- [ ] **Embudo semanal** (cada lunes): correr `npm run embudo` con `POSTHOG_PERSONAL_API_KEY` y `DATABASE_URL`, pegar la columna nueva en [`EMBUDO.md`](EMBUDO.md) y completar las cuentas de la semana 1, que quedaron sin dato. Marcar «Cliente» en Prospección solo cuando entra el primer pago.
- [ ] **PostHog (analítica):** una vez publicado, en el proyecto «Turnia Salud» activar Session replay, filtrar el tráfico interno (`is_internal`) y autorizar el dominio; después, armar los tableros y hacer la validación. Pasos en [`ANALITICA.md`](ANALITICA.md) (6, 7 y 8).
- [ ] **Rotar las credenciales** que quedaron expuestas durante el diagnóstico de WAHA (ver la sección «Diagnóstico histórico de vinculación WAHA» en `ESTADO_Y_PRIORIDADES.md`).
- [x] **WAHA vinculado por el usuario**, quien confirmó que funciona. No repetir el diagnóstico ni modificar su conexión. El WhatsApp general se administra en Sistema.
- [ ] Decidir si los avisos al equipo salen por email (requiere reconectar Gmail en n8n) y a quién van los avisos asistenciales.
- [ ] Opcional: un video propio para el hero, si no quiere los clips de stock (ver 4).

## 2. Prueba en vivo

- [ ] **Límites de Sofi (05/11), después del deploy:** actualizar los dos agentes: Sistema → «Crear / actualizar agente», para que Sofi tenga `silenciar_numero`, y Configuración (Guerra–Mininni) → «Crear / actualizar Sofi de esta clínica», para que las llamadas corten a los 8 minutos y tras 20 s de silencio. Probar desde otro teléfono escribiendo como vendedor («Hola, ofrecemos software para consultorios»): Sofi contesta una vez y el número aparece en Conversaciones → Números en pausa; reactivarlo al final. Detalle en `ESTADO_Y_PRIORIDADES.md` → «Límites de Sofi».
- [ ] **Turno completo por llamada en Guerra–Mininni:** el 03/11 se verificó que Sofi atiende las llamadas al número habitual, con el desvío de Movistar al destino interno de Twilio y el agente propio en ElevenLabs. Queda probar una reserva ficticia por llamada, verla en la agenda del consultorio y cancelarla.

- [ ] **Notas de voz en WhatsApp (03/11):** desde otro teléfono, mandarle un **audio** a la línea de Guerra–Mininni y confirmar que Sofi contesta con **nota de voz** que se escucha bien (y, si hay link, también por escrito); escribirle «mandámelo en audio» y confirmar lo mismo; después escribirle texto común y confirmar que vuelve a contestar con texto. Si llega texto en vez de audio, mirar en Vercel el log «No se pudo mandar la nota de voz; se entrega el texto» (voz del agente, Text to Speech o `sendVoice` de WAHA). Cada respuesta en voz consume Text to Speech de ElevenLabs.
- [x] **Línea propia de Guerra–Mininni (02/11), +54 9 11 7243-3765:** `WORKING` y cuenta correcta verificados. El usuario recibió respuestas reales de texto y audio; conversación en la ficha correcta. Con datos ficticios se comprobaron reserva, cancelación por chat con más de 24 horas, derivación a recepción con menos de 24 horas, lectura de una foto descargada de WAHA y documento guardado en la ficha. Pruebas técnicas de reserva/foto dirigidas al propio número de Sofi, con eventos entrantes firmados; falta observar una foto desde otro teléfono. Datos ficticios retirados. PR #84 publicado, 330 pruebas aprobadas. Mantener la sesión operativa; no repetir la vinculación ni pedir la terminal. La ficha del consultorio conserva su carácter de prueba.

- [x] Demo en el navegador probada en producción (24/10): lectura, chat y voz.
- [x] La demo en el navegador entra en una pantalla, en la computadora y en el celular (24/10; detalle en `ESTADO_Y_PRIORIDADES.md`).
- [ ] Que el usuario la pruebe con su propia voz y mire el interesado en Panel → Pedidos de demo (el de prueba es `prueba-claude@turnia.test`, se puede borrar). La demo arranca en voz.

Cuando el usuario elija reactivar WhatsApp desde Panel → Sistema (sin cambiar WAHA):


- [ ] `https://turniasalud.app/api/health` → `demo.whatsapp: true`, `whatsapp_source: "waha"`.
- [ ] **Demo con tu web** (`/probar-demo`), con el WhatsApp del usuario y datos ficticios («Prueba Turnia», DNI 11111111, particular): opciones 1/2/3, chat hasta reservar, `MENU` → audio (¿llega nota de voz?), `MENU` → llamada, `SALIR`. Medir cuánto tarda la lectura de la web con Claude. Checklist completa en `PLAN_LEAD_MAGNET.md` (paso 5 y «A verificar en vivo»).
- [ ] WhatsApp general de la demo: completar memoria y receta. **La línea propia de Guerra–Mininni ya probó texto y audio reales, y reserva, cancelación y derivación en la prueba técnica del 02/11.**
- [ ] **Probar a Sofi (03/11):** con el código del Dr. Mininni, abrir Panel → Probar a Sofi y probar ambos accesos:
  - **WhatsApp:** escanear el QR desde otro celular.
  - **En esta pantalla:** hablarle y escribirle.

  Cancelar los turnos de prueba al terminar.
- [ ] **Seguimiento cuando el paciente no contesta (Guerra–Mininni, 03/11):** confirmar en n8n que el disparador de cada 10 minutos a `/api/automations/calendario` está activo; sin él no sale ningún seguimiento. En Configuración → «Si el paciente no contesta», elegir 1 o 2 veces y las horas de espera. Probar desde otro teléfono con datos ficticios: pedir un turno, no contestar los horarios y esperar el mensaje (de 9 a 20). Contestar y ver que Sofi vuelve a mirar la agenda antes de reservar. Cancelar al final.
- [ ] **«Consulta de implantes» (Guerra–Mininni, 03/11):** después del deploy, actualizar los dos agentes (Sistema → «Crear / actualizar agente» y Configuración → «Crear / actualizar Sofi de esta clínica»). Revisar que haya una prestación de consulta de 30 minutos, sin «Solo la da el consultorio». Después, por WhatsApp y con datos ficticios, pedir «un turno para una consulta de implantes». Sofi tiene que ofrecer horarios y confirmar «Consulta de implantes», y el turno tiene que figurar así en la Agenda. Cancelarlo al final.
- [ ] **Control y limpieza en la misma visita (Guerra–Mininni):** el 03/11 se actualizaron el agente de WhatsApp y el de llamadas y se habilitó «Mantenimiento periodontal (limpieza)» de 45 minutos. Falta la prueba de punta a punta por WhatsApp con datos ficticios. Verificar una visita con la Dra. Coldeira, con las dos prestaciones consecutivas en agenda, y cancelar al final. Revisar con recepción dos turnos previos anunciados como limpieza que figuran como «Control», antes de ajustar prestación o duración.
- [ ] **Fotos por WhatsApp:** en Guerra–Mininni ya se probó descarga de WAHA, lectura de una credencial ficticia, respuesta y foto guardada en la ficha (02/11; evento entrante técnico y entrega al propio número). Completar desde otro teléfono y con los tipos orden/receta.
- [ ] Una conversación hablada completa con una persona (la llamada web solo se probó hasta el saludo).
- [ ] Anotar los resultados en `ESTADO_Y_PRIORIDADES.md` y `PLAN_LEAD_MAGNET.md`.

## 3. Panel (estado: completo y auditado)

Está en producción y probado con un recorrido de 31 comprobaciones: roles administrador/consultorio, códigos por clínica, guardado con avisos, borradores locales, historial de cambios y redirecciones de direcciones mal escritas. Lo que falta:

- [ ] El consultorio Guerra–Mininni (cliente desde el 18/11) tiene que entrar con su código y cargar sus reglas reales. El código lo crea el administrador en Panel → Configuración → «Acceso del consultorio» y se manda por WhatsApp desde ahí.
- [x] **Google Calendar** (24/10): credenciales en Vercel, reintentos en n8n y conexión probada en vivo por el usuario (demo «Marcos», el turno apareció en su calendario). Para clínicas reales falta publicar la app y pasar la verificación de Google. Ver [`GOOGLE_CALENDAR.md`](GOOGLE_CALENDAR.md).
- [ ] **Avisar al paciente cuando la clínica cancela o mueve un turno.** Hoy el panel avisa que hay que hacerlo a mano. Se puede mandar por WhatsApp cuando el canal esté conectado. Desde el 4/11, si el profesional mueve o borra el turno en su Google Calendar, el equipo recibe una tarea.
- [x] **Familias con un mismo celular** (02/11): cada persona tiene su ficha aunque compartan el celular. El agente sabe quiénes comparten el número, pregunta para quién es y pasa a la ficha del familiar con `buscar_paciente` (DNI y nombre); `registrar_paciente` con otro DNI y otro nombre crea la ficha del familiar en lugar de pisar la del dueño. El turno a mano pregunta para quién es. Detalle en `ESTADO_Y_PRIORIDADES.md`.
- [ ] **Validar la actualización de la agenda de Smile Connect en Guerra–Mininni:** el histórico ya está cargado. Al revisar el 03/11, `Panel → Configuración → Calendario → Smile Connect` mostraba sincronización activa con última actualización el 02/11 a las 21:22 (Argentina). Verificar el userscript en la computadora de recepción y comprobar que un cambio de agenda de prueba en Smile Connect se refleje en la disponibilidad que ofrece Sofi.
- [ ] **Importar la ficha completa de Guerra–Mininni** (si se prefiere revisar a mano los celulares compartidos desde el CSV de 859 filas en vez del ZIP de Smile Connect): Panel → Pacientes → Importar, con el consultorio Guerra–Mininni elegido. Código de área 11 (sugerido). Revisar en la vista previa los celulares que aparecen en más de una fila: hay casos dudosos (por ejemplo, un nombre que está contenido en otro con otro DNI, o dos apellidos parecidos sin DNI) que conviene confirmar con el consultorio. Resultado esperado: 859 filas → unas 841 fichas, 338 visitas, 23 celulares compartidos por familias y 12 fichas sin celular. Se puede deshacer.
- [ ] Probar en vivo con un celular compartido: que Sofi pregunte para quién es y pase a la ficha del familiar con su DNI.
- [x] **Fichas repetidas del consultorio Guerra–Mininni unificadas** (27/10): Mariano Mininni (5 → 1) y Juan Carlos Montes (2 → 1). Las fichas de prueba se borran desde Panel → Pacientes (casillas y «Borrar N fichas», solo el administrador).
- [ ] **Consultorios / sillones** (pedido del Dr. Mininni, 28/10; respondió el 29/10): consultorio 1, Mariano de lunes a jueves de 11 a 17; consultorio 2, Emilia de lunes a miércoles de 10 a 18 y los jueves Lara con tres turnos de endodoncia (11, 13 y 15). Nadie comparte sillón a la misma hora, así que **no hace falta el sillón como recurso**: alcanza con cargar esos horarios en Equipo y horarios (Lara con tres horarios de la duración de la endodoncia y la especialidad de esa prestación). Desde el 4/11 se puede marcar qué prestaciones hace cada profesional y horarios solo para algunas prestaciones: Lara puede hacer solo endodoncia, sin cambiarle la especialidad. El **turno con dos profesionales** (cirugía de Mariano con Emilia) ya está: «También atiende» en el turno a mano (30/10). Falta que el consultorio cargue los horarios y que el evento de Google Calendar vaya también al calendario del segundo profesional.
- [ ] **v2: recetas con RCTA** (pedido del Dr. Mininni, 28/10): que el agente pueda mandar recetas (por ejemplo, de radiografías) por la aplicación RCTA. Hoy las recetas son una tarea para el equipo.
- [x] **Sobreturnos importados desde el consultorio (Smile Connect)** (02/11): la base permite guardar sobreturnos reales importados/sincronizados desde Smile Connect y la grilla de Agenda los dibuja en paralelo; Sofi y la reserva normal siguen sin poder superponer turnos (`insertAppointment` con locks por profesional). Si más adelante se quiere un botón explícito para cargar sobreturnos a mano desde el panel de Turnia, queda como ampliación opcional.
- [x] **Aviso cuando Google pide reconectar** (18/11): la primera vez que Google rechaza el permiso (vencido o revocado), además del aviso del panel, le llega a Axel un WhatsApp desde la línea de Turnia con el nombre de la clínica y el enlace a Configuración → Calendario. Uno por caída, no uno por intento. Si se quiere que también le llegue al equipo del consultorio, sumarlo como un tipo de aviso más en «Equipo por WhatsApp» (decisión del usuario: en Guerra–Mininni sería un mensaje nuevo a su equipo).
- [ ] Mejoras posibles: roles por persona dentro de la clínica, admisión digital y cobranzas. Son ampliaciones, no arreglos.
- [x] **Campañas para activar la base** (25/10): oportunidades con valor, controles por prestación y por paciente, reglas de contacto, lista que se revisa, envío desde el WhatsApp de la clínica o con Sofi, e importación de pacientes desde Excel o CSV. Ver [`PLAN_CAMPANAS.md`](PLAN_CAMPANAS.md).
- [ ] Que el usuario pruebe Campañas con la planilla real de Guerra–Mininni (ya se puede importar completa) y el envío desde su WhatsApp. Antes conviene cargar en Configuración → Prestaciones las que tienen control periódico: las prestaciones de esa planilla son texto libre («control», «instalar corona», «Control de Exodoncia»…) y solo cuentan para inactivos hasta que coincidan con una prestación de la clínica. Siguientes pasos de campañas (secuencias, respuestas marcadas a mano, automáticas por clínica, segmentos por edad) en `PLAN_CAMPANAS.md`.

- [x] **Follow-up, traído de habita. (07/11):** Panel → Follow-up, una next best action por etapa del embudo de `EMBUDO.md` con versiones (activa y a prueba 50/50), quienes esperan en cada etapa, «Ejecutar» y, por versión, ejecuciones, conversiones y tasa. Detalle en [`PLAN_PROSPECCION.md`](PLAN_PROSPECCION.md) → «Panel → Follow-up». Falta probarlo en producción con un envío real.

## 4. Web pública (estado: home terminada)

- [x] Hero con video de fondo (cuatro clips de Mixkit con licencia libre, en `public/videos/`) y mensajes del agente sincronizados con cada persona.
- [x] «Escuchá a Sofi en acción» en una pantalla: recepcionista a la izquierda, paciente a la derecha, texto al ritmo del audio real.
- [ ] Si el usuario trae un video propio: reemplazar `public/videos/hero.mp4`, `hero.webm`, `hero-mobile.mp4` y `hero-poster.jpg`, y ajustar los tiempos de `ESCENAS` en `src/components/site/agente-en-vivo.tsx`. Cómo se armó el actual (ffmpeg, clips de 8 s, fundido de 0,6 s): [`PLAN_WEB_ASSORT.md`](PLAN_WEB_ASSORT.md).
- [ ] Contenido real: casos, precios y (cuando haya) testimonios. Hoy no se inventa nada.
- [x] **Skills de diseño** instaladas en `.claude/skills` y auditoría de accesibilidad hecha (24/10): de 512 problemas a 6 decorativos. Detalle en `ESTADO_Y_PRIORIDADES.md`.
- [x] Crítica de diseño de la home y `/probar-demo` hecha y aplicada (24/10). Queda a criterio: los titulares en dos colores se repiten en casi todas las secciones (es el estilo de Assort; no se tocó).

## 5. Producto y legal (antes de usar pacientes reales)

- [ ] Cargar datos y protocolos reales de la primera clínica (no reemplazar por suposición).
- [x] **Protocolos odontológicos y reglas en el panel** (4/11). Incluye Coberturas, Turnos y urgencias, campos nuevos de Prestaciones y de Equipo, plantilla odontológica, Inicio y cambios en Google. Las reglas de Guerra–Mininni pasaron a su ficha. Ver [`PLAN_PROTOCOLOS.md`](PLAN_PROTOCOLOS.md).
- [ ] **Acceso total por WhatsApp del Dr. Mininni** (después del merge): en el panel, elegir la clínica Guerra–Mininni → Configuración → Consultorio → «Acceso total por WhatsApp» → De quién es: «Dr. Mininni», Celular: el que pasó el usuario el 5/11 → «Dar acceso». Después, Sistema → «Crear / actualizar agente», para que Sofi tenga las herramientas nuevas. El número no va al repositorio (es público).
- [ ] **Repasar el módulo odontológico con Mininni.** Ya está prendido en todos los consultorios odontológicos por decisión del usuario; el texto está en Turnos y urgencias, solo Turnia. Probar los 12 casos de «Probar a Sofi» y anotar lo que haya que ajustar.
- [ ] Opcional: «Actualizar agente» en cada clínica para que Sofi pueda mandar `cobertura` en `consultar_disponibilidad`. Sin eso, todo lo demás ya funciona.
- [ ] Revisar consentimiento, conservación de datos y textos de privacidad. No activar Zero Retention de ElevenLabs a ciegas: es incompatible con el Custom Channel (ver `PLAN_WHATSAPP.md`).
- [ ] Activar campañas (workflow n8n `g0H8xbQvRNv5FxQj`, hoy desactivado) solo después de validar canal, destinatarios y baja.
- [x] **Twilio saliente configurado** (24/10): línea propia verificada, importada en ElevenLabs y `ELEVENLABS_PHONE_NUMBER_ID` guardada en Production; despliegue Ready, salud con `llamada_telefonica: true`. La conexión final usa credenciales de la cuenta existente por elección del usuario; no una subcuenta. Detalle y alcance en `ESTADO_Y_PRIORIDADES.md`.
- [x] **Conversación telefónica real validada por el usuario** (24/10): Sofi habló y escuchó por Twilio, registro de 21 mensajes y cierre por el destinatario. ElevenLabs: 2:11 y 1.464 créditos totales; Twilio: 2:12 y US$1,0584. Cinco intentos autorizados en total; los errores manuales de variables quedaron corregidos y documentados. No reintentar lotes ni llamar de nuevo sin pedido explícito.
- [x] **Identificación de llamada confirmada por el usuario:** en el celular receptor apareció la línea de Turnia.
- [x] **Grabación nativa en Twilio solicitada** (25/10): `call_recording_enabled: true` en llamadas salientes comerciales y clínicas iniciadas por Turnia. Sin grabación global ni cambios de otras líneas; accesos a Recording Logs en el panel.
- [ ] **Ver el primer audio grabado real en Twilio** tras una llamada nueva autorizada y con saldo. Los audios viejos no grabados no se reconstruyen. La prueba de código pasó; no se hizo una llamada paga para comprobar el artefacto.
- [x] **Editor de Sofi comercial**: `/panel/comercial/configuracion`, saludo/system prompt/voz, aplicación comprobada, versiones y restauración. Fichas con bloqueo concreto y enlace para resolverlo. Guardar pausa y no llama. 232 pruebas; detalle en `COMERCIAL_AGUSTIN.md`.
- [x] **Saldo de Twilio**: el usuario confirmó el 27/10 que hay saldo (la suspensión del 24/10 quedó atrás). El panel no detecta el saldo automáticamente.
- [x] **Sofi comercial, voz y pitch**: pedido posterior del usuario de usar la voz real de la recepcionista, con agente separado y mismo ID. Panel explica pruebas al mismo número y alta de uno nuevo. No se llamó nuevamente; piloto pausado. Falta validar por teléfono el pitch nuevo y las herramientas cuando haya saldo y autorización. Ver [`COMERCIAL_AGUSTIN.md`](COMERCIAL_AGUSTIN.md).
- [x] **Agente comercial Agustín/Mauricio probado**: el usuario autorizó **US$5/día** y una única llamada propia, ya atendida y con voz confirmada. 65 s reales (configuración de 60 s más cierre), Twilio US$0,7056 y ElevenLabs 452 créditos. El panel conserva cupo US$5 y reserva US$1, pero quedó **pausado por saldo Twilio US$0,21916**, insuficiente para otro minuto al móvil. No recargar ni tocar otros negocios. Falta saldo disponible, destinatarios revisados y prueba real de herramientas de interés/baja/end_call antes de prospectar. Estado e IDs en [`COMERCIAL_AGUSTIN.md`](COMERCIAL_AGUSTIN.md).
- [x] **Atención humana por chat** (17 y 18/11): «Pausar a Sofi» (1 hora a 3 días) y «Reactivar» en cada conversación, `pausar_chat` y `reactivar_chat` por WhatsApp para el equipo, la pausa automática cuando el equipo contesta desde el celular y, desde el 18/11, el descarte de la respuesta que Sofi estaba escribiendo cuando el equipo tomó el chat (no se manda ni queda en la charla). Sin Chatwoot.
- [ ] **Piloto de prospección telefónica**: destinatarios revisados, reglas de contacto/No Llame, baja persistente y probada, autorización manual, límite efectivo de duración/consumo y resultados. Validar que el agente pueda colgar y no afirme registrar una baja sin haberlo hecho. No reutilizar el destino de la prueba que pidió no recibir más llamadas. No activar llamadas en frío ni campañas automáticamente.

- [x] **Ficha de salud de Guerra–Mininni por chat** (04/11): hecha con la hoja en blanco que pasó el usuario. Detalle en `ESTADO_Y_PRIORIDADES.md`.
  - [x] Agentes actualizados por el usuario después del deploy (04/11): Sistema y Configuración.
  - [ ] Probar por WhatsApp con datos ficticios: paciente nuevo, reservar una consulta, recibir la plantilla en un mensaje aparte, devolverla completa y ver la ficha en Pacientes y en «Imprimir para firmar». Cancelar el turno y borrar la ficha de prueba.
  - [ ] Acordar con Mariano: ¿a los pacientes que ya venían (tienen la ficha de papel) se les ofrece una vez? Hoy no. Y si la actualización anual le sirve.
  - [ ] Más adelante: pasar las respuestas a Smile Connect, si tiene una vía soportada.

## 6. Técnico menor

- [x] **Las cuentas aparecen en `/api/metricas`** (18/11): una clínica cuenta como real si no es de una demo o si tiene un código de «Acceso del consultorio» sin revocar, la misma definición de cuenta que `scripts/embudo.mjs`. Cambian `uso` (clínicas, clínicas activas, turnos, conversaciones) y `sofi` (clínicas contra demos) en el tablero de Chapa Labs.
- [ ] `npm audit` (revisado el 18/11): 0 en producción (`--omit=dev`). En desarrollo marca 17 (11 altas) en la cadena de ESLint y de Vitest/Vite; todas se arreglan solo bajando `eslint-config-next` a 14 o `vitest` a 3, y `npm audit fix` sin `--force` no puede aplicarse. No afecta al servidor publicado. Revisar cuando salga una corrección compatible.
- [x] El reproductor de demos ya no genera el 404 de `/audios/<slug>.json` en la consola (24/10).

## Dónde está cada cosa

| Tema | Archivo |
| --- | --- |
| Registro de lo hecho y pruebas en producción | `ESTADO_Y_PRIORIDADES.md` |
| Vercel, Neon, ElevenLabs, n8n | `TRASPASO_CONFIGURACION.md` |
| WhatsApp (WAHA + Custom Channel) | `PLAN_WHATSAPP.md` |
| Web pública copycat de Assort | `PLAN_WEB_ASSORT.md` |
| Demo «Probá con tu web» | `PLAN_LEAD_MAGNET.md` |
| Campañas, importación de pacientes y CRM | `PLAN_CAMPANAS.md` |
| Google Calendar | `GOOGLE_CALENDAR.md` |
| Google Sheets | `GOOGLE_SHEETS.md` |
| Protocolos odontológicos, base común y reglas del panel | `PLAN_PROTOCOLOS.md` |
| Qué es Turnia, decisiones y arquitectura | `CONTEXTO_PROYECTO.md` |
