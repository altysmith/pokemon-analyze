"use client";
import Link from "next/link";

import { useState } from "react";
import type { Geography, MetaDeck } from "@/lib/limitless/season";
import { DeckSprites } from "./deck-sprites";

const geographies: Array<{ value: Geography; label: string }> = [
  { value: "all", label: "All events" },
  { value: "us", label: "US" },
  { value: "europe", label: "Europe" },
  { value: "south-america", label: "South America" },
  { value: "oceania", label: "Oceania" },
  { value: "other", label: "Other locations" },
];
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const sharePercent = (value: number) => {
  const percentage = value * 100;
  return percentage > 0 && percentage < 0.01 ? "<0.01%" : `${percentage.toFixed(percentage < 0.1 ? 2 : 1)}%`;
};

export function FullRankings({ byGeography }: { byGeography: Record<Geography, MetaDeck[]> }) {
  const [geography, setGeography] = useState<Geography>("all");
  const [search, setSearch] = useState("");
  const ranked = byGeography[geography];
  const visible = ranked.map((deck, index) => ({ deck, rank: index + 1 }))
    .filter(({ deck }) => deck.name.toLowerCase().includes(search.trim().toLowerCase()));

  return <>
    <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
      <div><p className="section-kicker">2027 season / major events</p><h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Full deck ranking</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-[#67757d]">Every deck ranked by metagame share across Regionals and Special Events. Rankings preserve their overall position while you search.</p></div>
      <Link href="/" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#bfc8c9] bg-white px-4 py-3 text-sm font-semibold text-[#27566a] hover:border-[#3485a4]">← Top 25 & matchups</Link>
    </div>
    <div className="mb-4 flex flex-col gap-3 sm:flex-row">
      <div className="sm:w-56"><label htmlFor="ranking-geography" className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#6f7a7f]">Geography</label><select id="ranking-geography" value={geography} onChange={(event) => setGeography(event.target.value as Geography)} className="w-full rounded-xl border border-[#bfc8c9] bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3485a4]">{geographies.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
      <div className="flex-1"><label htmlFor="ranking-search" className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#6f7a7f]">Find a deck</label><input id="ranking-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search deck names" className="w-full rounded-xl border border-[#bfc8c9] bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3485a4]" /></div>
    </div>
    <p className="mb-3 text-xs text-[#718087]">Showing {visible.length} of {ranked.length} ranked decks</p>
    <section className="overflow-hidden rounded-2xl border border-[#d7d5cc] bg-white" aria-label="Full deck ranking"><div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead className="bg-[#eeede7] text-xs uppercase tracking-wider text-[#6f7a7f]"><tr><th className="px-4 py-3"># / Deck</th><th className="px-3 py-3 text-right">Share</th><th className="px-3 py-3 text-right">Win %</th><th className="px-4 py-3 text-right">Day 2</th></tr></thead><tbody className="divide-y divide-[#eeede8]">{visible.map(({ deck, rank }) => <tr key={deck.slug} className="hover:bg-[#f7f6f2]"><td className="px-4 py-3"><span className="mr-3 font-mono text-xs text-[#9ca5a8]">{rank}</span><span className="inline-flex items-center gap-2 font-semibold"><DeckSprites icons={deck.icons} /><a href={deck.limitlessUrl} className="underline decoration-[#aac6cd] underline-offset-4 hover:text-[#27566a] focus:outline-none focus:ring-2 focus:ring-[#3485a4]" aria-label={`${deck.name} on Limitless`}>{deck.name} <span aria-hidden="true">↗</span></a></span></td><td className="px-3 py-3 text-right font-mono">{sharePercent(deck.share)}</td><td className="px-3 py-3 text-right font-mono font-semibold">{percent(deck.winRate)}</td><td className="px-4 py-3 text-right font-mono">{deck.conversion === null ? "—" : percent(deck.conversion)}</td></tr>)}</tbody></table>{visible.length === 0 ? <p className="px-4 py-8 text-center text-sm text-[#718087]">No decks match that search.</p> : null}</div></section>
    <p className="mt-8 text-xs leading-5 text-[#718087]">Share is player count divided by all players in the selected events. Win percentages combine W–L–T records, counting each tie as one-third of a win.</p>
  </>;
}
