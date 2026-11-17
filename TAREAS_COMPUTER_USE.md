# Tareas para una IA con computer use

Tareas de configuración que no se arreglan desde el código: se hacen en paneles web (Vercel, ElevenLabs, Google Cloud, PostHog, claude.ai) con el navegador del usuario, donde ya tiene la sesión iniciada. Salieron del QA del 13/11/2026 ([`QA_TURNIA.md`](QA_TURNIA.md)).

Cada tarea se puede copiar entera como prompt. Van en orden de prioridad: **P0** es lo primero.

**Estado al 16/11/2026:** todo el código está en producción. Lo único que falta para terminar el trabajo funcional es la **tarea 7**. La 5 es opcional, para el QA automático, y la 1 es opcional porque hoy funciona.

**Prompt para empezar** (copiar tal cual en la otra computadora):

> Leé `TAREAS_COMPUTER_USE.md` del repositorio `axellaban/turniasalud` (rama `main`). Revisá la **tarea 7, etapa B**, que ya está activada. Compará los cambios de prueba con la agenda de Smile Connect y el resumen de Sofi. Antes de la etapa C, coordiná la prueba de creación con el consultorio.

Para las etapas C y D, seguí las verificaciones de esta tarea.

| Prioridad | Tarea | Estado (16/11) | Acción restante |
| --- | --- | --- | --- |
| **P0** | 7. Smile Connect por API y resumen diario (Guerra–Mininni) | Clave cargada, lectura verificada y «Escritura de prueba» activa. Resumen manual enviado a los dos celulares configurados. | Revisar los cambios de prueba y conciliar las reservas previas que Sofi dio por WhatsApp. Después, C y D con el consultorio. |
| **P1** | 5. Accesos para el QA automático | Pendiente. | Que el QA pueda revisar el panel en producción, PostHog y Vercel. Los valores los carga el usuario. |
| **P3** | 1. Dominio nuevo: webhooks de WAHA (opcional) | Funciona: los dos webhooks apuntan al dominio anterior y llegan por su redirección 308, que se mantiene. | Solo si algún día se saca la redirección. |
| — | 2. Certificado de `www.turniasalud.app` | Resuelta. | — |
| — | 6. PostHog: datos limpios y errores visibles | Configurada el 14/11. | Ninguna: el QA comprueba que lleguen las excepciones. |

## Reglas para todas las tareas

- **No escribas contraseñas, tokens ni claves en el chat, en documentos ni en capturas.** Si una pantalla muestra una clave, no la copies. Cuando haya que cargar un valor secreto, pedile al usuario que lo escriba él.
- Antes de cambiar algo, sacá una captura de cómo estaba. Al terminar, otra de cómo quedó.
- Cambiá solo lo que dice la tarea. No borres proyectos, dominios, variables ni webhooks. No cambies secretos. No mandes mensajes de WhatsApp. No cierres sesiones de WAHA.
- Si algo no coincide con lo que describe la tarea (otro nombre, otro menú, un valor distinto), frená y preguntá.
- Al terminar cada tarea, contestá: qué quedó hecho en cada paso, qué no se pudo y por qué, y el resultado de la verificación.

---

## Tarea 7 (P0) · Smile Connect por API y resumen diario (Guerra–Mininni)

**Contexto.** La API de Smile Connect de Guerra–Mininni está conectada en **«Escritura de prueba»** desde el 16/11. La API todavía omite las notas y la prestación. Esos datos van en el resumen de Sofi, programado de lunes a jueves a las 10, hora del consultorio. Detalle técnico en [`SMILE_CONNECT_API.md`](SMILE_CONNECT_API.md).

