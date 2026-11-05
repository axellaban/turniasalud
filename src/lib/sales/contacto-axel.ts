// El WhatsApp de Axel: adonde lleva cada «Escribirle a Axel» del recorrido de la demo (la página
// de su demo, la demo en el navegador y el cierre de cada charla con Sofi). Es el mismo número con
// el que se prospecta, así la conversación sigue en el chat donde le llegó la demo.

export const AXEL_WHATSAPP = "5491130235483";

export const whatsappAxel = (texto: string) => `https://wa.me/${AXEL_WHATSAPP}?text=${encodeURIComponent(texto)}`;

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
