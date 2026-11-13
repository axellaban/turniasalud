---
name: qa-turnia
description: QA autónomo de producción de Turnia (turniasalud.app), igual que el de habita. Revisa errores y despliegue, analiza en PostHog las sesiones reales de las demos personales (/p/<código>) y de la web, recorre con Playwright las páginas públicas, la demo personal (escritorio, celular, tablet, red lenta y navegador de WhatsApp) y los caminos de error de los formularios, corrige lo roto con su test, lo publica y verifica en producción, y anota el resultado en QA_TURNIA.md. Usar cuando se pida «QA de Turnia», «correr el QA de Turnia» o desde la tarea programada.
---

# QA autónomo de Turnia

Objetivo: encontrar en producción errores reales y problemas de usabilidad en la demo personal, la web y el panel. Lo roto se corrige y se publica. Lo de usabilidad se registra para que se evalúe. Al final, un resumen corto: lo encontrado, lo corregido (con el PR), lo registrado y lo que no se pudo hacer.

Se ejecuta completo, paso por paso. Solo se saltea lo que este skill excluye o un bloqueo real (sin acceso, sin credenciales), que se reintenta antes de darlo por perdido. El estado es `completo` solo si se hizo todo; si faltó algo, es `parcial`, con cada faltante y su motivo.

## Reglas que no se rompen

- **Plata:** no comprar créditos ni planes y no completar pagos.
- **Generaciones:** como máximo una conversación con Sofi por corrida, la mínima: por chat, en escritorio, con un solo mensaje. Esa prueba crea un pedido de demo (lead): anotarlo en el registro.
- **WhatsApp:** nunca mandar mensajes a números reales. Los formularios públicos (`/probar-demo`, «Pedí una demo») se prueban solo por sus caminos de error.
- **Demos de prospectos:** siempre con `?vista=panel` (no cuenta como visita ni se vincula al prospecto) y con `localStorage.turnia_internal` marcado.
- **Privacidad:** los prospectos son personas reales. Nunca copiar nombres, códigos de demo, teléfonos ni IDs de PostHog a archivos del repo, commits, PRs ni al resumen.
- **Repositorio público:** en el repo no van cantidades de sesiones, tasas, enlaces a grabaciones ni IDs de sesión. Los patrones se describen con palabras (`aislado`, `repetido`).
- **Base de datos:** sin acceso directo desde la nube. No se escribe en producción salvo por la interfaz.
- **Usabilidad:** no se implementa por iniciativa propia. Se registra con su identificador `UX-NNN` en `QA_TURNIA.md`. Solo se corrige y mergea lo roto: errores, flujos que no terminan, textos técnicos o en inglés, contenido tapado, scroll horizontal, links que no llevan a ningún lado.
- **Tests:** nunca saltear, borrar ni desactivar un test para que pase.
- **Duplicados:** antes de corregir, leer las listas de `QA_TURNIA.md`, `git log --oneline -30` y los PR abiertos.

## Datos fijos

- Producción: `https://turniasalud.app`. El dominio `turniasalud.vercel.app` redirige con un 308 (OBS-001).
- PostHog: proyecto 518346 en US Cloud, con la API `query` (HogQL) y la clave `POSTHOG_PERSONAL_API_KEY`. Tráfico interno: `properties.is_internal`. Filtrar `properties.$host = 'turniasalud.app'`: `loreado.vercel.app` manda eventos al mismo proyecto (OBS-004).
- Eventos de la demo personal y lo que no se mide: [`ANALITICA.md`](../../../ANALITICA.md).
- Panel: con `PANEL_PASSWORD` en el entorno. Si falta, el panel queda sin revisar y se avisa.
- Vercel: la API no está disponible desde la nube. El despliegue se ve en el estado «Vercel» del commit en GitHub y en `/api/health`.

## Tipo de corrida

Mirar la hora de Argentina (`TZ=America/Argentina/Buenos_Aires date +%H`):

- **Mañana (antes de las 13 h): corrida completa.** Pasos 1 a 8, todas las pantallas.
- **Tarde (13 h o después): corrida liviana.** Pasos 1, 2, 3, 4 (solo la demo personal y la home, en escritorio e iPhone 13) y 6 a 8. Sin la conversación con Sofi, salvo que la mañana haya dejado un arreglo de la demo sin confirmar.

Si se pide a mano «QA completo», hacer la completa a cualquier hora.

## Pasos

### 1. Preparar
Anotar la hora real de inicio, el commit de `origin/main` y el estado del despliegue (GitHub, contexto «Vercel»). Revisar `/api/health`.

### 2. Errores y despliegue
- `/api/health` tiene que dar `ok` en base, ElevenLabs y herramientas.
- Comprobar que el dominio de `APP_URL` no redirija: un POST a `/api/agent/tools/consultar_disponibilidad` tiene que dar 401, no 308. Si redirige, OBS-001 sigue abierta.
- Sin logs de Vercel, los errores del navegador solo se ven en las corridas de Playwright (OBS-006).

