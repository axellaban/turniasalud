# Skills de diseño del proyecto

Skills de terceros para diseñar y auditar la web pública, las demos y el panel. Claude Code las
carga solas desde esta carpeta. Se copiaron el 24/10/2026 y se revisó su contenido antes de subirlas.

| Skill | Origen (commit) | Licencia | Para qué |
| --- | --- | --- | --- |
| `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills) `dbd4588` | Apache 2.0 (`LICENSE.txt`) | Dirección visual de la web pública y `/probar-demo`; evita el diseño genérico. |
| `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) `063bee9` + [web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) | MIT | Auditoría de accesibilidad, foco, formularios, estados y animación. |
| `react-best-practices` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) `063bee9` | MIT | Rendimiento de React y Next.js. |
| `impeccable` | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) `2bb6563` (v4.7.0) | Apache 2.0 (`LICENSE`, `NOTICE.md`) | `critique`, `audit`, `polish` y demás comandos de diseño. |

Cambios respecto del original, a propósito:

- **`impeccable` va sin la carpeta `scripts/`.** Su lanzador descarga y ejecuta un binario la
  primera vez; no se sube código ejecutable de terceros al repo. La skill tiene un camino previsto
  para eso («Launcher unavailable»): lee `PRODUCT.md` y `DESIGN.md` si existen y sigue con las
  guías de `reference/`. El detector automático y el modo `live` no están disponibles.
- **`web-design-guidelines` lee una copia local** (`guidelines.md`) en lugar de bajar las reglas de
  internet en cada revisión.
- **`react-best-practices`:** la guía completa se renombró de `AGENTS.md` a `GUIA-COMPLETA.md`,
  para que ninguna herramienta la tome como instrucciones del proyecto. Se quitó su README de
  mantenimiento.

Para actualizar una skill: volver a copiarla del repo de origen, revisar el diff y anotar el commit acá.
