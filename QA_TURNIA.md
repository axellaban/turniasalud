# QA de Turnia

Registro del QA de producción de turniasalud.app, igual que el de habita. (`docs/qa-habita.md` en amoblaia). El procedimiento completo está en [`.claude/skills/qa-turnia/SKILL.md`](.claude/skills/qa-turnia/SKILL.md).

## Reglas principales

- **Plata:** no comprar créditos ni planes y no completar pagos.
- **Generaciones:** como máximo **una** conversación con Sofi por corrida, la mínima, por chat y en escritorio. La voz no se prueba con micrófono real.
- **WhatsApp:** nunca mandar mensajes a números reales. Los formularios públicos se prueban solo por sus caminos de error, sin enviar datos válidos.
- **Demos de prospectos:** abrirlas siempre con `?vista=panel`. Así no cuentan como visita, no se identifican en PostHog y la conversación no queda en la ficha del prospecto. Igual crea un pedido de demo (ver OBS-002).
- **Repositorio público:** acá no van nombres, códigos de demo, teléfonos, cantidades de sesiones, tasas ni enlaces a grabaciones. Los patrones se describen con palabras, como `aislado` o `repetido`.

## Batería de Sofi

Además del QA de producción, el comportamiento de Sofi se prueba con `npm run probar-sofi -- --agente <id> --clinica "<parte del nombre>"`: casos de charlas reales simulados en ElevenLabs, con todas las herramientas simuladas, contra el prompt del repositorio. Correrla después de cada cambio de prompt y antes de «Actualizar a Sofi». Detalle en [`PENDIENTES.md`](PENDIENTES.md) (25/11/2026).

## Cómo entrar

- **PostHog:** proyecto 518346 (US). La clave personal está en la variable `POSTHOG_PERSONAL_API_KEY` del entorno de la nube. Las consultas van por la API `query` (HogQL).
- **Panel:** necesita `PANEL_PASSWORD` (o el código de un consultorio de prueba) en el entorno. Hoy no está, así que el panel queda sin revisar. Para cargarlo, y el token de Vercel: tarea 5 de [`TAREAS_COMPUTER_USE.md`](TAREAS_COMPUTER_USE.md).
- **Vercel:** sin acceso desde la nube (la API responde 403). El despliegue se mira en el estado «Vercel» del commit en GitHub y en `/api/health`.

## Para quien lee este archivo

Buscá `### QA <fecha de hoy> am` o `pm`, con la fecha de Argentina. Mirá `Estado` y `PostHog revisado hasta` para saber qué se cubrió de verdad.

## Listas vivas

### Observaciones abiertas

- **OBS-001 (parcialmente resuelta el 14/11, configuración).** Producción ya usa `https://turniasalud.app`, con el 308 del dominio anterior. ElevenLabs ejecutó `consultar_disponibilidad` correctamente. Una segunda prueba apareció en Turnia con resumen y transcripción al cerrar el chat, por el webhook post-call nuevo. Google acepta los dos callbacks y se verificó la vuelta al panel al cancelar el consentimiento. Sigue pendiente la migración de las dos URLs de WAHA registradas en [`TAREAS_COMPUTER_USE.md`](TAREAS_COMPUTER_USE.md).
- **OBS-002.** Probar el chat desde `/p/<código>?vista=panel` crea un pedido de demo (lead) y lo sube a la planilla de pedidos. Las pruebas del equipo ensucian esa lista. El QA del 13/11 dejó dos pedidos de prueba, entre las 15:00 y las 15:05 de Argentina, con el nombre del consultorio que se usó para probar.
- **OBS-004.** [tarea 6, P2 en `TAREAS_COMPUTER_USE.md`] Otro sitio, `loreado.vercel.app`, manda eventos al proyecto de PostHog de Turnia con el mismo token, desde el 15/10. Ensucia las visitas de la web: ahí aparecen `/`, `/simulador` y `/mock`. Hay que filtrar por `$host` o sacar el token de ese sitio.
- **OBS-005.** La Política de privacidad pública (`/privacidad`) nombra como responsable a «Centro Médico Plaza (demo)», con una dirección y un teléfono de ejemplo, porque toma los datos de la clínica principal.
- **OBS-006.** [tarea 6, P2 en `TAREAS_COMPUTER_USE.md`] PostHog no captura los errores del navegador: no está activada la captura de excepciones y las grabaciones no guardan la consola. Un error en la demo de un prospecto hoy no se ve.

### Propuestas UX pendientes

