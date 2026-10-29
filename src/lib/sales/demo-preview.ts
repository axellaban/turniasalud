import "server-only";
import { createHash } from "node:crypto";
import { sql } from "@/lib/db";
import { demoExample, dentalServices } from "@/lib/demo/dental-services";
import { imagenPagina } from "@/lib/og";
import type { PublicOutreach } from "./outreach";
import { ofBusiness, withArticle } from "./outreach-messages";

// La vista previa del link de su demo en WhatsApp: el chat con el nombre de su consultorio.
// Armarla tarda 2 a 4 s y WhatsApp no espera tanto (el link sale sin imagen), así que queda guardada
// en la base: la caché de Vercel se borra en cada deploy y se rearma con el primer pedido, tarde.
// Se arma al importar, al editar y al saludar; la que falte, al abrir Panel → Prospección.

/** Cambialo cuando cambie el dibujo (src/lib/og.tsx o el ejemplo del chat): se rearman todas. */
const DISENO = "2026-10-29-jpeg";

type Datos = Pick<PublicOutreach, "name" | "title" | "business_name" | "specialty">;
type Fila = Datos & { id: string; code: string; version: string | null };

/** Cambia cuando cambian los datos que muestra: va en la dirección de la imagen. */
export function demoPreviewVersion(p: Datos): string {
  return createHash("sha256").update(JSON.stringify([DISENO, p.name, p.title, p.business_name, p.specialty])).digest("hex").slice(0, 12);
}

async function render(p: Datos): Promise<Buffer> {
  const consultorio = p.business_name || `Consultorio de ${p.name}`;
  const image = await imagenPagina({
    eyebrow: `Demo para ${consultorio}`,
    titulo: "Sofi, atendiendo el WhatsApp de tu consultorio",
    chat: demoExample(dentalServices(p.specialty), withArticle(p.title, p.name), ofBusiness(consultorio), true),
    nombreChat: consultorio,
  });
  return Buffer.from(await image.arrayBuffer());
}

async function build(p: Fila): Promise<Buffer> {
  const image = await render(p);
  await sql`
    insert into sales_outreach_previews (outreach_id, version, image) values (${p.id}, ${demoPreviewVersion(p)}, ${image})
    on conflict (outreach_id) do update set version = excluded.version, image = excluded.image, created_at = now()`;
  return image;
}

/**
 * La imagen guardada de su link. Si cambiaron sus datos sale la anterior (`fresh: false`, para
 * rearmarla después) y solo se arma en el momento si no hay ninguna.
 */
export async function demoPreviewImage(code: string): Promise<{ image: Buffer; fresh: boolean } | null> {
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(code)) return null;
  const [p] = await sql<Array<Fila & { image: Buffer | null }>>`
    select o.id, o.code, o.name, o.title, o.business_name, o.specialty, v.version, v.image
    from sales_outreach o left join sales_outreach_previews v on v.outreach_id = o.id where o.code = ${code}`;
  if (!p) return null;
  if (p.image) return { image: p.image, fresh: p.version === demoPreviewVersion(p) };
  return { image: await build(p), fresh: true };
}

/**
 * Arma las que faltan o quedaron viejas: las de esos códigos o, sin códigos, las de todos.
 * De a una y hasta `budgetMs`; las que no entran se arman la próxima vez.
 */
export async function ensureDemoPreviews(codes?: string[], { budgetMs = 40_000 } = {}): Promise<number> {
  if (codes && !codes.length) return 0;
  const until = Date.now() + budgetMs;
  let built = 0;
  try {
    const rows = await sql<Fila[]>`
      select o.id, o.code, o.name, o.title, o.business_name, o.specialty, v.version
      from sales_outreach o left join sales_outreach_previews v on v.outreach_id = o.id
      ${codes ? sql`where o.code in ${sql(codes)}` : sql``}
      order by o.created_at, o.code`;
    for (const p of rows) {
      if (Date.now() > until) break;
      if (p.version === demoPreviewVersion(p)) continue;
      await build(p);
      built++;
    }
  } catch (e) {
    // Si falla, se arma cuando la pida WhatsApp: esa vez puede salir sin imagen.
    console.error("No se pudieron armar las vistas previas de las demos", e);
  }
  return built;
}
