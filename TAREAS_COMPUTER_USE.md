# Tareas para una IA con computer use

Tareas de configuración que no se arreglan desde el código: se hacen en paneles web (Vercel, ElevenLabs, Google Cloud, PostHog, claude.ai) con el navegador del usuario, donde ya tiene la sesión iniciada. Salieron del QA del 13/11/2026 ([`QA_TURNIA.md`](QA_TURNIA.md)).

Cada tarea se puede copiar entera como prompt. Van en orden de prioridad: **P0** es lo primero.

| Prioridad | Tarea | Por qué | ¿Necesita al usuario? | Estado al 14/11, 09:20 |
| --- | --- | --- | --- | --- |
| **P0** | 1. Todo lo de afuera, al dominio nuevo | Sofi no puede consultar la agenda y, desde el 05/11, no se guarda ninguna conversación | No (salvo que algo pida volver a iniciar sesión) | ✅ en lo principal: `APP_URL` cambiado y Sofi vuelve a dar turnos. Falta confirmar el webhook post-call, Google y Telegram |
| **P1** | 2. Certificado de `www.turniasalud.app` | Quien entra con «www» ve un error de seguridad | Solo si el dominio no está comprado en Vercel (registro DNS) | ❌ pendiente: el certificado sigue sin incluir `www` |
| **P2** | 6. PostHog: datos limpios y errores visibles | Otro sitio ensucia las métricas; los errores de la demo no se ven | No | ❌ pendiente: no hay filtro ni transformación para `loreado`, y la captura de errores está apagada. La consola en las grabaciones ya estaba activa |
| **P3** | 5. Accesos para el QA automático | Para que el QA revise el panel y los errores de Vercel | **Sí**: el usuario escribe la contraseña y el token, la IA no los ve | ❌ pendiente: el entorno no tiene el token de Vercel, la clave de ElevenLabs ni `PANEL_PASSWORD` |

## Reglas para todas las tareas

- **No escribas contraseñas, tokens ni claves en el chat, en documentos ni en capturas.** Si una pantalla muestra una clave, no la copies. Cuando haya que cargar un valor secreto, pedile al usuario que lo escriba él.
- Antes de cambiar algo, sacá una captura de cómo estaba. Al terminar, otra de cómo quedó.
- Cambiá solo lo que dice la tarea. No borres proyectos, dominios, variables ni webhooks. No cambies secretos. No mandes mensajes de WhatsApp. No cierres sesiones de WAHA.
- Si algo no coincide con lo que describe la tarea (otro nombre, otro menú, un valor distinto), frená y preguntá.
- Al terminar cada tarea, contestá: qué quedó hecho en cada paso, qué no se pudo y por qué, y el resultado de la verificación.

---

## Tarea 1 (P0) · Todo lo de afuera, al dominio nuevo

**Contexto.** `turniasalud.vercel.app` redirige (308) a `https://turniasalud.app`. El usuario decidió **mantener esa redirección**. Pero la app todavía tiene la dirección vieja en `APP_URL`, y con ella están registradas las herramientas de Sofi, el webhook post-call de ElevenLabs, el webhook de Telegram y el regreso de Google. Esos servicios no siguen la redirección:

- en la demo, al pedir un turno, Sofi contestó «el sistema de agenda no me respondió»;
- desde el 05/11 no se guarda ninguna conversación con Sofi.

**Pasos**, en este orden:

1. **Vercel** → proyecto `turniasalud` → Settings → Environment Variables → `APP_URL` (Production): poné `https://turniasalud.app`, sin barra final. Si no existe, creala. Guardá. Después: Deployments → el último de Production → Redeploy. Esperá a que diga Ready.
2. **ElevenLabs** (elevenlabs.io) → Agents Platform → Settings → Webhooks (post-call). Cambiá la URL de `https://turniasalud.vercel.app/api/elevenlabs/post-call` a `https://turniasalud.app/api/elevenlabs/post-call`. No cambies el secreto ni otros ajustes. Guardá.
3. **Panel de Turnia**: `https://turniasalud.app/panel/sistema` → «Crear / actualizar agente». Esperá el mensaje de éxito. Así se vuelven a registrar las herramientas y el webhook de inicio con la dirección nueva.
4. **Google Cloud** → APIs & Services → Credentials → el cliente OAuth de Turnia → Authorized redirect URIs: agregá `https://turniasalud.app/api/google/callback`. Dejá la vieja. Guardá.
5. **Telegram y WAHA**:
   - Si en el panel (Sistema o Configuración) hay un botón para volver a registrar el webhook de Telegram, tocalo.
   - En WAHA no toques nada. Solo anotá a qué URL apuntan sus webhooks y si alguna sigue con `turniasalud.vercel.app`.

