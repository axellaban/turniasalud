# QA de Turnia

Registro del QA de producción de turniasalud.app, igual que el de habita. (`docs/qa-habita.md` en amoblaia). El procedimiento completo está en [`.claude/skills/qa-turnia/SKILL.md`](.claude/skills/qa-turnia/SKILL.md).

## Reglas principales

- **Plata:** no comprar créditos ni planes y no completar pagos.
- **Generaciones:** como máximo **una** conversación con Sofi por corrida, la mínima, por chat y en escritorio. La voz no se prueba con micrófono real.
- **WhatsApp:** nunca mandar mensajes a números reales. Los formularios públicos se prueban solo por sus caminos de error, sin enviar datos válidos.
- **Demos de prospectos:** abrirlas siempre con `?vista=panel`. Así no cuentan como visita, no se identifican en PostHog y la conversación no queda en la ficha del prospecto. Igual crea un pedido de demo (ver OBS-002).
- **Repositorio público:** acá no van nombres, códigos de demo, teléfonos, cantidades de sesiones, tasas ni enlaces a grabaciones. Los patrones se describen con palabras, como `aislado` o `repetido`.

## Cómo entrar

- **PostHog:** proyecto 518346 (US). La clave personal está en la variable `POSTHOG_PERSONAL_API_KEY` del entorno de la nube. Las consultas van por la API `query` (HogQL).
- **Panel:** necesita `PANEL_PASSWORD` (o el código de un consultorio de prueba) en el entorno. Hoy no está, así que el panel queda sin revisar. Para cargarlo, y el token de Vercel: tarea 5 de [`TAREAS_COMPUTER_USE.md`](TAREAS_COMPUTER_USE.md).
- **Vercel:** sin acceso desde la nube (la API responde 403). El despliegue se mira en el estado «Vercel» del commit en GitHub y en `/api/health`.

## Para quien lee este archivo

Buscá `### QA <fecha de hoy> am` o `pm`, con la fecha de Argentina. Mirá `Estado` y `PostHog revisado hasta` para saber qué se cubrió de verdad.

## Listas vivas

### Observaciones abiertas

- **OBS-001 (parcialmente resuelta el 14/11, configuración).** Producción ya usa `https://turniasalud.app`, con el 308 del dominio anterior. ElevenLabs ejecutó `consultar_disponibilidad` correctamente. Una segunda prueba apareció en Turnia con resumen y transcripción al cerrar el chat, por el webhook post-call nuevo. Google conserva ambos callbacks. Sigue pendiente la migración de las dos URLs de WAHA registradas en [`TAREAS_COMPUTER_USE.md`](TAREAS_COMPUTER_USE.md).
- **OBS-002.** Probar el chat desde `/p/<código>?vista=panel` crea un pedido de demo (lead) y lo sube a la planilla de pedidos. Las pruebas del equipo ensucian esa lista. El QA del 13/11 dejó dos pedidos de prueba, entre las 15:00 y las 15:05 de Argentina, con el nombre del consultorio que se usó para probar.
- **OBS-003.** [tarea 2, P1 en `TAREAS_COMPUTER_USE.md`] `www.turniasalud.app` no tiene certificado válido: el navegador muestra un error de seguridad. Se arregla agregando el dominio en Vercel o redirigiéndolo al dominio sin `www`.
- **OBS-004.** [tarea 6, P2 en `TAREAS_COMPUTER_USE.md`] Otro sitio, `loreado.vercel.app`, manda eventos al proyecto de PostHog de Turnia con el mismo token, desde el 15/10. Ensucia las visitas de la web: ahí aparecen `/`, `/simulador` y `/mock`. Hay que filtrar por `$host` o sacar el token de ese sitio.
- **OBS-005.** La Política de privacidad pública (`/privacidad`) nombra como responsable a «Centro Médico Plaza (demo)», con una dirección y un teléfono de ejemplo, porque toma los datos de la clínica principal.
- **OBS-006.** [tarea 6, P2 en `TAREAS_COMPUTER_USE.md`] PostHog no captura los errores del navegador: no está activada la captura de excepciones y las grabaciones no guardan la consola. Un error en la demo de un prospecto hoy no se ve.

### Propuestas UX pendientes

- **UX-001.** En celular, varios prospectos rechazan el permiso del micrófono al tocar la esfera (`repetido`). El paso automático al chat funciona y la mayoría sigue escribiendo. Evaluar empezar por el chat en celular o avisar antes de pedir el permiso.
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

### Verificación 2026-11-14 am (tareas de computer use)

- **Tarea 1 (dominio), en lo principal resuelta:**
  - Las vistas previas ya usan `https://turniasalud.app`, así que `APP_URL` cambió.
  - En una demo (`?vista=panel`, datos ficticios), Sofi registró al paciente y ofreció horarios concretos en unos 20 s: las herramientas del agente responden.
  - En otra comprobación, el webhook nuevo guardó el resumen y la transcripción al terminar el chat. La recuperación del período desde el 05/11 terminó sin errores. Google acepta los dos callbacks y queda pendiente completar un inicio de sesión de prueba. Telegram se retiró del proyecto.
- **Tarea 2 (`www`):** sigue pendiente. El certificado es solo de `turniasalud.app`.
- **Tarea 6 (PostHog):** sigue pendiente. No hay transformación ni filtro para `loreado.vercel.app` y la captura de excepciones está apagada. La consola en las grabaciones ya estaba activa. Falta además `turniasalud.app` en las URLs autorizadas.
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
