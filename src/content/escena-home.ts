// Qué «piensa» el agente en cada momento de la llamada de la home: el objetivo que
// persigue (izquierda, junto a Sofi) y los datos que va detectando (derecha, junto
// al paciente). La clave es el índice de la línea del guion en conversaciones.json.
export type PasoEscena = { objetivo?: string; dato?: { etiqueta: string; valor: string } };

export const ESCENA_HOME: Record<number, PasoEscena> = {
  0: { objetivo: "Identificar qué necesita" },
  1: { dato: { etiqueta: "Motivo detectado", valor: "Turno con traumatología y renovar una receta" } },
  2: { objetivo: "Verificar la identidad" },
  3: { dato: { etiqueta: "DNI", valor: "28.412.330" } },
  4: { dato: { etiqueta: "Paciente encontrado", valor: "Jorge Pérez · Swiss Medical SMG20" } },
  6: { objetivo: "Entender la consulta" },
  7: { dato: { etiqueta: "Tipo de consulta", valor: "Control de rodilla derecha a los 6 meses" } },
  8: { objetivo: "Ofrecer turnos" },
  9: { dato: { etiqueta: "Turno elegido", valor: "Lunes 17 · 8:40 · Dra. Fernández" } },
  10: { objetivo: "Confirmar el turno", dato: { etiqueta: "Turno reservado", valor: "Av. Santa Fe 3200, 1.º piso · traer credencial" } },
  12: { objetivo: "Renovar la receta" },
  13: { dato: { etiqueta: "Medicamento", valor: "Ibuprofeno 600 mg · Dra. Fernández" } },
  15: { dato: { etiqueta: "Uso", valor: "Solo con dolor, después del fútbol" } },
  17: { dato: { etiqueta: "Reacciones u otros remedios", valor: "Ninguno" } },
  18: { dato: { etiqueta: "Pedido de receta", valor: "Enviado a la Dra. Fernández · llega por WhatsApp" } },
  19: { objetivo: "Responder dudas" },
  20: { dato: { etiqueta: "Cómo llegar", valor: "Estacionamiento en Bulnes · subte D, estación Bulnes" } },
  22: { objetivo: "Resumir y cerrar", dato: { etiqueta: "Recordatorio", valor: "Por WhatsApp, el día anterior al turno" } },
};
