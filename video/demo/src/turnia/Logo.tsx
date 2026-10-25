import React from "react";
import { C, theme } from "./theme";

/** Isotipo de Turnia (public/marca/turnia-isotipo.svg). */
export const Isotipo: React.FC<{ size?: number; color?: string }> = ({ size = 32, color = C.brand }) => (
  <svg viewBox="0 0 32 32" width={size} height={size}>
    <path
      fill={color}
      fillRule="evenodd"
      d="M9.5 3H22.5A7.5 7.5 0 0 1 30 10.5V18.5A7.5 7.5 0 0 1 22.5 26H13.5L7.2 30.6A1.2 1.2 0 0 1 5.3 29.6V25.4A7.5 7.5 0 0 1 2 18.5V10.5A7.5 7.5 0 0 1 9.5 3ZM11.6 8.9H20.4A1.8 1.8 0 0 1 20.4 12.5H17.8V19.2A1.8 1.8 0 0 1 14.2 19.2V12.5H11.6A1.8 1.8 0 0 1 11.6 8.9Z"
    />
  </svg>
);

/** Logo: isotipo + «Turnia» en negrita + «Salud» regular (como el header del sitio). */
export const Logo: React.FC<{ size?: number; dark?: boolean }> = ({ size = 40, dark = false }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: size * 0.28, fontFamily: theme.display, fontSize: size * 0.82, letterSpacing: "-0.02em", color: dark ? "#fff" : C.brand900, lineHeight: 1 }}>
    <Isotipo size={size} color={dark ? "#ffffff" : C.brand} />
    <span>
      <b style={{ fontWeight: 700 }}>Turnia</b> <span style={{ fontWeight: 400 }}>Salud</span>
    </span>
  </span>
);
