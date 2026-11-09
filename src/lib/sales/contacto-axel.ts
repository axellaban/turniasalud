// El WhatsApp de Axel: adonde lleva cada «Escribirle a Axel» del recorrido de la demo (la página
// de su demo, la demo en el navegador y el cierre de cada charla con Sofi). Es el mismo número con
// el que se prospecta, así la conversación sigue en el chat donde le llegó la demo.

export const AXEL_WHATSAPP = "5491130235483";

/** El chat con Axel en `numero` (por defecto, su WhatsApp Business), con el mensaje escrito. */
export const whatsappAxel = (texto: string, numero: string = AXEL_WHATSAPP) => `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;

/** Compartir por WhatsApp: se abre con el texto escrito y se elige a quién mandárselo. */
export const whatsappReenviar = (texto: string) => `https://wa.me/?text=${encodeURIComponent(texto)}`;

/**
 * El mensaje ya escrito: corto, en su voz, con lo que Axel necesita para seguir (quién es y qué probó).
 * `probo`: ya habló con Sofi; si no, pide que se la muestren.
 */
export function mensajeParaAxel({ saludo, consultorio, probo }: { saludo?: string | null; consultorio: string; probo: boolean }): string {
  const soy = saludo ? ` Soy ${saludo}.` : "";
  return probo
    ? `Hola Axel!${soy} Probé a Sofi con ${consultorio} y quiero verla funcionando en mi consultorio.`
    : `Hola Axel!${soy} Prefiero que me muestres a Sofi funcionando en ${consultorio}.`;
}

/**
 * El mensaje para Axel desde la demo de la prospección (`/p/<código>`). Desde el 09/11 la secuencia
 * le escribe a la recepción y la demo la puede probar ella o un doctor al que se la reenviaron: no
 * dice quién es (el chat ya lo dice) ni habla de «mi consultorio».
 */
export function mensajeDesdeDemo({ consultorio, probo }: { consultorio: string; probo: boolean }): string {
  return probo
    ? `Hola Axel! Probé el simulador de ${consultorio}. ¿Lo vemos funcionando con nuestros horarios y obras sociales?`
    : `Hola Axel! Vi el simulador de ${consultorio}. ¿Me lo mostrás funcionando?`;
}
