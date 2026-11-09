import { describe, expect, it } from "vitest";
import { parseOutreachImport } from "./outreach-import";
import {
  DEFAULT_TEMPLATES,
  addBusinessDays,
  displayOutreachPhone,
  mergeTemplates,
  nextFollowUp,
  TEMPLATE_KEYS,
  ofBusiness,
  ofPractice,
  normalizeInstagram,
  splitMessages,
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

  it("elige el paso de la secuencia, siempre a la recepción", () => {
    // Paso 1, sin link; con el saludo mandado, el Paso 2 (pide permiso, sin link).
    expect(whatsappTemplateKey(person)).toBe("whatsapp_abridor");
    expect(whatsappTemplateKey({ ...person, phone_kind: "fijo" } as OutreachPerson)).toBe("whatsapp_abridor");
    const greeted = { ...person, greeted_at: "2026-11-09T12:00:00Z" };
    expect(whatsappTemplateKey(greeted)).toBe("whatsapp_permiso");
    // Con el Paso 2: si respondió después, el Paso 3; si no (o respondió antes, al saludo), el Seguimiento 1.
    const asked = { ...greeted, permission_at: "2026-11-09T13:00:00Z" };
    expect(whatsappTemplateKey(asked)).toBe("whatsapp_sin_respuesta");
    expect(whatsappTemplateKey({ ...asked, last_reply_at: "2026-11-09T12:30:00Z" })).toBe("whatsapp_sin_respuesta");
    expect(whatsappTemplateKey({ ...asked, last_reply_at: "2026-11-09T13:05:00Z" })).toBe("whatsapp_entrega");
    // Después del link: los Seguimientos 2 y 3; con tres, nada más.
    expect(whatsappTemplateKey({ ...asked, touches: 1 })).toBe("whatsapp_seguimiento");
    expect(whatsappTemplateKey({ ...person, touches: 2 })).toBe("whatsapp_reenviable");
    expect(whatsappTemplateKey({ ...person, touches: 3 })).toBeNull();
  });

  it("arma cada paso con su nombre y su demo, sin mensajes a la persona", () => {
    const link = "https://turnia.example/p/moreta-ab3";
    // El Paso 1 no necesita datos del consultorio: «la Dra. Moreta», «el Dr. Arias» o el nombre que tenga.
    expect(renderTemplate(DEFAULT_TEMPLATES.whatsapp_abridor, person, link)).toBe("Buenas! Hablo con la recepción de la Dra. Moreta?");
    expect(renderTemplate(DEFAULT_TEMPLATES.whatsapp_abridor, { ...person, name: "Rodrigo Arias", title: "Dr." }, link)).toBe("Buenas! Hablo con la recepción del Dr. Arias?");
    expect(renderTemplate(DEFAULT_TEMPLATES.whatsapp_abridor, { ...person, name: "Arias Berkovic", title: "" }, link)).toBe("Buenas! Hablo con la recepción de Arias Berkovic?");
    // {del_consultorio}, para quien prefiera nombrar el consultorio.
    expect(renderTemplate("Hablo con la recepción {del_consultorio}?", person, link)).toBe("Hablo con la recepción del Consultorio Odontológico Moreta?");
    expect(ofPractice({ name: "Rodrigo Arias", title: "Dr.", business_name: "" })).toBe("del consultorio de el Dr. Arias");
    expect(ofPractice({ name: "Consultorios Dentales", title: "", business_name: "" })).toBe("de Consultorios Dentales");
    expect(ofPractice({ name: "Luciana Landeras", title: "", business_name: "Ríe odontología - Luciana Landeras" })).toBe("de Ríe odontología");
    expect(ofPractice({ name: "Celia Palmieri", title: "", business_name: "Salva Tu Diente | Celia Palmieri Especialista" })).toBe("de Salva Tu Diente");
    expect(ofPractice({ name: "Carla Ruiz", title: "Dra.", business_name: "Clínica Dental Sur" })).toBe("de la Clínica Dental Sur");
    for (const key of ["whatsapp_abridor", "whatsapp_permiso"] as const) {
      expect(renderTemplate(DEFAULT_TEMPLATES[key], person, link)).not.toContain(link);
    }
    const permiso = renderTemplate(DEFAULT_TEMPLATES.whatsapp_permiso, person, link);
    expect(permiso).toMatch(/^Qué tal! Soy Axel\. Sé que en recepción viven a mil/);
    expect(permiso).toContain("una ayudante virtual cargada con los datos de la Dra. Moreta.");
    for (const key of ["whatsapp_entrega", "whatsapp_sin_respuesta", "whatsapp_reenviable"] as const) {
      const text = renderTemplate(DEFAULT_TEMPLATES[key], person, link);
      expect(text).toContain(link);
      expect(text).not.toMatch(/\{\w+\}/);
    }
    expect(renderTemplate(DEFAULT_TEMPLATES.whatsapp_entrega, person, link)).toMatch(new RegExp(`^Acá tenés: ${link}\n`));
    expect(renderTemplate(DEFAULT_TEMPLATES.whatsapp_sin_respuesta, person, link)).toContain("la prueba que armé para la Dra. Moreta");
    // El Seguimiento 3 son dos mensajes: el segundo, solo, para reenviar a los doctores.
    const forward = splitMessages(renderTemplate(DEFAULT_TEMPLATES.whatsapp_reenviable, person, link));
    expect(forward).toHaveLength(2);
    expect(forward[0]).toMatch(/^Buenas! Para no robarte más tiempo/);
    expect(forward[1]).toMatch(new RegExp(`^Hola Doc! Nos armaron esta prueba gratis cargada con los datos del consultorio: ${link} \\.`));
    expect(splitMessages("Uno\n  ---  \nDos\n---\n")).toEqual(["Uno", "Dos"]);
    expect(splitMessages("Sin cortes")).toEqual(["Sin cortes"]);
    // Ninguno de WhatsApp le habla a la persona por su nombre de pila.
    for (const key of TEMPLATE_KEYS.filter((k) => k.startsWith("whatsapp_"))) expect(DEFAULT_TEMPLATES[key]).not.toContain("{saludo}");
    const doctor = { ...person, name: "Rodrigo Arias", greeting: "Rodrigo", title: "Dr." };
    expect(renderTemplate(DEFAULT_TEMPLATES.llamada, doctor, link)).toContain("¿Es el consultorio del Dr. Arias?");
    expect(recipientLabel({ name: "Fernando A. Secreti", title: "Dr." })).toBe("el Dr. Secreti");
    expect(withArticle("Dra.", "Myriam Moreta")).toBe("la Dra. Myriam Moreta");
    expect(withArticle("", "Agostina Migliora")).toBe("Agostina Migliora");
    expect(ofBusiness("Consultorio Odontológico Capris")).toBe("del Consultorio Odontológico Capris");
    expect(ofBusiness("Clínica Dental Sur")).toBe("de la Clínica Dental Sur");
    expect(ofBusiness("ACHE odontologia integral")).toBe("de ACHE odontologia integral");
    expect(recipientLabel({ name: "Agostina Migliora", title: "" })).toBe("Agostina Migliora");
    const permisoText = renderTemplate(DEFAULT_TEMPLATES.whatsapp_permiso, person, link);
    const { app, web } = whatsappLinks(person.phone!, permisoText);
    expect(app).toBe(`https://wa.me/5492236602433?text=${encodeURIComponent(permisoText)}`);
    expect(web).toContain("web.whatsapp.com/send?phone=5492236602433");
    // Los guardados reemplazan a los de fábrica; los vacíos no. Los de la secuencia anterior ya no se usan.
    expect(mergeTemplates({ whatsapp_entrega: "Acá está: {link}", whatsapp_seguimiento: "  ", whatsapp_1: "Hola {saludo}" })).toMatchObject({
      whatsapp_entrega: "Acá está: {link}",
      whatsapp_seguimiento: DEFAULT_TEMPLATES.whatsapp_seguimiento,
    });
    expect(Object.keys(mergeTemplates({ whatsapp_1: "Hola" }))).not.toContain("whatsapp_1");
  });

  it("programa los seguimientos en días hábiles", () => {
    // Viernes 30/10/2026 + 2 hábiles = martes 3/11.
    expect(addBusinessDays("2026-10-30", 2)).toBe("2026-11-03");
    // El Seguimiento 2 al día hábil siguiente del link (del viernes, el lunes); el 3, dos días hábiles después.
    expect(nextFollowUp("2026-10-26", 1)).toBe("2026-10-27");
    expect(nextFollowUp("2026-10-30", 1)).toBe("2026-11-02");
    expect(nextFollowUp("2026-10-28", 2)).toBe("2026-10-30");
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
