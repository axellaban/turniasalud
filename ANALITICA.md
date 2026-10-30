# Analítica (PostHog)

Qué se mide en Turnia, dónde sale cada evento y cómo leerlo. La arquitectura copia la de Amobla/habita (`docs/ANALITICA_DEMOS.md` de ese repo), con una parte que Amobla no tiene: **eventos del servidor**, porque en Turnia las conversiones grandes (los mensajes de la prospección, la demo por WhatsApp) no pasan en el navegador.

Proyecto: **Turnia Salud** en PostHog US Cloud (project id 518346). El token (`phc_…`) es público por diseño: solo escribe eventos. Está en `src/lib/analytics-shared.ts`; `NEXT_PUBLIC_POSTHOG_KEY` lo reemplaza.

## 1. Cómo está armado

| Pieza | Archivo | Qué hace |
| --- | --- | --- |
| Arranque | `src/instrumentation-client.ts` | Inicia PostHog **solo en producción** (o con `NEXT_PUBLIC_POSTHOG_KEY`). Descarta todo evento del panel y de `/demo`, oculta los tokens de las demos y pausa la grabación al entrar al panel. |
| Proxy | `next.config.ts` (`/ingest`) | Los eventos van por el propio dominio: los bloqueadores de anuncios no los cortan. |
| Eventos del navegador | `src/lib/analytics.ts` | `track` (con `surface` en cada evento), super propiedades, `identify`, `trackMilestone`. |
| Comportamiento | `src/lib/interaction-tracking.ts` | Clics en llamados a la acción (`data-cta`), tráfico interno, tiempo activo, escucha de audios. |
| Formularios | `src/lib/form-tracking.ts` | Visto, empezado, enviado y error de `/probar-demo` y «Pedí una demo». |
| Eventos del servidor | `src/lib/analytics-server.ts` | API de captura de PostHog (sin librería), después de responder (`after`). Solo producción. |
| Compartido | `src/lib/analytics-shared.ts` | Rutas privadas, ocultar tokens, zonas del sitio, `cta()`, ids de persona. |

## 2. Personas

- **Visitante anónimo:** el id que pone PostHog en el navegador. Sin perfil de persona (configuración por defecto, `identified_only`); los embudos lo cuentan igual por su id.
- **Odontólogo de la prospección: `prospecto:<código>`.** Es la misma persona cuando:
  - abre su link `/p/<código>`: el navegador se identifica;
  - Axel registra en el panel el saludo, la demo, los seguimientos y los cambios de estado: eventos del servidor.

  Así se ve su recorrido completo. Lo que hizo antes como anónimo en ese navegador se une a la persona.
- **Demo del navegador:** al empezarla, el navegador manda su id (`ph`) a `/api/demo/iniciar` y queda en `demo_sessions.analytics_id`. La preparación de la demo (evento del servidor) cae en la misma persona.
- **Demo por WhatsApp o Telegram: `demo:<id de la demo>`.** No hay navegador; sus eventos se agrupan por demo, sin perfil.

**Propiedades de la persona de la prospección** (sin nombre ni teléfono):

| Cuándo | Propiedades |
| --- | --- |
| Siempre | `prospect_priority`, `prospect_zone`, `prospect_specialty`, `prospect_phone_kind` (`movil`, `consultorio`, `fijo`), `prospect_status`, `prospect_touches` |
| Solo la primera vez | `prospect_code` |

**Super propiedades del navegador**:

| Propiedad | Cuándo |
| --- | --- |
| `app_env` (`production`, `preview`, `local`) | siempre |
| `tracking_version` (`1`) | siempre |
| `is_internal` | tráfico del equipo |
| `outreach_code` | última demo personal vista |
| `first_outreach_code`, `first_demo_kind` | primer contacto, no se pisa |

## 3. Tráfico interno

Lleva `is_internal = true` en los eventos y en la persona:
1. El navegador del **administrador** que abrió el panel (`marca-interna.tsx`). Los consultorios que entran a su panel no se marcan.
2. La demo personal abierta desde el panel (`/p/<código>?vista=panel`). Además **no se identifica** como el odontólogo.
3. Cualquier dispositivo que abrió una página con `?turnia_interno=1`, para el celular de pruebas. `?turnia_interno=0` lo desmarca.