**Prohibido:** quitar o cambiar la redirección de dominios en Vercel.

**Verificación:**

- En ElevenLabs → Agents Platform → el agente de Turnia → Tools → `consultar_disponibilidad`, la URL tiene que empezar con `https://turniasalud.app/`.
- Panel → «Probar a Sofi» → empezar en esta pantalla, por chat. Escribí: «Hola, quería un turno para una consulta esta semana». Sofi tiene que ofrecer días y horarios concretos, no decir que la agenda o el sistema no responden. Después cerrá la conversación.
- En ElevenLabs → la conversación de esa prueba: la llamada a `consultar_disponibilidad` tiene que figurar como exitosa.

---

## Tarea 2 (P1) · Certificado de `www.turniasalud.app`

**Contexto.** `https://www.turniasalud.app` da un error de certificado: el dominio con «www» no está configurado en Vercel.

**Pasos:**

1. **Vercel** → proyecto `turniasalud` → Settings → Domains → Add: `www.turniasalud.app`. Elegí que **redirija** (308) a `turniasalud.app`.
2. Si Vercel pide un registro DNS (porque el dominio no está comprado en Vercel), anotá exactamente qué pide (tipo, nombre y valor; suele ser un CNAME `www` a `cname.vercel-dns.com`). Agregalo en el proveedor del dominio. Si no sabés cuál es o no tenés acceso, frená y avisale al usuario con el dato exacto.
3. Esperá a que Vercel muestre el dominio como válido, con el certificado emitido. Puede tardar unos minutos.

**Prohibido:** tocar `turniasalud.app`, `turniasalud.vercel.app` o su redirección.

**Verificación:** abrí `https://www.turniasalud.app` en el navegador. No tiene que aparecer ninguna advertencia de seguridad, y la barra de direcciones tiene que terminar en `https://turniasalud.app/`.

---

## Tarea 6 (P2) · PostHog: datos limpios y errores visibles

**Contexto.** El proyecto de PostHog «Turnia Salud» recibe eventos de otro sitio, `loreado.vercel.app`, que usa el mismo token. Esos eventos aparecen como visitas a la web de Turnia. Además, PostHog no captura los errores del navegador ni la consola en las grabaciones: si la demo de un prospecto falla, no se ve.

**Pasos** (PostHog, proyecto «Turnia Salud», el de US Cloud):

1. **Dejar afuera los eventos del otro sitio, de ahora en adelante.** Data pipelines → Transformations → New. Elegí la que descarta o filtra eventos («Filter events», «Drop events» o similar), con la condición: propiedad `$host` igual a `loreado.vercel.app` → descartar. Guardá y activala. Si no hay una transformación así, frená y avisá.
2. **Dejarlos afuera también del historial.** Settings → Project → «Filter out internal and test users»: agregá el filtro `$host` **distinto de** `loreado.vercel.app`, sin borrar los que ya estén (como `is_internal`).
3. **Errores del navegador.** Settings → Error tracking → activá «Exception autocapture» (o «Capture exceptions»).
4. **Consola en las grabaciones.** Settings → Session replay → activá «Capture console logs». No cambies el resto de las opciones de grabación.
5. **Dominio autorizado.** Settings → Project → Authorized URLs (o «Toolbar URLs»): agregá `https://turniasalud.app`. Hoy figuran `loreado.vercel.app` y `turniasalud.vercel.app`, pero no el dominio actual. No borres las otras.

**Prohibido:** borrar eventos, personas, tableros o insights, y tocar el token del proyecto.

**Verificación:**

- En Activity, filtrá por `$host = loreado.vercel.app`: no tiene que entrar ningún evento nuevo desde la hora del cambio.
- Contestá qué opciones quedaron activadas, con sus nombres exactos.
- El próximo QA confirma que llegan `$exception` y la consola de las grabaciones.

---

## Tarea 5 (P3) · Accesos para el QA automático

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

- tarea 1: OBS-001;
- tarea 2: OBS-003;
- tarea 6: OBS-004 y OBS-006;
- tarea 5: «Cómo entrar».
