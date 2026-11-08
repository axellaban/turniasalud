# Centro comercial y prospección: traspaso (08/11/2026)

Este documento es para quien siga este trabajo, sea una persona o una IA. No hace falta leer conversaciones anteriores.

El documento general del sistema está en Chapa Labs: [`docs/CENTRO_COMERCIAL.md`](https://github.com/facundogregorini-lab/chapa-labs/blob/main/docs/CENTRO_COMERCIAL.md). Explica cómo se conectan Chapa, habita. y Turnia, el contrato de la API, los pendientes en orden y las reglas. Este archivo agrega lo propio de Turnia.

## Qué es y dónde está

- **Chapa Labs** (`chapa-labs.vercel.app/prospecting`, repo `facundogregorini-lab/chapa-labs`) es la pantalla comercial única de Turnia y habita. Desde ahí se ejecuta la cola de Follow-up de Turnia.
- **Turnia es dueño de sus datos.** Chapa no copia nada: lee y escribe por `/api/prospeccion`, con `Bearer $PROSPECTING_API_SECRET` o `$METRICS_SECRET`.

| Qué | Dónde |
| --- | --- |
| La cola (situación, grupos, prioridad, bloqueos, programadas, orden) | `src/lib/sales/followup-plan.ts` (pura, con tests en `followup-plan.test.ts`) |
| Tomas, ejecución, respuestas, reprogramar, prioridad, responsable, resultados | `src/lib/sales/followup-queue.ts` |
| Etapas, versiones A/B y registro del envío (Panel → Follow-up) | `src/lib/sales/followup-stages.ts` y `src/lib/sales/followup.ts` |
| API para Chapa | `src/app/api/prospeccion/route.ts`: `GET ?vista=filas`, `GET ?vista=followup`, `POST { by, followup: { op } }`, más las acciones, mensajes, metas e importación de antes |
| Tablas | `sales_followup_state`, `sales_followup_claims`, `sales_followup_audit` y `sales_followup_executions.actor`, en `supabase/schema.sql` (el build las aplica) |
| Lectura diaria de WhatsApp | `src/lib/sales/whatsapp-sync.ts`: lee los chats de las dos líneas de WAHA y registra las respuestas (ver abajo) |
| Pruebas | `src/test/followup-queue.integration.test.ts` y `src/test/whatsapp-sync.integration.test.ts` (Postgres real) |
| Explicación funcional | [`PLAN_PROSPECCION.md`](PLAN_PROSPECCION.md) → «La cola, operada desde Chapa Labs» |

### Cómo decide la cola

- **Situación:** sale del estado de Prospección. La que se marca a mano vale mientras la persona siga en el mismo paso del embudo, y además cambia el estado en Prospección para que todo diga lo mismo.
- **Grupos y prioridad:** respuestas y demos por enviar van con prioridad alta; seguimientos, media; contactos nuevos, baja.
- **Orden dentro de cada grupo:** primero la prioridad de la lista (1 a 3), después los que pagan anuncios y después los que esperan hace más.
- **Bloqueos:** sin texto en la etapa, sin WhatsApp, posible duplicado, tope diario de saludos (la meta diaria de Prospección), fuera de horario y reprogramada.
  - El horario es de lunes a sábado, de 8:30 a 21; los contactos nuevos, hasta las 20. **Los domingos toda la cola aparece bloqueada: es lo esperado.**
- **Programadas:** las tres primeras etapas siguen la cadencia de Prospección (días hábiles, tres mensajes como máximo). Las siguientes salen 48 h después del último mensaje.
- **Tomas:** duran 10 minutos y se guardan con la hora del servidor de la app. Confirmar es idempotente, aunque la persona ya haya pasado de etapa.

### Lectura diaria de WhatsApp (las respuestas entran solas)

- **Qué hace:** una vez por día lee los chats de las dos líneas de la prospección: `WAHA_PROSPECCION` (el 0022) y `WAHA_PROSPECCION_5483` (el WhatsApp de Axel, desde donde sale la prospección). Cruza cada chat con la base por teléfono (los `@lid` se resuelven como en «Buscar sus chats») y lee los últimos 50 mensajes de cada persona de la base.
- **Qué guarda:** por persona y línea, en `sales_whatsapp_chats`, cuántos mensajes le mandamos, si contestó, cuándo, su último texto («Audio», «Imagen» si no tiene) y si el último mensaje es de ella. Cada lectura queda en `sales_whatsapp_syncs` con su resumen.
- **Qué cambia:** solo cuenta como respuesta lo que llegó **después de nuestro primer mensaje**. Si la persona estaba esperando (Por contactar, Contactado, o «Pide más adelante»), pasa a «Respondió» y a «Respuestas para atender» como Neutro, con su texto; quien la atienda la clasifica. Si ya se está hablando o está cerrada, la respuesta solo queda en la historia. Lo ya leído no se vuelve a aplicar.
- **Qué no hace:** no manda nada, no marca como leído y no cambia nada en WAHA (respeta la regla de no tocar `n8n/waha`).
- **Quién la dispara:** Chapa Labs, todos los días a las 8 de Argentina (cron de Vercel en chapa-labs), y su botón «Leer WhatsApp ahora». Por la API: `POST /api/prospeccion { by, followup: { op: "whatsapp-sync" } }`; si se pide antes de 10 minutos devuelve la última. La última lectura viene en `GET ?vista=followup` como `whatsapp` y en `GET ?vista=whatsapp`.
- **Si una línea falla:** el resumen dice cuál y por qué (sin configurar, sesión caída, o NOWEB sin historial: hay que prender el store de la sesión en WAHA para que devuelva chats y mensajes).
- **Lo que no ve:** lo que se mandó desde otro número que no esté en WAHA.

## La prospección al 08/11

- **Base:** 967 personas. La **lista 4** (alrededores de Mar del Plata: Tandil, Necochea, la Costa, Pinamar, Villa Gesell y consultorios de Mar del Plata que faltaban) **ya está importada**: son 258 personas, 154 con WhatsApp y 104 con fijo.
  - En Chapa aparecen como «Lista 4».
  - Las marcas «Google Ads» y «Meta Ads» salen de «Señales».
  - Los que pagan anuncios van con prioridad 1 y primero en la cola.
- **Volver a hablarles a los que pagan anuncios** (Mar del Plata y Miramar): son 15, ya marcados en «Señales» con la importación con «Reemplazar». Están en la cola con prioridad por anuncios. El ángulo del mensaje («ya invierten en pacientes nuevos; que Sofi conteste fuera de horario») está en [`PLAN_PROSPECCION.md`](PLAN_PROSPECCION.md) → «Volver a hablarles a los que pagan anuncios».
- **Las listas de personas no van a ningún repo.** Se entregan como archivo y se importan en Panel → Prospección → Importar lista, o por `POST /api/prospeccion { import: { csv, overwrite } }`.

### Cómo se armaron las listas (para repetirlo)

- **Fuentes:**
  - Google Maps, en vista limitada: unos 20 resultados por búsqueda, así que se hacen muchas búsquedas por ciudad y especialidad.
  - Las cartillas de OSDE (filial 32) y de OSPUNCPBA (Tandil y Necochea).
  - Las webs de cada consultorio, para conseguir el WhatsApp del profesional.
- **Repetidos:** se descartan contra la base por código, nombre más teléfono, y apellido más zona.
- **Quién paga anuncios:**
  - **Google:** el Centro de Transparencia de Anuncios de Google, buscando **por dominio** (la búsqueda por nombre da homónimos). Se hizo con SerpApi, motor `google_ads_transparency_center`, lo que requiere una clave de SerpApi propia.
  - **Meta:** la Biblioteca de Anuncios de Meta.
  - **Web del consultorio:** etiquetas en su web (`AW-`, `googleadservices` y el píxel de Meta).
  - Solo se marca a alguien cuando el anunciante coincide.
- **Límites:** no se esquivan bloqueos ni límites de los sitios (verificaciones de bots, 429).
- **Revisión pendiente:** el lunes 9/11 en horario de atención había que repetir las búsquedas de Google con anuncios para Mar del Plata y Miramar, cruzarlas con la base y anotar en «Señales» a los anunciantes nuevos. Quedó programado en la sesión de IA que hizo este trabajo; si no hay rastro de que se hizo, hacerlo a mano.

## Qué sigue, en orden

1. **Tanda real de 10** desde Chapa (Hoy → Turnia), en horario. Comprobar que la otra persona ve «Lo tiene…» y que el contacto aparece en Panel → Prospección.
2. **Login de Chapa.** Hoy está abierto por decisión del usuario; ver el documento de Chapa.
3. **Respuestas desde WAHA: hecho con la lectura diaria** (arriba). Falta mirar la primera lectura real y, si una línea dice «store», prender el historial de esa sesión en WAHA.
4. **Reglas editables y edición de versiones**, como en habita.
5. **Situaciones, tomas y bloqueos en Panel → Follow-up**, que sigue mostrando la versión anterior.
6. **Retirar pantallas repetidas** solo después de dos semanas sin diferencias entre Chapa y este panel.
