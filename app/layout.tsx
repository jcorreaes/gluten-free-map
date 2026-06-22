import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gluten Free Social - Mapa",
  description: "Mapa de restaurantes y tiendas sin gluten",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="h-full">
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