- **UX-001.** En celular, varios prospectos rechazan el permiso del micrófono al tocar la esfera (`repetido`). El paso automático al chat funciona y la mayoría sigue escribiendo. Evaluar empezar por el chat en celular o avisar antes de pedir el permiso. **14/11:** debajo de la esfera, antes del primer toque, se avisa que se va a pedir el micrófono y hay un botón «Prefiero escribirle» que abre el chat (`demo_mode_switched` con `where = debajo_esfera`). Motivo: 14 de 22 que abrieron la demo con la esfera no hicieron nada. Medir en una semana cuántos empiezan.
- **UX-002.** Rebote rápido en `/p/<código>`: salen en menos de 10 s sin tocar nada (`repetido`, celular y escritorio).
- **UX-003.** `/probar-demo`: entran, ven el formulario y se van sin escribir (`repetido`, escritorio).
- **UX-004.** En el chat de la demo no hay indicador mientras Sofi responde. En la prueba del 13/11, la respuesta tardó unos 13 s; durante el primer segundo no se ve ni el mensaje enviado, y después solo «En línea».
- **UX-005.** La página 404 le ofrece «Ir al panel» a cualquier visitante, también a un prospecto que llegó por un link roto de su demo.
- **UX-006.** Contraste insuficiente (axe, `serious`): la lista que rota en la home y las etiquetas de `/pricing` (`text-brand-950/50`, `/60` y las etiquetas verdes).
- **UX-007.** Zonas táctiles chicas en celular:
  - el botón del menú (36×40);
  - «Voz / Chat» en la demo (28 px de alto);
  - las pestañas de la home (34 px);
  - la barra del audio (6 px).
- **UX-008.** Velocidad real de la demo personal (web vitals de PostHog): el LCP en escritorio supera los 3 s, aunque en el laboratorio carga en menos de 1 s. La respuesta al toque (INP) en celular ronda los 260 ms.

## Plantilla de cada corrida

```
### QA AAAA-MM-DD am|pm
- Inicio y fin:
- Commit y despliegue:
- Estado: completo | parcial (qué faltó y por qué) | fallido
- Tipo de corrida y pantallas:
- Flujos revisados / no revisados:
- Bugs corregidos (PR):
- Observaciones y propuestas nuevas:
- PostHog revisado hasta: <ISO> · cobertura:
- Esperado, no es bug:
```

## Resultados

### Verificación dirigida 2026-11-27 — motivo y lista unificada

- Alcance: captura del motivo, primera visita confirmada, lista de espera con/sin turno y prioridad de seguimiento; recuperación independiente de notas omitidas por el proveedor. No es un QA completo de la web ni de PostHog.
- Postgres local descartable y proveedores simulados: 849 tests / 101 archivos. Guardas de motivo antes de reservar, aceptación de consulta general, persistencia al reprogramar, espera sin turno, conservación al actualizar preferencias, aislamiento por clínica y acceso del equipo, filtros y actualización al cancelar. No hay alta automática en espera para candidatos por motivo.
- Regresión del proveedor: POST con notas devuelve 500, alta básica queda confirmada, PATCH opcional falla y se reintenta aparte; la reserva no se repite, la nota se verifica al completar y no se mandan alertas técnicas por ella. Se preservan notas de recepción y se detecta un motivo modificado por el equipo.
- El panel confirmó la actualización del agente general y de llamadas de Guerra–Mininni con el código publicado antes de este cambio. Repetir después de publicar y habilitar solo esa clínica. La batería remota de simulaciones de ElevenLabs queda separada de los tests locales.

### Verificación 2026-11-19 am (tareas 10 y 8 de computer use)

