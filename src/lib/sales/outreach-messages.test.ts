import { describe, expect, it } from "vitest";
import { parseOutreachImport } from "./outreach-import";
import {
  DEFAULT_TEMPLATES,
  addBusinessDays,
  displayOutreachPhone,
  mergeTemplates,
  nextFollowUp,
  ofBusiness,
  normalizeInstagram,
  outreachPhone,
  recipientLabel,
  renderTemplate,
  weekStart,
  whatsappLinks,
  whatsappTemplateKey,
  withArticle,
  type OutreachPerson,
} from "./outreach-messages";

const person: OutreachPerson = {
  code: "moreta-ab3",
  name: "Myriam Daniela Moreta",
  greeting: "Myriam",
  title: "Dra.",
  business_name: "Consultorio Odontológico Moreta",
  zone: "Mar del Plata",
  address: "Av. Juan José Paso 2121",
  specialty: "Ortodoncia",
  phone: "+5492236602433",
  phone_kind: "movil",
  instagram: null,
  website: null,
  touches: 0,
};

describe("prospección: mensajes y reglas", () => {
  it("lee teléfonos como se escriben en Mar del Plata y Miramar", () => {
    expect(outreachPhone("0223 15 412-3456")).toEqual({ phone: "+5492234123456", kind: "movil" });
    expect(outreachPhone("223 4123456")).toEqual({ phone: "+542234123456", kind: "fijo" });
    expect(outreachPhone("223 6123456", "movil")).toEqual({ phone: "+5492236123456", kind: "movil" });
    expect(outreachPhone("+54 9 223 412 3456")).toEqual({ phone: "+5492234123456", kind: "movil" });
    expect(outreachPhone("+542291420128")).toEqual({ phone: "+542291420128", kind: "fijo" });
    expect(outreachPhone("02291-15-404031")).toEqual({ phone: "+5492291404031", kind: "movil" });
    expect(outreachPhone("223-511547")).toBeNull();
    // El celular del consultorio (el WhatsApp de su web) se marca como tal, aunque no traiga el 15.
    expect(outreachPhone("223 562-7681", "consultorio")).toEqual({ phone: "+5492235627681", kind: "consultorio" });
    expect(outreachPhone("+54 9 223 448-9864", "consultorio")).toEqual({ phone: "+5492234489864", kind: "consultorio" });
    expect(outreachPhone("223 456-9108", "fijo")).toEqual({ phone: "+542234569108", kind: "fijo" });
    expect(displayOutreachPhone("+5492235202572")).toBe("+54 9 223 520-2572");
    expect(displayOutreachPhone("+542291420128")).toBe("+54 2291 42-0128");
    expect(displayOutreachPhone("+5491155550001")).toBe("+54 9 11 5555-0001");
  });

  it("normaliza el usuario de Instagram", () => {
    expect(normalizeInstagram("@Dra.Perez")).toBe("dra.perez");
    expect(normalizeInstagram("https://www.instagram.com/odonto_mdp/?hl=es")).toBe("odonto_mdp");
    expect(normalizeInstagram("instagram.com/p/C1abc")).toBeNull();
    expect(normalizeInstagram("no es un usuario")).toBeNull();
  });

  it("elige el mensaje según cuántas veces se le escribió, el número y la demo", () => {
    // Primero el saludo sin link; con el saludo mandado, la presentación con la demo.
    expect(whatsappTemplateKey(person, false)).toBe("whatsapp_saludo");
    expect(whatsappTemplateKey({ ...person, phone_kind: "fijo" }, false)).toBe("whatsapp_saludo_consultorio");
    expect(whatsappTemplateKey(person, true)).toBe("whatsapp_saludo_consultorio");
    const greeted = { ...person, greeted_at: "2026-10-28T12:00:00Z" };
    expect(whatsappTemplateKey(greeted, false)).toBe("whatsapp_1");
    expect(whatsappTemplateKey({ ...greeted, phone_kind: "fijo" }, false)).toBe("whatsapp_consultorio");
    expect(whatsappTemplateKey({ ...greeted, phone_kind: "consultorio" }, false)).toBe("whatsapp_consultorio");
    expect(whatsappTemplateKey({ ...greeted, phone_kind: "consultorio", touches: 1 }, false)).toBe("whatsapp_2");
    expect(whatsappTemplateKey(greeted, true)).toBe("whatsapp_consultorio");
    expect(whatsappTemplateKey({ ...person, touches: 1 }, false)).toBe("whatsapp_2");
    expect(whatsappTemplateKey({ ...person, touches: 1, demo_at: "2026-10-26T12:00:00Z" }, false)).toBe("whatsapp_demo");
    expect(whatsappTemplateKey({ ...person, touches: 2 }, false)).toBe("whatsapp_3");
    expect(whatsappTemplateKey({ ...person, touches: 3 }, false)).toBeNull();
  });

  it("arma el mensaje con su nombre, su consultorio y su demo", () => {
    const link = "https://turnia.example/p/moreta-ab3";
    // El saludo no lleva link.
    expect(renderTemplate(DEFAULT_TEMPLATES.whatsapp_saludo, person, link)).toBe("¡Buenas! ¿Hablo con Myriam?");
    expect(renderTemplate(DEFAULT_TEMPLATES.whatsapp_saludo_consultorio, { ...person, name: "Rodrigo Arias", title: "Dr." }, link)).toBe(
      "¡Buenas! ¿Hablo con el consultorio del Dr. Arias?",
    );
    const first = renderTemplate(DEFAULT_TEMPLATES.whatsapp_1, person, link);
    expect(first).toMatch(/^Hola Myriam, ¿cómo estás\? Soy Axel, de Turnia\./);
    expect(first).toContain(link);
    expect(first).not.toMatch(/\{\w+\}/);
    const desk = renderTemplate(DEFAULT_TEMPLATES.whatsapp_consultorio, person, link);
    expect(desk).toContain("Le armé a la Dra. Moreta una demo");
    const doctor = { ...person, name: "Rodrigo Arias", greeting: "Rodrigo", title: "Dr." };
    expect(renderTemplate(DEFAULT_TEMPLATES.whatsapp_consultorio, doctor, link)).toContain("Le armé al Dr. Arias una demo");
    expect(renderTemplate(DEFAULT_TEMPLATES.llamada, doctor, link)).toContain("¿Es el consultorio del Dr. Arias?");
    expect(recipientLabel({ name: "Fernando A. Secreti", title: "Dr." })).toBe("el Dr. Secreti");
    expect(withArticle("Dra.", "Myriam Moreta")).toBe("la Dra. Myriam Moreta");
    expect(withArticle("", "Agostina Migliora")).toBe("Agostina Migliora");
    expect(ofBusiness("Consultorio Odontológico Capris")).toBe("del Consultorio Odontológico Capris");
    expect(ofBusiness("Clínica Dental Sur")).toBe("de la Clínica Dental Sur");
    expect(ofBusiness("ACHE odontologia integral")).toBe("de ACHE odontologia integral");
    expect(recipientLabel({ name: "Agostina Migliora", title: "" })).toBe("Agostina Migliora");
    const { app, web } = whatsappLinks(person.phone!, first);
    expect(app).toBe(`https://wa.me/5492236602433?text=${encodeURIComponent(first)}`);
    expect(web).toContain("web.whatsapp.com/send?phone=5492236602433");
    // Los guardados reemplazan a los de fábrica; los vacíos no.
    expect(mergeTemplates({ whatsapp_1: "Hola {saludo}", whatsapp_2: "  " })).toMatchObject({ whatsapp_1: "Hola {saludo}", whatsapp_2: DEFAULT_TEMPLATES.whatsapp_2 });
  });

  it("programa los seguimientos en días hábiles", () => {
    // Viernes 30/10/2026 + 2 hábiles = martes 3/11.
    expect(addBusinessDays("2026-10-30", 2)).toBe("2026-11-03");
    expect(nextFollowUp("2026-10-26", 1)).toBe("2026-10-28");
    expect(nextFollowUp("2026-10-28", 2)).toBe("2026-11-03");
    expect(nextFollowUp("2026-10-28", 3)).toBeNull();
    expect(weekStart("2026-10-25")).toBe("2026-10-19");
    expect(weekStart("2026-10-26")).toBe("2026-10-26");
    expect(weekStart("2026-10-31")).toBe("2026-10-26");
  });

  it("lee la lista con sus columnas y avisa lo que no pudo leer", () => {
    const csv = [
      "codigo,nombre,saludo,tratamiento,consultorio,zona,direccion,especialidad,telefono,tipo_telefono,otros_telefonos,instagram,email,web,prioridad,senales,fuente,doctoralia",
      'moreta-ab3,Myriam Daniela Moreta,Myriam,Dra.,Consultorio Odontológico Moreta,Mar del Plata,Av Juan José Paso 2121,"Ortodoncia, Odontopediatría",+5492236602433,movil,,,,,1,celular propio,Círculo,https://www.doctoraliar.com/perfil/myriam-daniela-moreta',
      "BAD CODE,Leonel Del Señor,,,,Miramar,Calle 23 1579,Odontología,02291-420128,fijo,,@leo.odonto,leo@example.com,odontoleo.com.ar,9,,Círculo,",
      ",Sin Teléfono,,,,Mar del Plata,,,223-511547,,,,,,,,,",
      ",Rodrigo Arias,,Dr.,AB Consultorios,Mar del Plata,,,223 562-7681,celular del consultorio,,,,abconsultorios.com,,,Web del consultorio,",
      ",,,,,,,,,,,,,,,,,",
    ].join("\n");
    const preview = parseOutreachImport(csv);
    expect(preview.rows).toHaveLength(4);
    expect(preview.rows[0]).toMatchObject({ code: "moreta-ab3", title: "Dra.", phone: "+5492236602433", phone_kind: "movil", priority: 1, specialty: "Ortodoncia, Odontopediatría" });
    expect(preview.rows[0].notes).toContain("Perfil de Doctoralia: https://www.doctoraliar.com/perfil/myriam-daniela-moreta");
    // Lo que no trae (saludo, prioridad válida) queda vacío: al crearlo se completa, al actualizar no pisa.
    expect(preview.rows[1]).toMatchObject({ code: null, greeting: "", phone: "+542291420128", phone_kind: "fijo", instagram: "leo.odonto", email: "leo@example.com", website: "https://odontoleo.com.ar/", priority: null });
    expect(preview.rows[2]).toMatchObject({ name: "Sin Teléfono", phone: null });
    expect(preview.rows[3]).toMatchObject({ name: "Rodrigo Arias", title: "Dr.", phone: "+5492235627681", phone_kind: "consultorio", website: "https://abconsultorios.com/" });
    expect(parseOutreachImport("nombre,telefono,tipo_telefono\nAna,2235627681,Recepción").rows[0].phone_kind).toBe("consultorio");
    expect(preview.problems.map((p) => p.line)).toEqual([4]);
    expect(parseOutreachImport("telefono\n223 4123456").problems[0].reason).toContain("nombre");
  });
});
