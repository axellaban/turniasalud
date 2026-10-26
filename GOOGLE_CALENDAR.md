# Google Calendar

Actualizado: 24/10/2026. **Código hecho y probado con Google simulado** (`src/test/calendar.integration.test.ts`, `src/lib/calendar/sync.test.ts`). Para usarlo faltan las credenciales de Google (pasos abajo).

## Cómo funciona

- **Una cuenta de Google por clínica.** La conecta la dueña o la secretaria en Panel → Configuración → **Calendario**.
- **Un calendario por profesional.** Cada profesional usa uno de los calendarios de esa cuenta (propio o compartido con ella).
- **Turnia sigue siendo la dueña de sus turnos.** Dos pacientes nunca toman el mismo horario: eso lo resuelve la base de datos, no Google.
- **Lectura.** Lo **ocupado** en el calendario del profesional deja de ofrecerse.
  - Se ignoran los eventos marcados «Disponible», los cancelados, los rechazados y los que creó Turnia.
  - Turnia lee solo horarios: nunca títulos ni descripciones.
  - Para mostrar opciones usa lo leído en los últimos 2 minutos.
  - **Al reservar** consulta a Google en el momento, para ese horario exacto.
- **Escritura.** Cada turno es un evento en el calendario del profesional.
  - Título: «Turno: Consulta odontológica · Juan P.».
  - Descripción: nombre, teléfono y enlace al panel. Nunca DNI, cobertura ni notas.
  - Si se reprograma, el evento se mueve. Si se cancela, se borra. Atendidos y ausentes quedan.
- **Si Google falla, el turno se da igual.**
  - Un trigger de Postgres (`turnia_calendar_mark`) marca el evento como pendiente en cualquier alta o cambio del turno, venga del agente, del panel o de campañas.
  - Se escribe después de responder (`after()`).
  - Si falla, lo reintenta la automatización `/api/automations/calendario`, hasta 8 intentos.
  - El id del evento sale del turno, así un reintento no duplica eventos.
- **Turnia manda sobre sus eventos.** Si alguien mueve o borra en Google un evento de Turnia, el turno sigue igual en Turnia: los cambios se hacen desde el panel o con el agente. El próximo cambio del turno vuelve a escribir el evento.
- **Desde el panel se puede «Darlo igual»** sobre un horario ocupado en Google (y fuera de horario o en un día bloqueado). El agente nunca lo ofrece.
- **Si Google pide reconectar** (permiso revocado o vencido):
  - La agenda sigue andando sin lo de Google.
  - El panel muestra «Reconectar».
  - Los eventos quedan pendientes hasta reconectar.
- **Seguridad.**
  - Los tokens se guardan cifrados con AES-256-GCM (`src/lib/calendar/crypto.ts`).
  - El OAuth usa un estado firmado, atado a una cookie del navegador que lo pidió.
  - Un consultorio solo puede conectar su propia clínica.
  - Al desconectar se revoca el permiso en Google, salvo que la misma cuenta siga conectada en otra clínica o en la planilla de Turnia (`GOOGLE_SHEETS.md`): Google revoca todo junto.

Código: `src/lib/calendar/` (google.ts, sync.ts, crypto.ts), `src/app/api/google/` (conectar, callback), `src/app/panel/calendar-actions.ts`, `src/app/panel/(app)/configuracion/calendario/`.

## Lo que hay que hacer en Google (una sola vez)

1. **Proyecto.** En [Google Cloud Console](https://console.cloud.google.com/), crear un proyecto (por ejemplo «Turnia Salud»).
2. **API.** En APIs y servicios → Biblioteca, habilitar **Google Calendar API** (y **Google Sheets API** para la planilla de Turnia: ver `GOOGLE_SHEETS.md`).
3. **Pantalla de consentimiento** (Google Auth Platform):
   - Tipo de usuario **Externo**.
   - Nombre «Turnia Salud», email de soporte y email del desarrollador.
   - En **Acceso a los datos**, agregar estos permisos:
     - `openid`
     - `.../auth/userinfo.email`
     - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
     - `https://www.googleapis.com/auth/calendar.events`
   - En **Público**, agregar como **usuarios de prueba** las cuentas de Google que se van a conectar (hasta 100).
4. **Credenciales.** Crear ID de cliente OAuth → **Aplicación web**.
   - URI de redireccionamiento autorizado: `https://turniasalud.vercel.app/api/google/callback`.
   - Para probar en local, agregar también `http://localhost:3000/api/google/callback`.
5. **Vercel** → Settings → Environment Variables (Production):
   - `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`, las del paso 4.
   - Opcional: `GOOGLE_TOKEN_KEY`, un texto largo al azar que cifra los tokens. Si no está, se usa `SESSION_SECRET`. Si se cambia cualquiera de las dos, hay que volver a conectar las cuentas.
   - Después de cargarlas, hacer un redeploy.
6. **Reintentos.** En n8n, un workflow que cada 10 minutos haga `POST https://turniasalud.vercel.app/api/automations/calendario`, con el header `x-turnia-secret` (el mismo de las otras automatizaciones).
7. **Panel.** Configuración → Calendario → **Conectar Google Calendar**, y elegir el calendario de cada profesional.

## Antes de usarlo con clínicas reales

- **Modo prueba.** Mientras la app esté en modo prueba:
  - Solo se conectan los usuarios de prueba.
  - **Google vence el permiso a los 7 días.** El panel avisa «Reconectar».
- **Publicar la app.** Para clínicas reales hay que publicarla y pasar la **verificación de Google**. `calendar.events` es un permiso sensible. Google suele pedir:
  - Dominio propio verificado (por ejemplo turnia.com.ar), con la home y la política de privacidad publicadas ahí.
  - Explicar para qué se usa cada permiso.
  - Un video corto mostrando la conexión.

  Lleva días o semanas.
- **Un aviso en la web.** La política de privacidad de la web (`/privacidad`) tendría que mencionar qué se lee y qué se escribe en Google Calendar.

## Próximas etapas (no hechas)

- Avisos instantáneos de Google (`events.watch`) en lugar de releer cada 2 minutos.
- Que cada profesional conecte su propia cuenta.
- Outlook / Microsoft 365 con el mismo esquema.
