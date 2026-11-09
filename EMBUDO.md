# Embudo comercial de Turnia (seguimiento semanal)

Definido con el usuario el 1/11/2026. Es el embudo que se sigue cada semana, desde el primer saludo a un odontólogo hasta el cliente que paga. La tabla de abajo se actualiza una vez por semana; las definiciones no se cambian sin acordarlo.

## Las ocho etapas

| # | Etapa | Qué cuenta | De dónde sale |
| --- | --- | --- | --- |
| 1 | **Saludos enviados** | Odontólogos a los que se les mandó el saludo sin link (el Paso 1). | PostHog: `prospect_greeting_sent` |
| 2 | **Respondieron el saludo** | Contestaron el Paso 1: la primera respuesta registrada (pasó a «Respondió», por la lectura de WhatsApp o a mano) o se les mandó el Paso 2, que va solo a quien respondió. Desde el 09/11. | PostHog: `prospect_status_changed` con `status_to` = `respondio`, o `prospect_permission_sent` |
| 3 | **Demos enviadas** | Odontólogos a los que se les mandó el link de su demo personal (`/p/<código>`): el Paso 3 o el Seguimiento 1. | PostHog: `prospect_pitch_sent` |
| 4 | **Demos visitadas** | Abrieron su demo personal. No cuenta la vista desde el panel ni el tráfico interno. | PostHog: `personal_demo_viewed` con `preview` = `false` |
| 5 | **Hablaron con Sofi** | En al menos una charla de su demo (voz o chat) **la persona escribió o habló**. Abrir la llamada o el chat y no decir nada no cuenta: Sofi saluda primero. | PostHog: `demo_conversation_ended` con `user_messages` > 0 (en la base, `conversoSql`) |
| 6 | **Cuentas creadas** | Consultorios con acceso propio al panel: se les creó un código en Panel → Configuración → «Acceso del consultorio» y no se revocó. | Base: `clinic_access` |
| 7 | **Cuentas activas** | Cuentas que esa semana cumplieron el criterio de abajo. | Base: `conversations` y `appointments` |
| 8 | **Clientes pagos** | Consultorios que pagaron al menos un mes. Se registran marcando «Cliente» en Panel → Prospección **cuando entra el primer pago**, no cuando dicen que sí. | Base: `sales_outreach`, estado `cliente` |

### Criterio de cuenta activa

Una cuenta está **activa en una semana** si en esa semana se cumplen las dos condiciones:

1. Sofi atendió al menos a **3 pacientes distintos** de ese consultorio, por WhatsApp, teléfono, Telegram o web.
2. Sofi dio al menos **1 turno**. No cuentan los turnos que el consultorio cargó a mano en el panel.

Por qué este criterio:

- **Se mide lo que se vende.** Turnia es una recepcionista: una cuenta activa es un consultorio donde atiende pacientes de verdad. Entrar al panel o configurarlo no alcanza.
- **No cuentan las pruebas.** Pedir 3 pacientes distintos deja afuera las pruebas del equipo o del odontólogo con su propio celular, que son un solo paciente.
- **Un turno demuestra valor.** Sin turnos, Sofi solo contestó preguntas.

Los umbrales están en `scripts/embudo.mjs` (`ACTIVE_MIN_PATIENTS` y `ACTIVE_MIN_APPOINTMENTS`). Si se cambian, anotarlo acá con la fecha.

### Cambio del 09/11: «Respondieron el saludo»

- **Por qué:** desde el 09/11 la secuencia le escribe a la recepción y el link sale recién cuando responde: Paso 1 (el saludo), Paso 2 (pide permiso, cuando responde) y Paso 3 o Seguimiento 1 (el link). Ver `PLAN_PROSPECCION.md` → «Los mensajes».
- **La etapa:** cuenta, en la semana en que pasó por primera vez, a quien respondió (cambió a «Respondió») o recibió el Paso 2. Antes del 09/11 la demo salía sin esperar respuesta y las respuestas se marcaban a mano: en las semanas 1 y 2 la etapa queda baja y no hay que leerla como conversión.
- **En Chapa Labs** («Embudo contra la meta» y «Funnel de demos») el paso tiene la misma definición con los datos de la base: «Última respuesta» después del saludo, estado «Respondió» o «Paso 2 enviado». Allá, como en todos sus pasos, quien llegó más lejos también cuenta.
- **La tabla de abajo** suma la fila con el próximo `npm run embudo`.

### Cambio del 08/11: «Demos con interacción» pasa a «Hablaron con Sofi»