- **Alcance:** control dirigido de Smile Connect en producción y configuración de herramientas y pausa de Sofi. No es una corrida completa de la web ni de PostHog.
- **Despliegue:** [PR #238](https://github.com/axellaban/turniasalud/pull/238), commit `1ae151d`, producción Vercel en verde; `/api/health` con base y configuración correctas.
- **Estado de Smile Connect:** «Crear, mover y cancelar», tres profesionales vinculados. Quince corridas visibles con resultado «Bien», sin errores de sincronización. La copia del día se aplicó a Turnia a las 03:15. La sincronización manual de las 10:16 actualizó agenda cercana, lejana y horarios.
- **Cambios y Agenda:** se cotejó un alta preexistente de Sofi en Smile Connect por horario y profesional. La lista activa «Para revisar» estaba vacía; el registro mantiene un rechazo histórico de movimiento por cupo. La Agenda muestra «La asistencia se toma de Smile Connect» y registros pasados sin vínculo externo. Se conservaron. No se reservaron, movieron ni cancelaron turnos, ni se marcó asistencia.
- **Error corregido:** un 404 de la ruta de bloqueos se confundía con permiso faltante y quedaba retenido 24 horas. Ahora se guarda el código HTTP, se distinguen 403 y 404 y la acción manual vuelve a probar con la misma clave. Dos regresiones fallaban antes del arreglo. La prueba real confirmó **403 en `/events`** con la clave vigente, que no se cambió. Queda revisar ese rechazo con Smile Connect.
- **Equipo y pausa:** «Actualizar a Sofi» terminó correctamente para el agente general y el propio de llamadas. Se añadió `message.any` a la instancia exclusiva conservando imagen, URL y secretos; sesión `WORKING` tras el reinicio. Pausa automática prendida. Con un número ficticio y eventos firmados se comprobó firma inválida → 401, envío de API → sin pausa, envío de app simulado → pausa, entrante pausado → ignorado. «Reactivar» retiró la pausa de prueba. No se creó un paciente para esa prueba.
- **WhatsApp real:** Sofi respondió desde la línea del consultorio a dos consultas del WhatsApp del usuario sobre los horarios, incluida una continuación después del primer mensaje propio de la API. No se escribieron datos de pacientes.
- **Validación local:** 687 pruebas en 82 archivos con PostgreSQL descartable, TypeScript, ESLint y build correctos. CI y Vercel aprobados antes del merge.
- **Confirmación del usuario:** el 19/11 Axel confirmó haber recibido un aviso de «Turnia · Smile Connect» en su WhatsApp personal. No se revisó el contenido ni se disparó otro envío. También confirmó que por ahora solo tiene acceso al WhatsApp que termina en 5483.
- **Pendiente:** probar la respuesta manual desde una sesión de WhatsApp del consultorio. Los bloqueos de la Agenda requieren resolver el rechazo 403 del proveedor; la disponibilidad de Sofi sigue verificada en vivo.

### QA 2026-11-16 pm

- **Inicio y fin:** 19:14 a 19:40, hora de Argentina (a pedido, después de mergear Smile Connect por API, el resumen diario de Sofi y Next 16.4.6).
- **Commit y despliegue:** `101a0f9` (#195). Vercel en verde según GitHub; `/api/health` responde `ok` en base, ElevenLabs y herramientas.
- **Estado:** `parcial`. Faltó:
  - PostHog (no hay `POSTHOG_PERSONAL_API_KEY` en el entorno);
  - el panel en producción (sin `PANEL_PASSWORD`): se revisó en local, con la misma versión y datos ficticios;
  - los errores de Vercel (sin acceso).
- **Tipo de corrida y pantallas:** liviana (tarde). Demo personal en escritorio e iPhone 13, con red lenta y con el navegador de WhatsApp (Galaxy S8); home en escritorio e iPhone 13; `/pricing`, `/probar-demo`, `/privacidad` y `/p/<inexistente>` en escritorio.
- **Flujos revisados:**
  - La demo personal: la esfera se ve sin scrollear, «Prefiero escribirle» abre el chat con el campo, Enviar y las sugerencias, y el link con signos al final redirige a la demo. La vista previa (`og:*`) responde con imagen 200 `image/jpeg`.
  - El dominio de las herramientas: un POST sin clave da 401 (no 308). El dominio anterior conserva su 308.
  - Panel (local): Configuración → «Acceso total por WhatsApp» (resumen diario, «Con/Sin resumen», «Mandar el resumen ahora» con su aviso cuando el consultorio no tiene línea propia) y Calendario → «Smile Connect por API», en escritorio y celular, sin errores ni scroll horizontal.
  - Smile Connect: el cliente se comparó con el OpenAPI vigente de la API. El formato de error real (sin clave) coincide con el que espera Turnia.
- **Bugs corregidos (PR):** ninguno en el recorrido. En la unión del #191 se blindó el alta de pacientes en Smile Connect (mail o documento que la API rechazaría), en #195.
- **Observaciones y propuestas nuevas:** ninguna. Sin conversación con Sofi (corrida liviana).
- **PostHog revisado hasta:** sin revisar en esta corrida (queda 2026-11-13T18:17Z).
- **Esperado, no es bug:** en escritorio, la home, `/pricing` y `/probar-demo` no llegan a «red quieta» por el video de fondo; con la carga completa abren en 3 a 4 s. El 404 de `/p/<inexistente>`.

### Verificación 2026-11-14 am (tareas de computer use)

- **Tarea 1 (dominio), en lo principal resuelta:**
  - Las vistas previas ya usan `https://turniasalud.app`, así que `APP_URL` cambió.
  - En una demo (`?vista=panel`, datos ficticios), Sofi registró al paciente y ofreció horarios concretos en unos 20 s: las herramientas del agente responden.
  - En otra comprobación, el webhook nuevo guardó el resumen y la transcripción al terminar el chat. La recuperación del período desde el 05/11 terminó sin errores. Google aceptó el callback nuevo y volvió al panel al cancelar. Queda pendiente una autorización completa de Calendar. Telegram se retiró del proyecto.
- **Tarea 2 (`www`):** resuelta y comprobada por HTTPS. El destino final devuelve 200.
- **Tarea 6 (PostHog):** se instaló y probó el filtro de Loreado, se autorizó el dominio nuevo y se activó la captura de excepciones. El siguiente QA verifica la recepción.
- **Tarea 5 (accesos):** sigue pendiente. El entorno de la nube no tiene el token de Vercel, la clave de ElevenLabs ni `PANEL_PASSWORD`.
- **Pedidos de prueba:** la verificación dejó tres pedidos de demo más, entre las 9:14 y las 9:22. Además, en la ficha de demo de ese consultorio quedó un paciente ficticio, «Juan Prueba».

### QA 2026-11-13 pm

- **Inicio y fin:** 14:52 a 15:40, hora de Argentina (primera corrida, a pedido).
- **Commit y despliegue:** `6010594` (#182). Despliegue de Vercel en verde según GitHub; `/api/health` responde `ok`.
- **Estado:** `parcial`. Faltó:
  - los errores de Vercel (sin acceso);
  - el panel (sin `PANEL_PASSWORD` en el entorno);
  - el camino feliz de `/probar-demo` y de «Pedí una demo» (mandarían WhatsApp o crearían pedidos reales).
- **Tipo de corrida y pantallas:** completa. Escritorio 1366×900, iPhone 13, Galaxy S8 e iPad (gen 7). La demo personal también con red lenta y con el navegador de WhatsApp en Android.
- **Flujos revisados:**
  - 43 páginas públicas en las cuatro pantallas, con errores, 4xx, scroll horizontal, textos, axe y capturas.
  - La demo personal: ficha, voz sin micrófono con paso al chat, una conversación por chat con Enter y el cierre con «Reenviárselo a los doctores» y «Escribirle a Axel».
  - Las vistas previas (`og:*`) de la demo y de la web.
  - Los caminos de error de `/probar-demo` (vacío, web inválida, sin red, sin web) y de «Pedí una demo» (vacío, email inválido).
  - El foco con teclado.
  - `/p/<inexistente>`.
- **Bugs corregidos:**
  - El link de la demo con signos pegados al final (`…/p/<código>):`) daba «Página no encontrada». Le pasó a un prospecto real (`aislado`). Ahora redirige a su demo y conserva `?vista=panel`. Test en `outreach-messages.test.ts`.
  - Sin conexión, «Probar la demo», la demo personal y la llamada web mostraban «Failed to fetch». Ahora dicen qué pasó y qué hacer (`src/lib/error-text.ts`, con su test).
- **Observaciones y propuestas nuevas:** OBS-001 a OBS-006 y UX-001 a UX-008.
- **PostHog revisado hasta:** 2026-11-13T18:17Z · cobertura: completa para la demo personal y la web (últimas 72 h, sin tráfico interno). El panel no manda eventos, por diseño.
- **Esperado, no es bug:**
  - los `ERR_ABORTED` de los prefetch y de los audios al cerrar la página;
  - `/demo`, que pide ingresar al panel;
  - el 404 de `/p/<inexistente>`.
## Días permitidos para turnos de Sofi — 19/11/2026

Lista de espera: un caso con plantilla enviable y candidato activo reproducía un aviso para el viernes al liberar un turno. Con la validación, envía cero mensajes y la entrada sigue activa. El mismo caso sin restricción sí envía, para comprobar que el resultado no depende de una línea desconectada ni de una lista vacía. Todo con números ficticios y el envío reemplazado por un espía.

Regresión con PostgreSQL descartable y pacientes ficticios: antes del cambio la herramienta ofrecía el viernes reservado al equipo; con la regla aplicada lo excluye de búsquedas por día y por rango, rechaza reservas por WhatsApp, teléfono y web y rechaza mover al viernes conservando el turno original. Se comprueba que el panel y el equipo siguen operando los viernes, que cancelar uno existente sigue permitido y que las clínicas sin restricción mantienen sus días. Una sincronización real contra el Smile Connect simulado conserva la política y la búsqueda no consume lecturas de disponibilidad para un día excluido. Caso unitario del día local de la clínica cuando en UTC ya es viernes. Suite completa: 696 pruebas en 84 archivos; ESLint y build de producción correctos. Contexto real de chat y voz comprobado con las instrucciones actualizadas, sin crear turnos ni mandar mensajes a pacientes.
## Incidente de entrega y créditos — 19/11/2026

Caso ficticio con callback firmado de falta de créditos y una respuesta generada que dice que un turno se confirmó: se comprueba que ese texto nunca se entrega, se guarda el aviso realmente enviado, el estado queda fallido y la próxima entrada abre otra sesión. El webhook post-call y el backfill no pisan el historial real ni el diagnóstico. Dos fallos del mismo consultorio en la misma hora generan un único aviso operativo. Suite completa con PostgreSQL descartable: 698 pruebas en 84 archivos, ESLint y build correctos. En producción se verificaron el saldo recargado, una respuesta por la línea propia y la coincidencia de un turno resuelto manualmente por el consultorio; no se modificaron turnos de pacientes durante esa verificación.
## Diagnóstico de conflictos de Smile Connect — 19/11/2026

El cliente conserva el `request_id` junto al código y mensaje del rechazo 409. La regresión comprueba que los tres llegan al diagnóstico que se guarda, que cabe en 300 caracteres y que una clave accidentalmente incluida por el proveedor se oculta. 700 pruebas en 84 archivos con PostgreSQL descartable, ESLint y build correctos. Los turnos de pacientes no se usan como fixtures ni se reintentan para reproducir el error.

## Inicios válidos para la duración completa — 19/11/2026

Control dirigido con un paciente explícitamente ficticio, sin teléfono real y dado de baja de campañas, y un turno a un año. Creación comprobada en Smile Connect. La reprogramación a 14:15–14:45 devolvió `409 slot_unavailable` pese a pasar el chequeo antiguo; mover ese mismo turno a 14:00–14:30 funcionó y se verificó en la agenda nativa. No se usaron conversaciones de ElevenLabs ni turnos reales para reproducirlo.

La consulta de Sofi usa ahora la duración real (incluidos los minutos que se conservan al reprogramar), y filtra por los inicios exactos del proveedor. La comprobación antes de escribir usa también duración y consultorio. Un rechazo `slot_unavailable` posterior a la consulta comprueba otra vez el original: si sigue intacto, pide otro horario; si cambió, conserva la derivación a recepción. Las regresiones cubren 30 y 45 minutos, el intento directo de un inicio inválido, mover y cancelar válidos, y los dos resultados de la carrera con recepción. La regresión principal fallaba antes del arreglo. 704 pruebas en 84 archivos con PostgreSQL descartable, ESLint y build correctos. El resultado del control posterior al despliegue y la cancelación del turno ficticio se registra en el cierre del [PR #247](https://github.com/axellaban/turniasalud/pull/247).
# Control de llamadas y WhatsApp — 24/11/2026

- Prueba real de recuperación: línea del consultorio WORKING y cuenta correcta; mensaje entrante desde la línea propia del usuario, respuesta recibida y transcripción comprobada en Turnia.
- El motivo original de la pérdida de sesión no pudo establecerse con los registros disponibles. Se preservaron imagen y volúmenes; el control nuevo guarda transiciones y alerta mediante el cron existente, sin reiniciar ni desvincular sesiones.
- Regresiones con proveedores simulados y PostgreSQL descartable: reserva importada en lista de espera sin habilitar altas nuevas; idempotencia; restricciones de implantes, extracciones y duración; oferta compatible; vínculo después de mover; baja de la espera al cancelar; estado completado durante la llamada; cancelación; aislamiento del paciente; aviso explícito por WhatsApp; revisión única cuando ese canal no está operativo; historial de caída/recuperación y alertas acotadas; cuenta incorrecta y errores sin credenciales.
- Suite completa: 742 pruebas en 87 archivos; ESLint correcto. La validación no repitió gestiones sobre pacientes reales ni envió avisos pendientes del incidente.