Un dispositivo marcado nunca se identifica como un prospecto, aunque abra su link. En los tableros se filtra `is_internal` ≠ `true` (ver 6).

## 4. Privacidad

- **El panel no se mide ni se graba**, porque tiene datos de pacientes. Tampoco `/demo`. `before_send` descarta cualquier evento con esas URLs y la grabación se pausa al entrar.
- **Los tokens no salen:** los de `/probar-demo/sesion/<token>` y `/probar-demo/llamada/<token>` abren la demo y gastan minutos de ElevenLabs, así que salen como `[oculto]` en URLs, referrer y propiedades.
- **Nada de lo que se escribe:**
  - Ningún evento lee valores de formularios, emails, teléfonos ni el texto de las conversaciones con Sofi; solo cuántos mensajes hubo.
  - Los botones se identifican por `data-cta`, no por su texto.
  - Las grabaciones ocultan los campos de texto (defecto de PostHog).
- Lo continuo (tiempo, scroll, audio) se resume en un evento por tramo.

## 5. Catálogo de eventos

Todos los del navegador llevan `surface`:

| `surface` | Página |
| --- | --- |
| `home` | la home |
| `demo_personal` | `/p/<código>` |
| `probar_demo` | `/probar-demo` |
| `demo_web` | la demo del navegador |
| `demo_llamada` | la llamada web de la demo de WhatsApp |
| `pedi_una_demo` | «Pedí una demo» |
| `escucha` | ejemplos de conversaciones |
| `landing` | especialidades, soluciones y organizaciones |
| `producto` | plataforma, recepción, activa y nosotros |
| `otra` | el resto |

PostHog suma solo `$pageview`, `$pageleave`, autocaptura, `$device_type`, UTM y el vínculo a la grabación.

### Prospección (servidor, persona `prospecto:<código>`)

| Evento | Cuándo | Propiedades |
| --- | --- | --- |
| `prospect_greeting_sent` | «Saludar por WhatsApp» (el saludo sin link) | `channel`, `touch_number` = 0 |
| `prospect_pitch_sent` | El primer mensaje con la demo | `channel`, `touch_number` = 1, `opened_demo`, `tried_demo` |
| `prospect_followup_sent` | Seguimientos (2.º y 3.º mensaje) | ídem |
| `prospect_offline_contact_logged` | Llamada o visita registrada | `channel` |
| `prospect_prior_contact_logged` | «Ya le había escrito» | `channel` |
| `prospect_status_changed` | Cambio de estado | `status_from`, `status_to` (`respondio`, `reunion`, `cliente`, `no_interesa`, `sin_canal`, `baja`, …) |
| `prospect_contact_undone` | «Deshacer contacto» | `contact_kind` (`saludo`, `mensaje`, `llamada`, `visita`). PostHog no borra eventos: el anterior queda, este dice que fue una prueba |

Todos llevan `prospect_priority` y `prospect_phone_kind`, y actualizan las propiedades de la persona.

### Demo personal (`/p/<código>`, navegador)

| Evento | Propiedades |
| --- | --- |
| `personal_demo_viewed` | `prospect_*`, `with_web`, `demo_ready` (si la demo estaba disponible), `preview` (vista desde el panel) |
| `demo_started` | `source` = `personal`, `via`, `with_web`. Toca «Probar la demo». Sale por beacon |
| `demo_start_failed` | `error_kind` (`api_<status>`, `network`) |
| `demo_active_time` | Por tramos; el total de la visita es la suma. `active_ms`, `visible_ms`, `max_scroll_pct`, `end_reason`, `demo_kind` |

### `/probar-demo` (navegador)

