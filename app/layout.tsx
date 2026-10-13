import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LoMeta — Pokémon TCG Metagame Data",
  description: "Compare Pokémon TCG tournament results with the overall metagame.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
