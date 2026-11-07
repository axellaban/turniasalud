// La demo de cada odontólogo (/p/<código>): una sola pantalla, sin el menú ni el pie de la web.
export default function PersonalLayout({ children }: LayoutProps<"/">) {
  return <main className="flex flex-1 flex-col">{children}</main>;
}
