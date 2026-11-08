"use client";

import { useState } from "react";
import type { JapanDeckCard } from "@/lib/japan/decklist-content";

export function JapanDecklistDisclosure({ decklistUrl }: { decklistUrl: string }) {
  const [open, setOpen] = useState(false);
  const [cards, setCards] = useState<JapanDeckCard[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadCards() {
    setLoading(true);
    setError("");
    try {
      const decklistId = decklistUrl.split("/").at(-1);
      const response = await fetch(`/api/japan/decklist?id=${encodeURIComponent(decklistId ?? "")}`);
      const body = await response.json() as { cards?: JapanDeckCard[]; error?: string };
      if (!response.ok || !body.cards) throw new Error(body.error ?? "Could not load this decklist.");
      setCards(body.cards);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load this decklist.");
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (!cards) void loadCards();
  }

  return <div className="w-full">
    <button type="button" onClick={toggle} aria-expanded={open} className="inline-flex min-h-10 items-center rounded-lg bg-[#27566a] px-4 text-sm font-semibold text-white hover:bg-[#18323d] focus:outline-none focus:ring-2 focus:ring-[#9fd1e3]">
      {open ? "Hide decklist ▲" : "Show decklist ▼"}
    </button>
    {open && <div className="mt-4 rounded-xl border border-[#e8e6de] bg-[#fbfaf6] p-4" aria-live="polite">
      {loading && <p className="text-sm text-[#52616b]">Loading decklist…</p>}
      {error && <div><p className="text-sm text-[#9b3c36]">{error}</p><button type="button" onClick={() => void loadCards()} className="mt-2 text-sm font-semibold text-[#27566a] underline">Retry</button></div>}
      {cards && <div className="grid gap-5 sm:grid-cols-3">{(["Pokémon", "Trainer", "Energy"] as const).map((section) => {
        const sectionCards = cards.filter((card) => card.section === section);
        return <section key={section}>
          <h3 className="mb-2 border-b border-[#e8e6de] pb-2 text-sm font-semibold text-[#1d343f]">{section} ({sectionCards.reduce((sum, card) => sum + card.quantity, 0)})</h3>
          <ul className="space-y-1.5">{sectionCards.map((card, index) => <li key={`${card.setCode}-${card.cardNumber}-${index}`} className="flex items-start gap-2 text-sm text-[#344b54]"><span className="w-5 shrink-0 font-semibold tabular-nums">{card.quantity}</span><span>{card.name}<span className="ml-1 text-xs text-[#78858a]">{card.setCode} {card.cardNumber}</span></span></li>)}</ul>
        </section>;
      })}</div>}
    </div>}
  </div>;
}
