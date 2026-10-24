"use client";

import Link from "next/link";
import { useState } from "react";
import { ConversationProvider } from "@elevenlabs/react";
import { ConversacionDemo, type DemoClinic, type DemoCredential } from "@/components/demo/conversacion-demo";

export function DemoClinica({ clinic, demo }: { clinic: DemoClinic; demo: boolean }) {
  const [phone, setPhone] = useState("");
  return (
    <ConversationProvider>
      <ConversacionDemo
        clinic={clinic}
        titulo={<>Hablá con {clinic.agentName}, la recepción de <span className="text-brand-600">{clinic.name}</span></>}
        bajada="Es el mismo agente que atiende el WhatsApp y el teléfono. Los turnos que reserves quedan en la agenda de esta clínica."
        tituloFicha="La ficha de la clínica"
        notaFicha={demo ? "Es una clínica de demo: su agenda es de prueba." : "Usa la ficha y la agenda reales de la clínica."}
        cta={<Link href="/panel/agenda" className="font-medium text-brand-600 hover:underline">Ver los turnos en la Agenda →</Link>}
        extraFicha={
          <label className="block text-sm">
            <span className="font-semibold text-brand-950">Probar como paciente (opcional)</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              autoComplete="off"
              placeholder="Celular del paciente"
              className="mt-2 w-full rounded-xl bg-[#f5f7fc] px-3 py-2 text-[15px] text-brand-950 outline-none ring-1 ring-brand-950/10 focus:ring-2 focus:ring-brand-600"
            />
            <span className="mt-1.5 block text-xs leading-relaxed text-tinta">
              {clinic.agentName} reconoce al paciente por su celular: sus turnos, su cobertura y lo que habló antes. Vacío, sos un paciente nuevo.
            </span>
          </label>
        }
        pedirCredencial={async (mode) => {
          const res = await fetch("/api/elevenlabs/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone, mode }),
          });
          const info = (await res.json()) as DemoCredential & { error?: string };
          if (!res.ok) throw new Error(info.error || "No se pudo iniciar la conversación.");
          return info;
        }}
      />
    </ConversationProvider>
  );
}