| Evento | Propiedades |
| --- | --- |
| `demo_form_viewed` | `mode` (`web` o `nombre`), `prefilled` (link personalizado), `available` |
| `demo_form_started` | `first_field`. Primer carácter escrito o autocompletado |
| `demo_form_submitted` | — |
| `demo_form_error` | `error_kind`: `invalid_web`, `missing_name`, `unavailable` |
| `demo_via_offered` | En el celular con WhatsApp activo: se le ofrece elegir |
| `demo_started` | `source` = `probar_demo`, `via` (`navegador` o `chat`), `with_web`, `prefilled` |
| `demo_start_failed` | `error_kind` (`api_429` = límite de demos, `api_409` = no disponible, `network`) |

### La demo en el navegador (`/probar-demo/sesion/…`)

| Evento | Lado | Propiedades |
| --- | --- | --- |
| `demo_prepared` | servidor | `via`, `with_web`, `pages_read`, `preparation_ms` |
| `demo_preparation_failed` | servidor | `error_kind` (`scrape` = no se pudo leer la web, `other`), `preparation_ms` |
| `demo_ready_seen` | navegador | `waited_ms`, `with_web` |
| `demo_unavailable_seen` | navegador | `reason` (`error`, `timeout`, `expired`) |
| `demo_wait_abandoned` | navegador | `waited_ms`. Se fue mientras se leía la web |
| `demo_conversation_started` | navegador | `mode` (`voz`, `chat`), `with_suggestion`, `remaining` |
| `first_demo_conversation` | navegador | Una vez por navegador |
| `demo_conversation_ended` | navegador | `mode`, `duration_ms`, `user_messages`, `agent_messages`, `end_reason` |
| `demo_conversation_failed` | navegador | `error_kind`: `mic_denied`, `mic_missing`, `start_error` |
| `demo_conversation_error` | navegador | Se cortó durante la conversación |
| `demo_mode_switched` | navegador | `to` |
| `demo_suggestion_used` | navegador | `suggestion` (índice de la idea), `connected` |
| `demo_active_time` | navegador | Igual que en la demo personal, con `demo_kind` = `web` |

La llamada web de la demo de WhatsApp (`/probar-demo/llamada/…`) usa `demo_conversation_started/ended/failed` con `demo_kind` = `llamada_web`.

### Demo por WhatsApp o Telegram (servidor, persona `demo:<id>`)

| Evento | Propiedades |
| --- | --- |
| `demo_requested` | `via` (`whatsapp`, `telegram`), `new_lead`. Mandó su web |
| `demo_prepared` / `demo_preparation_failed` | Como arriba |
| `demo_mode_chosen` | `mode` (`chat`, `audio`, `llamada`), `from_status` |
| `demo_message_sent` | `mode`, `audio` (mandó un audio). Un mensaje del interesado al agente |
| `demo_exited` | Escribió SALIR |

### Web

| Evento | Propiedades |
| --- | --- |
| `cta_clicked` | `cta_id`, `cta_location`, `cta_destination`, `cta_kind` (`conversion` o `navigation`) |
| `demo_audio_played` | `audio_id` (el slug del audio), `with_audio` (falso = lectura animada sin audio). Primera vez que se reproduce en la visita |
| `demo_audio_listened` | Cada vez que se corta. `listened_ms`, `max_pct`, `completed`, `end_reason` (`pause`, `ended`, `hidden`, `pagehide`) |
| `lead_form_viewed` / `_started` / `_submitted` / `_error` | `origen` (la página del formulario), `compacto` |
| `lead_created` | `origen`. Pedido de demo guiada guardado. `first_lead_at` en la persona |

**Llamados a la acción medidos (`cta_id`):**

| `cta_id` | Destino | Dónde |
| --- | --- | --- |
| `try_demo` | `/probar-demo` | `header`, `header_mobile`, `hero`, `home_section`, `closing`, `footer`, `guided_demo_page` |
| `guided_demo` | «Pedí una demo» | `header`, `header_mobile`, `product_hero`, `product_closing`, `closing`, `footer`, `about`, `specialty_hero`, `probar_demo_page`, `demo_web` |
| `hear_call` | — | `hero` (ir a la llamada de ejemplo) |
| `listen_samples` | — | `home_section` |
| `retry_demo` | — | `demo_unavailable` |
| `panel_login` | — | `header`, `header_mobile`. Navegación |

