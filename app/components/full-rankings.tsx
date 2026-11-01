"use client";
import Link from "next/link";

import { useMemo, useState } from "react";
import type { Geography, MetaDeck } from "@/lib/limitless/season";
import { DeckSprites } from "./deck-sprites";
import { MobileSortControls } from "./mobile-sort-controls";

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

type SortKey = "name" | "share" | "winRate" | "conversion";
type SortDirection = "asc" | "desc";

function SortHeader({ label, sortKey, active, direction, onSort, className = "" }: { label: string; sortKey: SortKey; active: boolean; direction: SortDirection; onSort: (key: SortKey) => void; className?: string }) {
  return <th scope="col" aria-sort={active ? direction === "asc" ? "ascending" : "descending" : "none"} className={`px-3 py-3 ${className}`}><button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1 font-inherit hover:text-[#27566a] focus:outline-none focus:ring-2 focus:ring-[#3485a4]" aria-label={`Sort by ${label}`}>{label}<span aria-hidden="true">{active ? direction === "asc" ? "↑" : "↓" : "↕"}</span></button></th>;
}

export function FullRankings({ byGeography }: { byGeography: Record<Geography, MetaDeck[]> }) {
  const [geography, setGeography] = useState<Geography>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: "share", direction: "desc" });
  const ranked = byGeography[geography];
  const visible = useMemo(() => ranked.map((deck, index) => ({ deck, rank: index + 1 }))
    .filter(({ deck }) => deck.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => {
      const left = sort.key === "name" ? a.deck.name : a.deck[sort.key];
      const right = sort.key === "name" ? b.deck.name : b.deck[sort.key];
      if (left === null) return 1;
      if (right === null) return -1;
      const result = typeof left === "string" ? left.localeCompare(right as string) : (left as number) - (right as number);
      return sort.direction === "asc" ? result : -result;
    }), [ranked, search, sort]);
  const onSort = (key: SortKey) => setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "name" ? "asc" : "desc" });

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
    <MobileSortControls id="full-ranking-sort" label="Sort decks by" options={[{ key: "name", label: "Deck" }, { key: "share", label: "Share" }, { key: "winRate", label: "Win %" }, { key: "conversion", label: "Day 2" }]} sort={sort} onSelect={(key) => setSort({ key, direction: key === "name" ? "asc" : "desc" })} onToggle={() => setSort((current) => ({ ...current, direction: current.direction === "asc" ? "desc" : "asc" }))} />
    <section className="overflow-hidden rounded-2xl border border-[#d7d5cc] bg-white" aria-label="Full deck ranking">
      <div className="overflow-hidden md:overflow-x-auto">
        <table className="block w-full text-left text-sm md:table md:min-w-[700px] md:table-fixed">
          <colgroup><col /><col className="w-28" /><col className="w-28" /><col className="w-28" /></colgroup>
          <thead className="hidden bg-[#eeede7] text-xs uppercase tracking-wider text-[#6f7a7f] md:table-header-group"><tr><SortHeader label="# / Deck" sortKey="name" active={sort.key === "name"} direction={sort.direction} onSort={onSort} className="pl-4" /><SortHeader label="Share" sortKey="share" active={sort.key === "share"} direction={sort.direction} onSort={onSort} className="text-right" /><SortHeader label="Win %" sortKey="winRate" active={sort.key === "winRate"} direction={sort.direction} onSort={onSort} className="text-right" /><SortHeader label="Day 2" sortKey="conversion" active={sort.key === "conversion"} direction={sort.direction} onSort={onSort} className="pr-4 text-right" /></tr></thead>
          <tbody className="block divide-y divide-[#eeede8] md:table-row-group">{visible.map(({ deck, rank }) => <tr key={deck.slug} className="grid grid-cols-3 gap-2 p-4 hover:bg-[#f7f6f2] md:table-row md:p-0">
            <td className="col-span-3 pb-2 md:table-cell md:px-4 md:py-3"><span className="flex min-w-0 items-center gap-2 font-semibold"><span className="w-6 shrink-0 font-mono text-xs text-[#9ca5a8]">{rank}</span><DeckSprites icons={deck.icons} /><a href={deck.limitlessUrl} className="min-w-0 break-words underline decoration-[#aac6cd] underline-offset-4 hover:text-[#27566a] focus:outline-none focus:ring-2 focus:ring-[#3485a4]" aria-label={`${deck.name} on Limitless`}>{deck.name} <span aria-hidden="true">↗</span></a></span></td>
            <td className="rounded-lg bg-[#f7f8f4] px-2 py-2 text-center font-mono tabular-nums md:table-cell md:rounded-none md:bg-transparent md:px-3 md:py-3 md:text-right"><span className="mb-1 block font-sans text-[10px] font-bold uppercase text-[#718087] md:hidden">Share</span>{sharePercent(deck.share)}</td>
            <td className="rounded-lg bg-[#f7f8f4] px-2 py-2 text-center font-mono font-semibold tabular-nums md:table-cell md:rounded-none md:bg-transparent md:px-3 md:py-3 md:text-right"><span className="mb-1 block font-sans text-[10px] font-bold uppercase text-[#718087] md:hidden">Win %</span>{percent(deck.winRate)}</td>
            <td className="rounded-lg bg-[#f7f8f4] px-2 py-2 text-center font-mono tabular-nums md:table-cell md:rounded-none md:bg-transparent md:px-4 md:py-3 md:text-right"><span className="mb-1 block font-sans text-[10px] font-bold uppercase text-[#718087] md:hidden">Day 2</span>{deck.conversion === null ? "—" : percent(deck.conversion)}</td>
          </tr>)}</tbody>
        </table>
        {visible.length === 0 ? <p className="px-4 py-8 text-center text-sm text-[#718087]">No decks match that search.</p> : null}
      </div>
    </section>
    <p className="mt-8 text-xs leading-5 text-[#718087]">Share is player count divided by all players in the selected events. Win percentages combine W–L–T records, counting each tie as one-third of a win.</p>
  </>;
}