### 3. Sesiones reales en PostHog
Ventana: desde `PostHog revisado hasta` del registro anterior (o 72 h). Sin tráfico interno, solo `$host = 'turniasalud.app'`.
- **Cobertura de grabación:** sesiones con grabación (`session_replay_events`, `start_time`) contra sesiones con `$pageview`.
- **Demo personal** (`/p/*`, `surface = 'demo_personal'`), por dispositivo y navegador. Reconstruir cada sesión en orden: `$pageview`, `personal_demo_viewed`, clics (`$autocapture`), `demo_conversation_*`, `demo_mode_switched`, `demo_closing_viewed`, `cta_clicked`. Mirar:
  - rebote rápido;
  - fallas al empezar (`demo_conversation_failed.error_kind`);
  - paso al chat;
  - si llegan al cierre y tocan «Reenviar» o «Escribirle a Axel».
- **Links rotos:** `$pageview` de `/p/*` sin `personal_demo_viewed` en la misma sesión. Así apareció el link con «):» del 13/11.
- **Web:** home, `/probar-demo` (`demo_form_*`), `/pricing` (`lead_form_*`), `cta_clicked`.
- **Velocidad:** `$web_vitals` (LCP, INP, CLS) por dispositivo en `/p/*`.
- **Qué hacer con cada patrón:** si es roto, reproducirlo en el paso 4 y corregirlo; si es usabilidad, `UX-NNN`; si son pocos casos, `OBS-NNN`.

### 4. Playwright
Chromium del entorno (`require("playwright")`). Pantallas: escritorio 1366×900, `iPhone 13`, `Galaxy S8` e `iPad (gen 7)`.

- **Red lenta** con CDP: `latency 150`, bajada de 1,6 Mbps, subida de 750 kbps.
- **Navegador de WhatsApp:** user agent de Android con `WhatsApp/`.
- **En cada página:**
  - errores de `console` y `pageerror`, y respuestas ≥ 400 del dominio (los `ERR_ABORTED` de prefetch y audios son esperables);
  - scroll horizontal;
  - textos con `undefined`, `null`, `NaN` o en inglés;
  - axe `wcag2a`/`wcag2aa` (`serious` y `critical`), en escritorio e iPhone;
  - zonas táctiles de menos de 44 px en celular;
  - LCP;
  - captura de pantalla completa, que se mira: armar hojas de contacto con PIL para ver todas.
- **Flujos:**
  1. **Páginas públicas:** todas las que se alcanzan desde la home, más `/pricing`, `/probar-demo`, `/privacidad` y `/p/<inexistente>`.
  2. **Demo personal** (`/p/<código>?vista=panel`), en las cuatro pantallas, con red lenta y con el navegador de WhatsApp:
     - la esfera visible sin scrollear;
     - la ficha abre y cierra con Escape;
     - la voz sin permiso de micrófono pasa al chat con su aviso;
     - el campo de chat, el botón Enviar y las sugerencias se ven.
  3. **Una conversación** (completa, solo escritorio): un mensaje con Enter, esperar la respuesta (hasta 60 s) y leerla. Si Sofi dice que la agenda o el sistema no responden, es OBS-001 o una falla de herramientas. Después, «Terminar la conversación» y revisar el cierre: «Reenviárselo a los doctores» (`wa.me/?text=`) y «Escribirle a Axel».
  4. **Vista previa:** `og:title`, `og:description` y `og:image` de la demo (con user agent de WhatsApp) y de la web. La imagen tiene que responder 200 `image/jpeg`, sin redirección.
  5. **Caminos de error:**
     - `/probar-demo` vacío, con web inválida, sin red (`context.setOffline(true)`) y sin web con el nombre vacío;
     - «Pedí una demo» vacío y con email inválido;
     - el foco con Tab;
     - un link de demo con signos al final (`/p/<código>):`) tiene que redirigir a la demo.
  6. **Panel** (si hay `PANEL_PASSWORD`): Prospección, Demos, Follow-up y Probar a Sofi, en escritorio y celular. Sin enviar mensajes.

### 5. Priorizar
1. **Roto:** se corrige.
2. **Usabilidad con evidencia de PostHog:** `UX-NNN`.
3. **Usabilidad vista solo en el recorrido:** `UX-NNN`.

### 6. Corregir y publicar
- Arreglo mínimo en la causa, con test de regresión (vitest).
- Correr:
  - `npx eslint src --quiet` y `npx tsc --noEmit -p .`;
  - `TEST_DATABASE_URL=… npx vitest run --maxWorkers=2` (con Postgres local: `service postgresql start`);
  - `npm run build`.
- Si toca páginas, verificar en local con `next start` y una base de prueba.
- PR a `main` (sin cobros de por medio): esperar el check «verificar», mergear, esperar el despliegue y repetir en producción el paso que fallaba.

### 7. Registrar
Agregar en `QA_TURNIA.md`, debajo de «Resultados», `### QA AAAA-MM-DD am|pm` con la plantilla. Actualizar las listas: sacar lo resuelto, sumar lo nuevo con el número siguiente y marcar lo que se repite. Los identificadores no se reutilizan. Va en el mismo PR que los arreglos, o solo si no hubo arreglos.

### 8. Resumen
Corto y en castellano:
- qué se probó;
- qué se corrigió (con enlaces);
- qué se registró;
- los 2 o 3 hallazgos más importantes de PostHog;
- qué no se pudo hacer.