Para medir un botón nuevo: `{...cta("id", "zona", "destino")}` de `@/lib/analytics-shared`.

## 6. Configurar el proyecto en PostHog (una vez)

1. **Session replay:**
   - Settings → Session replay → activar «Record user sessions». Se graba la web y las demos; el código pausa la grabación en el panel.
   - Dejar activado «Mask all inputs».
   - Para más seguridad, en «URL blocklist» agregar `/panel` y `/demo`.
2. **Excluir el tráfico interno de todos los gráficos:**
   - Settings → Product analytics → «Filter out internal and test users».
   - Agregar el filtro de evento `is_internal` «is not» `true`.
   - Activar «Enable this filter on all new insights».
3. **Dominio de la web:** en Settings → Web analytics → Authorized URLs (también sirve para la toolbar), agregar `https://turniasalud.vercel.app` (y el dominio propio, si se suma).

## 7. Tableros propuestos

En todos: filtro `app_env` = `production` y tráfico interno excluido (paso 2 de arriba).

### Prospección (Insights → New → Funnel, conversión por persona, ventana 30 días)

1. `prospect_greeting_sent`
2. `prospect_pitch_sent`
3. `personal_demo_viewed` con `preview` = `false`
4. `demo_started` con `source` = `personal`
5. `demo_conversation_started`
6. `prospect_status_changed` con `status_to` = `respondio`
7. `prospect_status_changed` con `status_to` = `reunion`
8. `prospect_status_changed` con `status_to` = `cliente`

- **Desgloses:** propiedad de persona `prospect_phone_kind` (¿convierte mejor el celular propio o el del consultorio?), `prospect_priority` y `prospect_zone`.
- **Respuestas sin probar la demo:** como alguien puede responder sin abrirla, sumar un segundo embudo con los pasos 2 → 6, para ver cuántos responden.
- **Complementos:**
  - tendencia semanal de `prospect_pitch_sent` y de `prospect_status_changed` (`respondio`);
  - tabla de `prospect_status_changed` por `status_to`;
  - `prospect_followup_sent` por `touch_number` y `opened_demo` (¿el seguimiento a quien abrió la demo responde más?).

### Web y demo desde `/probar-demo` (embudo, por persona, ventana 1 día)

1. `$pageview` (cualquier página)
2. `cta_clicked` con `cta_kind` = `conversion`
3. `demo_form_viewed`
4. `demo_form_started`
5. `demo_started` con `source` = `probar_demo`
6. `demo_prepared`
7. `demo_conversation_started`
8. `demo_conversation_ended`

- **Desgloses:** `$device_type`, `via`, `with_web`, `cta_id` del paso 2 y la fuente (`$referring_domain`, `utm_source`).
- **Embudo de la demo guiada:** `lead_form_viewed` → `lead_form_started` → `lead_form_submitted` → `lead_created`, desglosado por `origen`.
- **Dónde se pierde:**
  - `demo_form_error` por `error_kind`;
  - `demo_start_failed` por `error_kind`;
  - `demo_preparation_failed` por `error_kind`;
  - `demo_wait_abandoned` (mediana de `waited_ms`);
  - `demo_conversation_failed` por `error_kind` (cuántos niegan el micrófono).

### Uso de las demos

- `demo_conversation_ended`:
  - mediana de `duration_ms`, por `mode` (voz contra chat);
  - promedio de `user_messages`;
  - desglose por `surface` (`demo_web` contra `demo_llamada`).
- `demo_mode_switched` y `demo_suggestion_used` por `suggestion`.
- Tiempo activo: suma de `demo_active_time.active_ms` por sesión (mediana), por `demo_kind`.
- Audios de la home:
  - `demo_audio_played` por `audio_id`;
  - mediana de `max_pct` y porcentaje de `completed` de `demo_audio_listened`.
