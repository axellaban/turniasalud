/** Dónde tocó «Escribirle a Axel»: al terminar de hablar con Sofi, durante la demo o en la página de su demo. */
export const TALK_PLACES = { cierre: "al terminar la demo", demo: "durante la demo", pagina: "en la página de su demo" } as const;
export type TalkPlace = keyof typeof TALK_PLACES;
