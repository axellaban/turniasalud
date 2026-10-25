# Video demo de Turnia Salud

Dos versiones del mismo video, listas para usar:

| Archivo | Formato | Para |
|---|---|---|
| [`out/turnia-horizontal.mp4`](out/turnia-horizontal.mp4) | 1920 × 1080, 47 s | web, YouTube, LinkedIn, presentaciones y llamadas de venta |
| [`out/turnia-vertical.mp4`](out/turnia-vertical.mp4) | 1080 × 1920, 47 s | Reels, TikTok, Shorts, estados de WhatsApp y anuncios |

H.264 + AAC a 30 cuadros, volumen normalizado a −14 LUFS (el estándar de las redes).

## Qué muestra

1. **Gancho:** «Domingo, 7:12. Tu consultorio está cerrado. Pero Sofi ya está atendiendo».
2. **WhatsApp:** Jorge manda una nota de voz (la voz es real, de la demo de la web); Sofi lo reconoce, le ofrece turnos con la Dra. Fernández, reserva y deja pedida la receta. Al costado, lo que va haciendo Sofi.
3. **Teléfono:** una llamada con la voz real de Sofi (demo «Dermatología»), con transcripción en vivo y el turno reservado. El reloj de la llamada salta donde se cortó la grabación.
4. **Panel real:** el turno de Jorge aparece en la agenda («Nuevo · por WhatsApp»), la conversación con su resumen y Campañas con los pacientes para volver a agendar.
5. **Cierre:** «Cada paciente, bien atendido · Probalo con tu web en turniasalud.vercel.app».

## Cómo está hecho

- **La interfaz es la real.** Playwright navega la web, guarda capturas a 2x y la posición de cada botón y campo (`capture/*.mjs` → `public/turnia/shots.json`).
- **[Remotion](https://www.remotion.dev)** (video con React) anima encima: cursor con clics, cámara que acerca y sigue la acción, tipeo, menús, textos y transiciones. El motor está en `src/engine` y el guion del video en `src/turnia/script.ts` (tiempos, cámara y cursor) y `src/turnia/Video.tsx` (escenas y textos).
- **Horizontal y vertical salen de la misma composición:** en vertical la cámara se acerca más y los textos van arriba.
- **Sonido:** música de Mixkit («Infinity», de Arulo, [licencia libre de Mixkit](https://mixkit.co/license/#musicFree), uso comercial permitido dentro del video). Como la licencia no permite redistribuir el archivo suelto, no se versiona: `npm run music` lo baja a `public/music/`. Los clics, teclas y destellos se generan con `scripts/make-sfx.py` (sin licencias de terceros).
- **Licencia de Remotion:** es gratis para personas y empresas de hasta 3 empleados; las más grandes necesitan una [licencia de empresa](https://www.remotion.dev/license).

## Datos y honestidad

- El panel es el real, corriendo **en local** con Postgres, `supabase/schema.sql`, `supabase/seed.sql` y una semana ficticia (`capture/turnia/seed-video.py` genera `seed-video.sql` y `seed-video-historial.sql`). Nunca se toca producción.
- Se entra con un código de consultorio que sólo existe en esa base local (`VDEM-PZAP-TURA-2345`), así se ve el panel como lo usa la clínica, sin el menú de administración.
- WhatsApp y la llamada son escenas animadas (no capturas). Las voces son cortes de los audios de la web (`/api/audios/home.mp3` y `/api/audios/dermatologia.mp3`, generados con ElevenLabs), en `public/turnia/audio`. No se generó audio nuevo.
- El canal de WhatsApp todavía no está activo en producción (ver `PENDIENTES.md`): el chat muestra cómo responde Sofi con los datos del consultorio demo.
- La nota al pie del cierre aclara que el consultorio, los pacientes y las conversaciones son de ejemplo y que las voces están generadas con IA.

## Comandos

Desde `video/demo` (Node 22 o más nuevo). Es un proyecto aparte: no se instala con la app ni entra en su build, lint o tests.

```bash
npm ci
npm run studio                 # vista previa interactiva en el navegador
npm run render                 # baja la música y renderiza out/turnia-horizontal.mp4 y out/turnia-vertical.mp4
npm run stills -- 90,300       # cuadros sueltos en out/stills para revisar
npx tsx scripts/marks.ts turnia   # cuadros clave del guion
npm run typecheck
```

Para recapturar la web (si cambió la interfaz):

```bash
# 1. Base local (una sola vez)
createdb turnia_video
psql turnia_video -f ../../supabase/schema.sql -f ../../supabase/seed.sql
python3 capture/turnia/seed-video.py capture/turnia/seed-video.sql
psql turnia_video -f capture/turnia/seed-video.sql -f capture/turnia/seed-video-historial.sql
# 2. La app apuntando a esa base (desde la raíz del repo)
DATABASE_URL=postgres://…/turnia_video PANEL_PASSWORD=local npx next build && npx next start -p 3100
# 3. Captura (desde video/demo)
node capture/turnia.mjs
python3 capture/optimize.py public/turnia
```

Si cambian los botones de lugar, el cursor los sigue solo (las cajas salen de la captura); si cambia el flujo, se ajusta `src/turnia/script.ts`.