- Llamados a la acción: `cta_clicked` por `cta_id` y `cta_location`.
- WhatsApp: `demo_requested` → `demo_prepared` → `demo_mode_chosen` (desglose por `mode`) → `demo_message_sent`, por persona.

### Recorrido de cada odontólogo

- **Personas:** People → buscar `prospecto:pagani-ats`. Muestra en orden los mensajes registrados, la apertura de su link, la demo y sus conversaciones, con las grabaciones.
- **Grabaciones:** Session replay, filtrado por sesiones con `personal_demo_viewed` o `demo_conversation_started`.
- **SQL de todos los recorridos de la prospección:**

  ```sql
  SELECT timestamp, distinct_id, event, properties.channel, properties.touch_number,
         properties.status_to, properties.mode, properties.duration_ms, properties.`$device_type`
  FROM events
  WHERE distinct_id LIKE 'prospecto:%'
    AND coalesce(properties.is_internal, false) = false
    AND timestamp > now() - INTERVAL 30 DAY
  ORDER BY distinct_id, timestamp
  LIMIT 2000
  ```

## 8. Validación en producción

Con un celular marcado con `?turnia_interno=1`, los eventos llegan igual pero marcados. En PostHog → Activity, filtrar `is_internal = true`.

1. **Web.**
   - Pasos: home → «Probar demo» del hero → escribir una web → probar por voz y por chat → salir.
   - Esperar:
     - `cta_clicked` (`try_demo`, `hero`);
     - `demo_form_viewed`, `demo_form_started` y `demo_form_submitted`;
     - `demo_started`, `demo_prepared` y `demo_ready_seen`;
     - `demo_conversation_started/ended` con duración y mensajes;
     - `demo_active_time`.
2. **Token oculto.** En Activity, la URL de la demo tiene que verse como `/probar-demo/sesion/[oculto]`.
3. **Panel.** Abrir el panel y navegar: no tiene que aparecer ningún evento con `/panel`.
4. **Prospección.**
   - Desde Panel → Prospección, registrar el saludo y la demo a un contacto de prueba, y deshacerlos.
   - Esperar `prospect_greeting_sent`, `prospect_pitch_sent` y `prospect_contact_undone` en la persona `prospecto:<código>`.
5. **Demo personal.** Abrir `/p/<código>` del contacto de prueba desde un navegador **sin** marcar (ventana privada) y esperar `$identify` y `personal_demo_viewed` en la misma persona del paso 4. Con `?vista=panel`, en cambio, sale `preview = true`, `is_internal` y sin identificar.

**Verificado localmente** (30/10) con un colector en lugar de PostHog y Chromium, sobre un build de producción:

| Revisión | Resultado |
| --- | --- |
| Llamado a la acción y formularios | `cta_clicked` y los pasos de los dos formularios llegan; `lead_created` también |
| Token de la demo | sale como `[oculto]` |
| Panel | `/panel` no envía nada |
| Demo personal | `/p/<código>` identifica a `prospecto:<código>` con sus propiedades |
| Vista desde el panel | `?vista=panel` queda interno y sin identificar |
| Tiempo activo | `demo_active_time` sale al ocultar la pestaña |

**Ojo con los robots:** PostHog descarta los navegadores automatizados (Playwright, Selenium) y las vistas previas de WhatsApp. Para probar con un navegador automático hay que simular uno común.

## 9. Lo que no se mide (todavía)

- **Duración de la llamada por teléfono de la demo de WhatsApp** (ElevenLabs llama al celular). Está en el webhook post-llamada de ElevenLabs y no se manda a PostHog.
- **Las respuestas del agente en la demo por WhatsApp.** Solo se cuentan los mensajes del interesado.
- **El origen de cada link de prospección.** WhatsApp, Instagram o email llegan al mismo `/p/<código>` sin UTM. El canal se lee de `prospect_pitch_sent.channel`.
- **Salir navegando en la misma pestaña.** Los eventos de salida (`$pageleave`, el último tramo de `demo_active_time`) se pueden perder al navegar dentro de la misma pestaña. Igual que en Amobla, al ocultarla o cerrarla sí salen.
