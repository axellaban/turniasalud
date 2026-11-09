/** Dónde tocó «Escribirle a Axel»: al terminar de hablar con Sofi, durante la demo o en la página de su demo. */
export const TALK_PLACES = { cierre: "al terminar la demo", demo: "durante la demo", pagina: "en la página de su demo" } as const;
export type TalkPlace = keyof typeof TALK_PLACES;

/** Tocó «Reenviárselo a los doctores» en su demo: queda en su ficha (una vez cada 6 horas). */
export const FORWARD_NOTE = "Tocó «Reenviárselo a los doctores» en su demo";
