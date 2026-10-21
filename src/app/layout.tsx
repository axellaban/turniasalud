import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "https://turniasalud.vercel.app"),
  title: {
    default: "Turnia Salud · Agentes de IA para clínicas",
    template: "%s · Turnia Salud",
  },
  description:
    "Agentes de IA que atienden el WhatsApp y el teléfono de tu clínica las 24 horas: dan turnos, confirman, reprograman, recuperan pacientes y derivan lo urgente.",
  openGraph: { locale: "es_AR", siteName: "Turnia Salud", type: "website" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-AR" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
