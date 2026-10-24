---
target: "home (/) y /probar-demo"
date: 2026-10-24
total_score: 21
max_score: 32
na_heuristics: "7,10"
p0_count: 0
p1_count: 4
method: "single-context; detector no disponible (scripts/ no instalado)"
---
# Crítica: home y /probar-demo (producción, 1440 y 390)

Puntaje: 21/32 (66 %, Aceptable). H1 3 · H2 2 · H3 3 · H4 2 · H5 3 · H6 3 · H7 n/a · H8 2 · H9 3 · H10 n/a.

## Prioridades
1. [P1] Pruebas sociales que parecen inventadas: ★★★★★ en el hero (src/components/site/hero.tsx:45) sin reseñas; tarjetas «Resultados que podés medir» con ↑ y sin números; «0 llamadas». → clarify
2. [P1] Llamados a la acción confusos: «Probá con tu web», «Probalo con tu web», «Probalo ahora», «Probá el agente» y «Pedí una demo» llevan a tres lugares distintos. → clarify / distill
3. [P1] /probar-demo: no anticipa qué pasa al salir a Telegram, contradice el «WhatsApp» de la home y la banda final «¿Listo para…? Pedí una demo» compite con su única acción. → onboard
4. [P1] «Ver todas las especialidades» lleva a /especialidades/clinica-medica: no existe un índice. → harden
5. [P2] Página larga y repetida: las especialidades aparecen tres veces (grilla, tarjeta oscura, footer); 8 H2; ~14 pantallas en celular. → distill
6. [P2] Jerga técnica para dueños de consultorio: Postgres, troncal SIP, n8n, webhooks, ElevenLabs, «9 acciones sobre la agenda», «Contención». → clarify

## Menores
- Foto de un papá con dos chicos y el texto «una mamá saca turno» (src/app/(marketing)/page.tsx:62).
- «PROBAR DEMO» en mayúsculas; el resto del sitio usa oraciones.
- Botón final cian: único lugar con ese color de botón.
- Eyebrow «DEMO CON TU CONSULTORIO» y mezcla clínica/consultorio en el mismo bloque.
- Titulares en dos colores en casi todas las secciones: pierde efecto.