- **Antes:** la etapa de «Hablaron con Sofi» (entonces la 4) contaba `demo_conversation_started`, que salía cuando empezaba la charla aunque la persona no dijera nada.
- **Por qué cambió:** el 07/11 la demo personal pasó a una sola pantalla y se sacó el botón «Probar la demo» (turniasalud#138). Ahora tocar la esfera arma la demo y empieza la charla en el mismo gesto, así que «empezó la charla» dejó de ser una interacción. Además, desde el 06/11 la base ya no cuenta como conversación la que solo tiene el saludo de Sofi (#128).
- **Ahora:** esa etapa cuenta a quien escribió o habló. Es la misma definición que «Hablaron con Sofi» en Chapa Labs y «Conversó en la demo» en la planilla, y es la única que significa lo mismo en las dos versiones de la demo.
- **Historia:** la tabla de abajo se recalculó con esta definición desde la semana 1. La semana 1 sigue en 1, porque `ache-kthmf` escribió un mensaje.

## Las dos versiones de la demo personal (para ver cuál convierte mejor)

| Versión | Hasta / desde | Pasos de la persona |
| --- | --- | --- |
| **A · Con «Probar la demo»** | Hasta el 07/11/2026, 12:30 (Argentina) | Visitó su `/p/<código>` → tocó «Probar la demo» → en otra pantalla eligió voz o chat → habló con Sofi |
| **B · Pantalla única con la esfera** | Desde el 07/11/2026, 12:30 | Visitó → tocó la esfera (o mandó el primer mensaje), y eso ya empieza la charla → habló con Sofi |

- **Qué se compara:** **visitaron → hablaron con Sofi**, de punta a punta. «Empezaron la demo» (`demo_started`, `demo_at` en la base) no significa lo mismo en las dos versiones: en A era tocar un botón y todavía faltaba la charla; en B ya es la charla. Sirve para ver **dónde** se pierde cada una (en A, entre el botón y la charla; en B, antes de tocar la esfera), no para compararlas entre sí.
- **El corte:** es el deploy de #138. Se mergeó el 07/11 a las 12:26 y la primera visita con la pantalla nueva fue a las 12:32. Está en `src/lib/demo-version.ts` (`ESFERA_DESDE`) y en `scripts/embudo.mjs`: si se cambia, cambiarlo en los dos.
- **Cómo se asigna una persona:**
  - **PostHog:**
    - En `npm run embudo`, cada persona cuenta en la versión de cada visita: quien la abrió con A y volvió con B cuenta en las dos, cada una con lo que hizo en esa versión.
    - En el gráfico «Turnia · Demo personal: A contra B» del tablero «Turnia · Prospección», se cuenta por visita (sesión). Al 08/11: A, 23 visitas y 9 hablaron (39%); B, 5 visitas y 1 habló (20%).
  - **Base y Chapa:** a la versión de su primera apertura, que es la única que queda con fecha.
- **Desde el 08/11, `personal_demo_viewed` y `demo_started` llevan `demo_version`** (`con_probar` o `esfera`), y lo mismo todo lo que haga después ese navegador, porque va como propiedad registrada. Para lo anterior se usa el corte.
- **Para una versión C:** sumarla en `DEMO_VERSIONS` con su fecha, cambiar `DEMO_VERSION_ACTUAL` y agregar el tramo en `scripts/embudo.mjs`. Las versiones anteriores no se tocan.
- **Cuidado al leerlo:** al 08/11, B tiene un día y 4 visitas. Con tan pocos casos, una persona más o menos cambia el porcentaje en 25 puntos. Mirar la comparación cuando B tenga al menos 15 a 20 visitas.

## Reglas de conteo

- **Semanas de lunes a domingo**, hora de Buenos Aires. La semana 1 va del lunes 26/10 al domingo 1/11/2026.
- **Cada odontólogo o cuenta cuenta una sola vez**, en la semana en que llegó por primera vez a esa etapa. Así, el total es la suma de las semanas. Si alguien abre su demo dos semanas seguidas, cuenta solo en la primera.
- **Excepción, «Cuentas activas»:** se mide de nuevo cada semana, porque es un estado. En la columna «Total» va el valor de la última semana.
- **Se descuenta lo deshecho:** un saludo o una demo enviada que se deshizo con «Deshacer contacto» no cuenta.
- **No hay corte por cohorte:** una etapa no exige haber pasado por la anterior. Por ejemplo, alguien puede abrir su demo en la semana 2 aunque el mensaje se haya mandado en la 1.
- **Las etapas 6 y 7 cuentan todas las cuentas**, vengan o no de la prospección (por ejemplo, el piloto Guerra–Mininni). Desde el 4/11 existe el vínculo entre la persona y su clínica (`sales_outreach.clinic_id`, acción `account` de `/api/prospeccion`), pero el script todavía no lo usa.

## Cómo actualizar la tabla

Correr el script, que solo lee y no escribe nada:

```bash
POSTHOG_PERSONAL_API_KEY=phx_… DATABASE_URL=postgres://… npm run embudo
```

- **Qué imprime:** la tabla en Markdown con todas las semanas desde la 1. Pegarla abajo y anotar lo que llame la atención.
- **`POSTHOG_PERSONAL_API_KEY`:** clave personal de PostHog. Está en el entorno de las sesiones de Claude.
- **`DATABASE_URL`:** la base de Neon de producción, la misma que usa Vercel. Sin esa variable, las etapas 6 a 8 salen «sin base».
- **Opcionales:** `POSTHOG_PROJECT_ID` (por defecto, 518346) y `POSTHOG_HOST` (por defecto, `https://us.posthog.com`).

**Cuidado con el proyecto de PostHog.** El 518346 se llama «Default project» y lo comparten Loreado y Copiloto, que tienen miles de eventos propios. El script filtra los eventos de Turnia (prospectos `prospecto:<código>`, `app_env` = `production`, sin `is_internal`). Al armar gráficos a mano en PostHog hay que poner los mismos filtros. A la larga conviene mover Turnia a un proyecto propio.

## Tabla semanal

Al 08/11, con «Hablaron con Sofi» ya con su definición nueva. Las etapas de cuentas y clientes necesitan `DATABASE_URL`: no estaba en la sesión que la generó. «Respondieron el saludo» (09/11) se suma con la próxima corrida.

| Etapa | Semana 1 (26/10–1/11) | Semana 2 (2/11–8/11) | Total |
| --- | ---: | ---: | ---: |
| Saludos enviados | 92 | 123 | 215 |
| Respondieron el saludo | sin medir | sin medir | sin medir |
| Demos enviadas | 41 | 108 | 149 |
| Demos visitadas | 2 | 17 | 19 |
| Hablaron con Sofi | 1 | 10 | 11 |
| Cuentas creadas | sin dato | sin dato | sin dato |
| Cuentas activas | sin dato | sin dato | sin dato |
| Clientes pagos | 0 | sin dato | sin dato |

**Demo personal por versión** (cada persona, en la versión de su visita):

| Versión | Visitaron | Empezaron la demo | Hablaron con Sofi | Visitaron → hablaron |
| --- | ---: | ---: | ---: | ---: |
| A · Con «Probar la demo» (hasta el 07/11) | 16 | 11 | 10 | 63% |
| B · Pantalla única con la esfera (desde el 07/11) | 4 | 1 | 1 | 25% |

- **Semana 2 (al domingo 8/11):** de 17 que visitaron su demo, 10 hablaron con Sofi. La lectura de WhatsApp del 08/11 encontró 14 respuestas reales en el 0022 (ver `CENTRO_COMERCIAL.md`).
- **A contra B:** todavía no alcanza para decidir. De los 4 de B, `pescatori-e2ex4` tocó la esfera y no habló (y al otro día volvió y escribió por chat), `boutet-d2m76`, `iaconis-kffi8` y `san-martin-9pt` no la tocaron. Ver cuántos de B no tocan la esfera: si sigue así, el pedido de adentro («Hablame como si fueras un paciente») no se está entendiendo como un botón.

### Notas de la semana 1 (al 1/11)

- **Es parcial:** PostHog empezó a medir el viernes 30/10 a las 11:16. Los saludos y demos que se hayan mandado del 26 al 29/10 no están en las filas 1 y 2. El registro completo está en la base (`sales_outreach_events`) y en Panel → Prospección.
- **Saludos y demos:** salieron el 30 y el 31/10. Las 41 demos fueron por WhatsApp: 24 a celulares propios, 12 a celulares de consultorios y 5 a fijos.
- **Demos visitadas (2):**
  - `ache-kthmf` recibió su demo el 31/10 a las 13:04 y la abrió ese día a las 18:20.
  - `barrios-uxd` abrió su link el 30/10 a las 11:36, antes de que PostHog registrara su mensaje. Probablemente se lo mandaron en los días anteriores; si fue una prueba del equipo, restar 1.
- **Interacción (1):** `ache-kthmf` tocó «Probar la demo», pasó al chat y conversó 20 segundos con Sofi, con un mensaje.
- **Cuentas:** sin acceso a la base en esta sesión. Completar con `DATABASE_URL`.
- **Clientes pagos:** 0. Nadie de la prospección respondió todavía: no hay ningún cambio de estado registrado.
- **Fuera de la prospección:** la web tuvo 6 visitantes externos y ninguna demo desde `/probar-demo` ni pedido de demo.

## Pendiente para medir mejor

- **Cuentas en las métricas de Chapa Labs.** `/api/metricas` (`src/lib/sales/metrics.ts`) cuenta clínicas y uso solo donde `is_demo` es falso. Pero las cuentas de los consultorios se crean como clínicas conservadas (`is_demo` = `true`, con `retained_at`): hoy ese tablero no las ve. Habría que contarlas como en `scripts/embudo.mjs`, por su código de acceso.
- **Contar solo las cuentas de la prospección** con `sales_outreach.clinic_id` (existe desde el 4/11), para ver el embudo completo de cada odontólogo y por cohorte de semana de contacto. Ojo: la columna «Cuenta activa» de la planilla de Chapa Labs usa otro criterio (turnos en 30 días) y su embudo pone la cuenta después del cliente; conviene unificarlos con el de este archivo.
- **Eventos de cuenta en PostHog** (`clinic_account_created`, y el primer turno que da Sofi en una cuenta), para que todo el embudo se vea en un solo tablero.
