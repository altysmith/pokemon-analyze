import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LoMeta — 2027 Pokémon TCG Regional Trends",
  description: "Track Pokémon TCG Regional metagame share, win rates, conversion, and matchups for the 2027 season.",
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
