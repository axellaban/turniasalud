# Google Sheets

Actualizado: 26/10/2026. **Código hecho y probado con Google simulado** (`src/test/turnia-sheet.integration.test.ts`). Usa la misma conexión con Google que Calendar. Para usarlo faltan dos pasos en Google Cloud (abajo).

## Cómo funciona

- **Se conecta con un botón.** Panel → Prospección → **Google Sheets** → «Conectar con Google». Se elige la cuenta, se acepta el permiso y listo: no hay que pegar código ni armar nada en la planilla.
- **Turnia crea la planilla** «Turnia · Prospección y pedidos de demo» en el Drive de esa cuenta, con dos pestañas:
  - **Prospección:** cada odontólogo con su consultorio, teléfono (y de quién es), estado, mensajes, próximo paso, si abrió o probó su demo, el link de su demo, señales y notas.
  - **Pedidos de demo:** los del formulario «Pedí una demo» y los de quienes probaron la demo (navegador, WhatsApp o Telegram), con su estado y las notas del panel.
- **Se actualiza sola.** Cada cambio la copia después de responder (`after()`): un contacto, un estado, una edición, una importación, una demo abierta o probada, un pedido nuevo, editado o borrado. También hay «Copiar ahora».
- **Es un espejo.** Cada copia reescribe las dos pestañas completas (los datos desde A1 y borra lo que sobraba abajo): lo que se escriba a mano en ellas se pisa. Para cuentas o filtros propios, otra pestaña. Si alguien borra una de las dos, vuelve en la próxima copia.
- **Una copia por vez.** Si llega un cambio mientras se copia, queda anotado y esa misma copia da otra vuelta al terminar: nunca gana una copia vieja. Una copia colgada se libera a los 2 minutos.
- **Si algo falla, Turnia sigue igual.** El error queda en la página:
  - Si se borró la planilla, «Crear una planilla nueva» la vuelve a crear con todo.
  - Si Google pide reconectar (permiso revocado o vencido), «Reconectar». Con la misma cuenta, sigue la misma planilla.
  - Si falta habilitar Google Sheets API, la cuenta queda conectada y la página lo dice. Una vez habilitada, «Crear la planilla».
  - Mientras tanto no se le pide nada a Google.
- **Seguridad.**
  - El permiso es `drive.file`: Turnia solo ve las planillas que creó ella, nunca el resto del Drive. Google lo considera un permiso no sensible.
  - Los tokens se guardan cifrados como los de Calendar (`src/lib/calendar/crypto.ts`), con el mismo estado firmado del OAuth.
  - Solo la conecta el administrador de Turnia.
  - Al desconectar se revoca el permiso. La planilla queda en el Drive, pero deja de actualizarse.
  - Si la misma cuenta tiene Google Calendar conectado, no se revoca: Google revoca todo junto y cortaría también la agenda. Calendar hace lo mismo al revés.
- **Pensado para las clínicas.** La conexión (`sheets_connections`) es por dueño: hoy `turnia`; después, cada clínica con la suya.

Código: `src/lib/sheets/` (`google-sheets.ts`, la API REST; `turnia-sheet.ts`, la conexión, las pestañas y la copia), `src/app/api/google/` (conectar con `?para=planilla` y la misma vuelta que Calendar) y `src/app/panel/(app)/prospeccion/planilla/`.

## Lo que hay que hacer en Google (una sola vez)

En el mismo proyecto de Google Cloud de Calendar: las credenciales (`GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`) y la dirección de vuelta (`https://turniasalud.vercel.app/api/google/callback`) son las mismas.

1. **API.** APIs y servicios → Biblioteca → **Google Sheets API** → Habilitar.
2. **Permiso.** Google Auth Platform → **Acceso a los datos** → Agregar o quitar permisos → tildar `.../auth/drive.file` («ver, editar, crear y borrar solo los archivos de Google Drive que usás con esta app») → Actualizar → Guardar.
3. **Panel.** Prospección → Google Sheets → «Conectar con Google». La cuenta tiene que estar entre los usuarios de prueba (la de Calendar ya está).

**Los 7 días.** Mientras la app esté en modo prueba, Google vence el permiso a los 7 días y la página pide «Reconectar», igual que en Calendar. Para que no venza hay que publicarla: Google Auth Platform → Público → «Publicar app».

- Para la planilla alcanza: `drive.file` no es sensible y no hace falta la verificación de Google.
- Calendar sí usa permisos sensibles. Hasta que se verifique la app, Google le muestra a quien conecta Calendar un aviso de «app no verificada» (se sigue con «Configuración avanzada»).

## Próximas etapas (no hechas)

- **Clínicas:** cada una conecta su cuenta y **elige una planilla que ya tiene** (con el selector de archivos de Google, que también funciona con `drive.file`).
  - Turnia importa de ahí sus pacientes y su historial, con la misma lectura de columnas que la importación de Excel/CSV de Campañas, y la vuelve a leer cada tanto.
  - El selector necesita, además, una API key de navegador y habilitar Google Picker API.
- **Editar desde la planilla:** hoy es solo de Turnia hacia la planilla. Que un cambio en la planilla vuelva a Turnia necesita leerla cada tanto y resolver qué gana si cambió en los dos lados.
- **Pedidos de demo con Apps Script** (`/panel/demos/planilla`): sigue andando para quien prefiera una planilla propia sin conectar la cuenta. Con la conexión de Google ya no hace falta.
