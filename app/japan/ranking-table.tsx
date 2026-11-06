"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DeckSprites } from "../components/deck-sprites";
import { MobileSortControls } from "../components/mobile-sort-controls";
import type { JapanArchetypeSummary } from "@/lib/japan/overview";

type SortKey = "name" | "placementPoints" | "wins" | "top8" | "share";
type Direction = "asc" | "desc";
const top8Share = (top8: number, classifiedTop8: number) => classifiedTop8 ? top8 / classifiedTop8 : 0;

export function JapanRankingTable({ archetypes, classifiedTop8, showAll, detailQuery }: { archetypes: JapanArchetypeSummary[]; classifiedTop8: number; showAll: boolean; detailQuery: string }) {
  const [sort, setSort] = useState<{ key: SortKey; direction: Direction }>({ key: "placementPoints", direction: "desc" });
  const onSort = (key: SortKey) => setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "name" ? "asc" : "desc" });
  const ranked = useMemo(() => archetypes.map((deck, index) => ({ deck, rank: index + 1 })).slice(0, showAll ? undefined : 30), [archetypes, showAll]);
  const visible = useMemo(() => [...ranked].sort((a, b) => {
    const left = sort.key === "name" ? a.deck.name : sort.key === "share" ? top8Share(a.deck.top8, classifiedTop8) : a.deck[sort.key];
    const right = sort.key === "name" ? b.deck.name : sort.key === "share" ? top8Share(b.deck.top8, classifiedTop8) : b.deck[sort.key];
    const result = typeof left === "string" ? left.localeCompare(right as string) : left - (right as number);
    return (sort.direction === "asc" ? result : -result) || a.rank - b.rank;
  }), [ranked, classifiedTop8, sort]);
  const header = (label: string, key: SortKey, className = "") => <th scope="col" aria-sort={sort.key === key ? sort.direction === "asc" ? "ascending" : "descending" : "none"} className={`px-3 py-3 ${className}`}><button type="button" onClick={() => onSort(key)} className="inline-flex items-center gap-1 font-inherit hover:text-[#27566a] focus:outline-none focus:ring-2 focus:ring-[#3485a4]" aria-label={`Sort by ${label}`}>{label}<span aria-hidden="true">{sort.key === key ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</span></button></th>;

  return <div className="px-4 pb-4 pt-4 md:p-0">
    <MobileSortControls id="japan-ranking-sort" label="Sort archetypes by" options={[{ key: "name", label: "Deck" }, { key: "placementPoints", label: "Points" }, { key: "wins", label: "1st" }, { key: "top8", label: "Top 8" }, { key: "share", label: "Top 8 share" }]} sort={sort} onSelect={(key) => setSort({ key, direction: key === "name" ? "asc" : "desc" })} onToggle={() => setSort((current) => ({ ...current, direction: current.direction === "asc" ? "desc" : "asc" }))} />
    <div className="overflow-hidden md:overflow-x-auto">
      <table className="block w-full border-collapse text-left text-sm md:table md:min-w-[760px] md:table-fixed">
        <colgroup><col /><col className="w-24" /><col className="w-20" /><col className="w-24" /><col className="w-28" /><col className="w-32" /></colgroup>
        <thead className="hidden bg-[#f8f7f3] text-xs font-semibold uppercase tracking-wider text-[#758289] md:table-header-group"><tr>
          <th scope="col" aria-sort={sort.key === "name" ? sort.direction === "asc" ? "ascending" : "descending" : "none"} className="px-5 py-3 text-left"><button type="button" onClick={() => onSort("name")} className="inline-flex items-center gap-1 font-inherit hover:text-[#27566a] focus:outline-none focus:ring-2 focus:ring-[#3485a4]">Rank / deck <span aria-hidden="true">{sort.key === "name" ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</span></button></th>
          {header("Points", "placementPoints", "text-right")}{header("1st", "wins", "text-right")}{header("Top 8", "top8", "text-right")}{header("Top 8 share", "share", "text-right")}
          <th scope="col" className="px-5 py-3 text-right">Winning list</th>
        </tr></thead>
        <tbody className="block divide-y divide-[#eeece6] md:table-row-group md:divide-y-0">{visible.map(({ deck, rank }) => <tr key={deck.id} className="grid grid-cols-2 gap-2 py-4 hover:bg-[#faf9f6] md:table-row md:border-t md:border-[#eeece6] md:p-0">
          <th scope="row" className="col-span-2 block pb-1 text-left font-medium md:table-cell md:px-5 md:py-4 md:pb-4 md:align-middle"><span className="flex min-w-0 items-center gap-2 text-[#1d343f]"><span className="w-6 shrink-0 tabular-nums text-[#9aa3a5]">{rank}</span><DeckSprites icons={deck.icons} /><Link className="min-w-0 break-words font-semibold underline decoration-[#b7c8cf] underline-offset-4 hover:text-[#27566a] hover:decoration-[#3485a4] focus:outline-none focus:ring-2 focus:ring-[#9fd1e3]" href={`/japan/decks/${encodeURIComponent(deck.id)}${detailQuery}`}>{deck.name}</Link></span></th>
          <td className="rounded-lg bg-[#f7f8f4] px-3 py-2 text-right font-bold tabular-nums text-[#1d343f] md:table-cell md:rounded-none md:bg-transparent md:py-4"><span className="mb-1 block text-left text-[10px] font-bold uppercase tracking-wide text-[#718087] md:hidden">Points</span>{deck.placementPoints}</td>
          <td className="rounded-lg bg-[#f7f8f4] px-3 py-2 text-right tabular-nums text-[#52616b] md:table-cell md:rounded-none md:bg-transparent md:py-4"><span className="mb-1 block text-left text-[10px] font-bold uppercase tracking-wide text-[#718087] md:hidden">1st</span>{deck.wins}</td>
          <td className="rounded-lg bg-[#f7f8f4] px-3 py-2 text-right tabular-nums text-[#52616b] md:table-cell md:rounded-none md:bg-transparent md:py-4"><span className="mb-1 block text-left text-[10px] font-bold uppercase tracking-wide text-[#718087] md:hidden">Top 8</span>{deck.top8}</td>
          <td className="rounded-lg bg-[#f7f8f4] px-3 py-2 text-right tabular-nums text-[#52616b] md:table-cell md:rounded-none md:bg-transparent md:py-4"><span className="mb-1 block text-left text-[10px] font-bold uppercase tracking-wide text-[#718087] md:hidden">Top 8 share</span>{classifiedTop8 ? `${(top8Share(deck.top8, classifiedTop8) * 100).toFixed(1)}%` : "—"}</td>
          <td className="col-span-2 pt-1 md:table-cell md:px-5 md:py-4 md:pt-4 md:text-right">{deck.latestWinningListUrl ? <a className="block rounded-lg border border-[#c6d0d0] bg-white px-3 py-2 text-center font-semibold text-[#27566a] hover:border-[#3485a4] md:inline md:border-0 md:bg-transparent md:p-0 md:text-right md:underline md:underline-offset-4" href={deck.latestWinningListUrl} target="_blank" rel="noreferrer" aria-label={`Latest 1st-place ${deck.name} list on Limitless`}><span className="md:hidden">Winning list · </span>{deck.latestWinningDate} ↗</a> : <span className="text-[#9aa3a5]"><span className="md:hidden">No winning list</span><span className="hidden md:inline">—</span></span>}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