**Verificación del 16/11.** Tres profesionales vinculados. El Dr. Guerra, ausente de la lista de Smile Connect, se desactivó para nuevas reservas en Turnia. El userscript de Tampermonkey de Guerra–Mininni quedó desactivado por pedido de Axel. La sincronización manual leyó 146 turnos. El 17 y 18 de noviembre coincidieron los 39 turnos vigentes de Smile Connect por profesional y horario. Otras seis reservas de Turnia se originaron por WhatsApp y quedan para revisión. Sofi descartó un horario ocupado y las tres alternativas ofrecidas estaban libres en Smile Connect. Turnia confirmó el envío manual del resumen a dos celulares después de publicar el [PR #200](https://github.com/axellaban/turniasalud/pull/200).

La escritura cambia la agenda real del consultorio, y hay que asumir que no tiene backup. Por eso se avanza por etapas, con días de por medio. **No pases a la etapa siguiente sin el «sí» del usuario.**

**Dónde:** panel de Turnia (`https://turniasalud.app/panel`) con la clínica **Guerra–Mininni** elegida arriba. Smile Connect (`https://app.smileconnect.pro`), si el usuario tiene la sesión iniciada, solo para mirar. Vercel, proyecto `turniasalud`, solo en la etapa C.

### Etapa A · Hoy: conectar en «Solo lectura» y comprobar el resumen

1. **Agente (hecho por el usuario el 16/11; no hace falta repetirlo).** En Guerra–Mininni → Configuración → Consultorio → tarjeta «Acceso total por WhatsApp» → «Actualizar a Sofi». Después, en la tarjeta «Sofi de este consultorio · llamadas» → «Preparar o actualizar el agente». Y en Sistema → «Crear / actualizar agente». Si el usuario ya lo hizo el 16/11, alcanza con confirmarlo. Así Sofi tiene `detalle_turno` y `turnos_de_sofi`.
2. **Resumen diario.** Configuración → Consultorio → «Acceso total por WhatsApp». El celular del Dr. Mininni tiene que decir «Recibe el resumen de las 10». Si el usuario está de acuerdo, tocá «Mandar el resumen ahora» y confirmá con él que le llegó a Mininni. Sale por la línea del consultorio.
3. **Clave.** Configuración → Calendario → «Smile Connect por API» → campo «Clave de la API». **La pega el usuario, vos no la ves ni la copiás.** Guardar. Turnia la prueba antes de guardarla.
   - Tiene que mostrar el nombre de la clínica de Smile Connect y la lista «Profesionales» vinculados con los de Turnia.
   - Si un profesional queda sin vincular, o vinculado con otro, frená y avisá.
   - Si dice que a la clave le falta un permiso, avisale al usuario cuál. Los permisos que hacen falta están en `SMILE_CONNECT_API.md` → «Para activarlo».
4. **Modo.** Elegí **«Solo lectura»** → «Guardar el modo». Nada más.
5. **Primera sincronización.** Corre sola en los 10 minutos siguientes, o tocá «Sincronizar ahora» en la tarjeta. Después revisá:
   - que la tarjeta no muestre «Último problema»;
   - que en el panel, Agenda de Turnia, mañana y pasado tengan los mismos turnos que Smile Connect, mirando los dos lado a lado. Anotá solo cuántos coinciden y cuántos no, sin nombres.
6. **Sofi no ofrece lo ocupado.** En «Probar a Sofi» (Guerra–Mininni), pedí por chat «un turno para un control mañana a la tarde», con datos ficticios. **No reserves.** Los horarios que ofrece tienen que estar libres en Smile Connect.

### Etapa B · Desde el día siguiente, 2 o 3 días: «Escritura de prueba»

Solo con el «sí» del usuario.

1. Calendario → «Smile Connect por API» → modo **«Escritura de prueba»** → «Guardar el modo». Turnia anota qué escribiría, pero no escribe nada.
2. Cada día, revisá el registro de cambios de la tarjeta. Los que dicen «Prueba (no se escribió)» tienen que corresponder a turnos que Sofi dio, movió o canceló, con el paciente, la hora y el profesional correctos. Los que dicen «Revisar» se le cuentan al usuario.
3. Compará con el resumen de las 10 de ese día: lo que dice el resumen y lo que figura en el registro tienen que coincidir.

### Etapa C · Con el consultorio mirando: «Crear turnos»

Solo con el «sí» del usuario y del consultorio.

1. **Vercel** → `turniasalud` → Settings → Environment Variables → Production. Agregá `SMILE_CONNECT_WRITES` con el valor `on`. No es secreto. Después, redeploy de producción. Sin esta variable, Turnia no escribe aunque el modo lo diga.
2. En el panel, modo **«Crear turnos»**. Marcá la casilla «lo revisé con el consultorio…» y guardá.
3. **Prueba:** en «Probar a Sofi», con datos ficticios y en un horario que elija el consultorio, reservá un turno simple. Sofi debe confirmar solo cuando el mismo turno ya aparezca en Smile Connect, con un profesional y en ese horario. Si queda pendiente, revisá la tarea de recepción y el registro de la tarjeta. Si el alta fue exitosa, recepción cancela el turno ficticio desde Smile Connect.
4. Avisale al usuario que recepción ya puede dejar de copiar a mano los turnos de Sofi: llegan solos, y el detalle sale en el resumen de las 10.

### Etapa D · Después de unos días sin problemas: «Crear, mover y cancelar»

Este modo sincroniza los movimientos y cancelaciones que recepción hace desde el panel. Sofi deriva esos pedidos a recepción. Antes de probar este modo, validá un movimiento y una cancelación de prueba con el consultorio.

**Para apagar al instante:** modo «Apagada». Lo pendiente de escribir se descarta.

**Prohibido:**
- editar o borrar turnos o pacientes en Smile Connect, salvo la cancelación del turno ficticio de la etapa C;
- crear turnos de prueba con datos de pacientes reales;
- mandar WhatsApp a pacientes;
- volver a activar el userscript de Guerra–Mininni mientras esté funcionando la conexión por API.

**Verificación (contestá en cada etapa):**
- en qué modo quedó;
- los profesionales vinculados, solo cuántos;
- si la agenda coincide;
- si Sofi ofreció solo horarios libres;
- en la etapa C, si el turno ficticio apareció en Smile Connect;
- qué quedó «para revisar», si hay algo.

**Si algo falla:** volvé a «Solo lectura», o a «Apagada» si escribió algo mal, y avisá con una captura de la tarjeta, sin la clave.

---

## Tarea 1 (P3, opcional) · Dominio nuevo

El 14/11 se actualizó `APP_URL` de producción, se registraron de nuevo las herramientas del agente compartido y se añadió el callback nuevo de Google. Se creó el webhook post-call de ElevenLabs para `https://turniasalud.app/api/elevenlabs/post-call` y se publicó su secreto de firma en Vercel. Una prueba confirmó que Sofi ofrece horarios y otra confirmó que Turnia recibe el resumen y la transcripción cuando termina la charla. El dominio anterior conserva el 308. Telegram se retiró en el PR #188 y se eliminó su variable de producción. Google aceptó el callback nuevo, mostró el consentimiento de Calendar y devolvió al panel al cancelar la prueba.

La revisión de WAHA detectó estas dos URLs configuradas:

- Línea general: `https://turniasalud.vercel.app/api/waha/webhook`.
- Guerra–Mininni: `https://turniasalud.vercel.app/api/waha/webhook/guerra-mininni`.

**Hoy funciona:** WAHA llama a esas direcciones, el dominio anterior redirige (308) a `turniasalud.app` y el mensaje llega igual. El usuario decidió mantener esa redirección, así que **no hace falta cambiar nada**. Solo hay que hacerlo si algún día se saca la redirección; si no, Sofi deja de recibir los mensajes de WhatsApp.

**Si se hace** (con el «sí» del usuario, de a una línea, primero la general y nunca mientras se activa la tarea 7):

1. En el dashboard de esa instancia de WAHA, en la sesión de la línea, cambiá solo el dominio del webhook: `turniasalud.vercel.app` pasa a `turniasalud.app`. El resto de la URL, los eventos y la clave HMAC quedan igual. Captura antes y después.
2. Si WAHA pide reiniciar la sesión, preguntale al usuario antes. **No cierres la sesión (logout) ni la desvincules.** Si después pide el QR, frená.
3. **Prueba de recepción:** el usuario le escribe a esa línea desde su celular. Sofi tiene que contestar en menos de un minuto.
4. Si no contesta, volvé a poner la URL anterior y avisá.

---

## Tarea 2 (resuelta) · Certificado de `www.turniasalud.app`

**Resuelta el 14/11.** Vercel sirve un certificado que cubre `www.turniasalud.app` y devuelve 308 hacia `https://turniasalud.app/`, que responde 200. El procedimiento queda como referencia.

**Pasos:**

1. **Vercel** → proyecto `turniasalud` → Settings → Domains → Add: `www.turniasalud.app`. Elegí que **redirija** (308) a `turniasalud.app`.
2. Si Vercel pide un registro DNS (porque el dominio no está comprado en Vercel), anotá exactamente qué pide (tipo, nombre y valor; suele ser un CNAME `www` a `cname.vercel-dns.com`). Agregalo en el proveedor del dominio. Si no sabés cuál es o no tenés acceso, frená y avisale al usuario con el dato exacto.
3. Esperá a que Vercel muestre el dominio como válido, con el certificado emitido. Puede tardar unos minutos.

**Prohibido:** tocar `turniasalud.app`, `turniasalud.vercel.app` o su redirección.

**Verificación:** abrí `https://www.turniasalud.app` en el navegador. No tiene que aparecer ninguna advertencia de seguridad, y la barra de direcciones tiene que terminar en `https://turniasalud.app/`.

---

## Tarea 6 (hecha) · PostHog: datos limpios y errores visibles

**Configurada el 14/11 en PostHog, proyecto 518346.** La transformación `Drop Events` descarta solo eventos con `$host = loreado.vercel.app`; una ejecución de prueba descartó un evento de ese sitio. Filtros de usuarios internos conserva `is_internal ≠ true` y suma `$host ≠ loreado.vercel.app`. «Enable exception autocapture» quedó activo, «Capture console logs» ya estaba activo y se autorizó `https://turniasalud.app`. El procedimiento queda como referencia.

**Pasos** (PostHog, proyecto «Turnia Salud», el de US Cloud):

1. **Dejar afuera los eventos del otro sitio, de ahora en adelante.** Data pipelines → Transformations → New. Elegí la que descarta o filtra eventos («Filter events», «Drop events» o similar), con la condición: propiedad `$host` igual a `loreado.vercel.app` → descartar. Guardá y activala. Si no hay una transformación así, frená y avisá.
2. **Excluirlos de los análisis históricos con el filtro activo.** Settings → Project → Customization → «Filter out internal and test users»: agregá el filtro `$host` **distinto de** `loreado.vercel.app`, sin borrar los que ya estén (como `is_internal`).
3. **Errores del navegador.** Settings → Error tracking → activá «Exception autocapture» (o «Capture exceptions»).
4. **Consola en las grabaciones.** En Settings → Session replay, verificá «Capture console logs». Ya estaba activo en el QA del 14/11.
5. **Dominio autorizado.** En Settings → Project → Authorized URLs, agregá `https://turniasalud.app` y conservá las URLs existentes.

**Prohibido:** borrar eventos, personas, tableros o insights, y tocar el token del proyecto.

**Verificación:**

- En Activity, filtrá por `$host = loreado.vercel.app`: no tiene que entrar ningún evento nuevo desde la hora del cambio.
- Contestá qué opciones quedaron activadas, con sus nombres exactos.
- El próximo QA confirma que llegan `$exception` y la consola de las grabaciones.

---

## Tarea 5 (P1) · Accesos para el QA automático

**Contexto.** El QA de Turnia corre en una sesión de Claude Code en la nube. Hoy no puede entrar al panel, porque falta la contraseña en su entorno, ni leer los errores de Vercel, porque falta un token. **Los valores los escribe el usuario. La IA solo navega hasta la pantalla y le avisa.**

**Pasos:**

1. **Token de Vercel.**
   - Vercel → Account Settings → Tokens → Create.
   - Nombre: `claude-qa-turnia`. Alcance: solo el equipo donde está el proyecto `turniasalud`. Vencimiento: 90 días.
   - Al crearlo, Vercel lo muestra una sola vez: **pedile al usuario que lo copie él**. No lo leas en voz alta, no lo escribas en ningún lado y no lo captures.
2. **Cargar el token en el entorno de la nube.**
   - claude.ai/code → abrí una sesión de Turnia → en la barra del título, el menú del entorno de la nube → Edit → **Network secrets** (en apps viejas: «API credentials»).
   - Host: `api.vercel.com`. Header: `Authorization`, con el prefijo `Bearer`. El valor lo pega el usuario.
3. **(Opcional, recomendado) Clave de ElevenLabs** para que el QA lea las conversaciones y las fallas de las herramientas.
   - En el mismo lugar, otro Network secret: host `api.elevenlabs.io`, header `xi-api-key`.
   - La clave la crea y la pega el usuario. ElevenLabs → API Keys, con permiso de solo lectura si lo ofrece.
4. **Contraseña del panel.**
   - En el mismo menú del entorno → Edit → Environment variables: `PANEL_PASSWORD`. El valor lo escribe el usuario.
   - Avisale que **queda guardada como texto en el entorno** y que la puede leer cualquier sesión que use ese entorno. Si prefiere no hacerlo, saltá este paso.

**Prohibido:** crear tokens con más alcance del necesario, y tocar otros secretos o variables del entorno.

**Verificación:**

- Contestá qué quedó cargado: host, header o nombre de variable, **nunca el valor**.
- En el próximo QA, Claude prueba los accesos: `api.vercel.com` tiene que responder sin 403, y el panel tiene que abrir.
- Si funcionan, actualiza «Cómo entrar» en `QA_TURNIA.md`.

---

## Después de cada tarea

La próxima sesión de Claude que corra el QA (`.claude/skills/qa-turnia/SKILL.md`) verifica lo hecho. Si está bien, cierra la observación en `QA_TURNIA.md`:

- tarea 6: OBS-004 y OBS-006;
- tarea 5: «Cómo entrar»;
- tarea 7: el estado en `SMILE_CONNECT_API.md` y en `PENDIENTES.md`.
