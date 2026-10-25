import { localFont } from "../engine/fonts";
import type { Theme } from "../engine/types";

const geist = localFont("Geist", "geist-sans", [400, 500, 600, 700]);
localFont("Inter", "inter", [400, 500]);

// Colores de src/app/globals.css de Turnia Salud.
export const C = {
  brand: "#2157e1",
  brand700: "#0e3ca7",
  brand50: "#ebf1ff",
  brand100: "#d7e3ff",
  navy: "#0b0d1a",
  brand900: "#08183f",
  aqua: "#32d5d8",
  emerald: "#4eb49e",
  lila: "#b3b1ff",
  sun: "#ff9a1f",
  tinta: "#4b5671",
  wa: "#25d366",
  waBubble: "#d9fdd3",
  waBg: "#efeae2",
};

export const theme: Theme = {
  bg: "#f4f7ff",
  bg2: "#dce6ff",
  accent: C.brand,
  ink: C.brand900,
  muted: C.tinta,
  pill: C.brand900,
  pillInk: "#ffffff",
  step: C.brand,
  stepInk: "#ffffff",
  font: geist,
  display: geist,
  dark: false,
};
