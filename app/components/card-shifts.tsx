"use client";

import { useEffect, useState } from "react";
import type { CardComparison, CardShift } from "@/lib/limitless/card-trends";
import type { MetaDeck, RegionalData } from "@/lib/limitless/season";
import { DeckSprites } from "./deck-sprites";

function CardList({ title, cards, direction }: { title: string; cards: CardShift[]; direction: "added" | "removed" }) {
  return <div className="rounded-2xl border border-[#d7d5cc] bg-white p-5">
    <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-[#52616b]">{title}</h3>
    {cards.length ? <ol className="mt-3 divide-y divide-[#eeede8]">{cards.map((card) =>
      <li key={card.id} className="flex items-center justify-between gap-4 py-3 text-sm">
        <div className="min-w-0"><div className="font-semibold text-[#1b2930]">{card.name}</div><div className="text-xs text-[#78858a]">{card.set} {card.number} · {card.from.toFixed(2)} → {card.to.toFixed(2)} copies/list</div></div>
        <span className={`whitespace-nowrap font-mono font-semibold ${direction === "added" ? "text-[#237444]" : "text-[#bd4c45]"}`}>{card.change > 0 ? "+" : ""}{card.change.toFixed(2)}</span>
      </li>)}</ol> : <p className="mt-4 text-sm text-[#738088]">No change of at least 0.10 copies per list.</p>}
  </div>;
}

export function CardShifts({ from, to, ranking }: { from: RegionalData; to: RegionalData; ranking: MetaDeck[] }) {
  const available = ranking.filter((deck) => deck.slug !== "other" && deck.slug !== "unknown").slice(0, 40);
  const [chosenSlug, setChosenSlug] = useState("");
  const selected = available.find((deck) => deck.slug === chosenSlug) ?? available[0];
  const key = selected ? `${from.id}:${to.id}:${selected.slug}` : "";
  const [result, setResult] = useState<{ key: string; data: CardComparison | null; error: string } | null>(null);
  const loading = Boolean(key && result?.key !== key);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    fetch(`/api/season/cards?from=${from.id}&to=${to.id}&deck=${encodeURIComponent(key.split(":")[2])}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as CardComparison & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Unable to load card averages.");
        return body;
      })
      .then((data) => { if (!controller.signal.aborted) setResult({ key, data, error: "" }); })
      .catch((error) => { if (!controller.signal.aborted) setResult({ key, data: null, error: error instanceof Error ? error.message : "Unable to load card averages." }); });
    return () => controller.abort();
  }, [from.id, to.id, key]);

  const current = result?.key === key ? result : null;
  return <section>
    <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
      <div><p className="section-kicker">Deck construction</p><h2 className="section-title">Cards gaining and losing slots</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-[#738088]">Five biggest changes in average copies per published list from {from.shortName} to {to.shortName}. Exact card printings are compared; this is an archetype-level signal, not edits to one player’s deck.</p></div>
      {available.length ? <div className="min-w-56"><label htmlFor="card-shift-deck" className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#6f7a7f]">Top 40 meta decks</label><select id="card-shift-deck" value={selected?.slug ?? ""} onChange={(event) => setChosenSlug(event.target.value)} className="w-full rounded-xl border border-[#bfc8c9] bg-white px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#3485a4]">{available.map((deck, index) => <option key={deck.slug} value={deck.slug}>{index + 1}. {deck.name}</option>)}</select>{selected ? <div className="mt-2 flex items-center gap-2 text-xs text-[#66747b]"><DeckSprites icons={selected.icons} compact /><span>{selected.name}</span></div> : null}</div> : null}
    </div>
    {!selected ? <p className="rounded-2xl border border-[#d7d5cc] bg-white p-5 text-sm text-[#738088]">No ranked decks are available for this geography.</p> : null}
    {selected && loading ? <p className="rounded-2xl border border-[#d7d5cc] bg-white p-5 text-sm text-[#738088]">Loading card averages…</p> : null}
    {selected && current?.error ? <p className="rounded-2xl border border-[#d7d5cc] bg-white p-5 text-sm text-[#aa4d44]">{current.error}</p> : null}
    {selected && current?.data ? <>
      <p className="mb-4 text-xs text-[#738088]">Published lists: {current.data.fromDecklists} at {from.shortName} → {current.data.toDecklists} at {to.shortName}. Not every player has a published list, so treat these shifts as directional. <a href={current.data.fromUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">First source</a> · <a href={current.data.toUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">Last source</a></p>
      {current.data.status === "ok" ? <div className="grid gap-5 lg:grid-cols-2"><CardList title="Added more often" cards={current.data.added} direction="added" /><CardList title="Removed more often" cards={current.data.removed} direction="removed" /></div> : <p className="rounded-2xl border border-[#d7d5cc] bg-white p-5 text-sm text-[#68777f]">{current.data.message}</p>}
    </> : null}
  </section>;
}
