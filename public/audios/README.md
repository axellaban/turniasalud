# Audios de las demos

Acá van los audios que suenan en la web (home, "Escuchá a nuestros agentes" y especialidades):

- `<slug>.mp3`: la conversación completa.
- `<slug>.json`: cuándo empieza y termina cada línea del guion, para resaltar la transcripción.
  Formato: `{ "duracion": 187.4, "segmentos": [{ "linea": 0, "inicio": 0.1, "fin": 5.3 }] }`.

Los guiones están en `src/content/conversaciones.json`. Mientras falte el audio de un guion,
la web reproduce la conversación escrita como lectura animada.

**Forma más simple (sin computadora):** Panel → Configuración → Audios de la web → "Generar".
Se guardan en la base (tabla `web_audios`) y la web los toma de `/api/audios/`. Los archivos de
esta carpeta, si existen, tienen prioridad.

## Cómo generarlos

Con la clave de ElevenLabs en `.env.local` (necesita permiso de **Text to Speech** y de **Voices: Read**):

```bash
node scripts/generar-audios.mjs --dry-run                         # revisa los guiones y cuántos caracteres consume
node --env-file=.env.local scripts/generar-audios.mjs              # genera todos
node --env-file=.env.local scripts/generar-audios.mjs pediatria    # solo uno
```

- Usa las **2 voces favoritas** de ElevenLabs. Si hay una sola femenina, es la de Sofi; si no, la primera marcada como favorita.
  Para elegirlas a mano: `VOZ_AGENTE=<voice_id>` y `VOZ_PACIENTE=<voice_id>` en `.env.local`.
- `--telefono` aplica un filtro de llamada telefónica. `--forzar` regenera aunque ya existan.
- Los 7 guiones suman unos 17.600 caracteres. Text to Dialogue cobra créditos por carácter: revisá el saldo y el límite de la clave antes de generarlos todos.
