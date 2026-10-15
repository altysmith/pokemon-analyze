"use client";

import { DeckSprites } from "./deck-sprites";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { Geography, Matchup, MetaDeck } from "@/lib/limitless/season";

const GEO: Array<{ value: Geography; label: string }> = [
  { value: "all", label: "All regionals" },
  { value: "us", label: "US" },
  { value: "europe", label: "Europe" },
  { value: "south-america", label: "South America" },
  { value: "oceania", label: "Oceania" },
];
const categories = ["favorable", "neutral", "unfavorable"] as const;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const EMPTY_MATCHUPS: Matchup[] = [];

function MatchupCounts({ matchups, opponents, loading }: { matchups: Matchup[] | null | undefined; opponents: Set<string>; loading: boolean }) {
  if (loading) return <span className="text-xs text-[#78858a]">Loading…</span>;
  if (!matchups) return <span className="text-xs text-[#aa4d44]">Unavailable</span>;
  const rows = matchups.filter((matchup) => opponents.has(matchup.slug));
  const favorable = rows.filter((matchup) => matchup.category === "favorable").length;
  const neutral = rows.filter((matchup) => matchup.category === "neutral").length;
  const unfavorable = rows.filter((matchup) => matchup.category === "unfavorable").length;
  return <span className="font-mono font-semibold tabular-nums" aria-label={`${favorable} favorable, ${neutral} neutral, ${unfavorable} unfavorable`}><span className="text-[#237444]">{favorable}</span>-<span className="text-[#586d78]">{neutral}</span>-<span className="text-[#bd4c45]">{unfavorable}</span></span>;
}

export function OverallMeta({ byGeography }: { byGeography: Record<Geography, MetaDeck[]> }) {
  const [geography, setGeography] = useState<Geography>("all");
  const decks = byGeography[geography].slice(0, 15);
  const [opponentCount, setOpponentCount] = useState<10 | 15>(10);
  const opponentSlugs = new Set(decks.slice(0, opponentCount).map((deck) => deck.slug));
  const matchupKey = `${geography}:${decks.map((deck) => deck.slug).join(",")}`;
  const [matchupData, setMatchupData] = useState<{ key: string; rows: Record<string, Matchup[] | null> } | null>(null);
  const loading = matchupData?.key !== matchupKey;
  const matchupRows = loading ? {} : matchupData?.rows ?? {};
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const selected = decks.find((deck) => deck.slug === selectedSlug);
  const matchups = selectedSlug && selectedSlug in matchupRows ? matchupRows[selectedSlug] ?? EMPTY_MATCHUPS : EMPTY_MATCHUPS;
  const error = !loading && selectedSlug && matchupRows[selectedSlug] === null ? "Unable to load matchup records." : "";
  const [category, setCategory] = useState<"all" | Matchup["category"]>("all");
  const [opponentSlug, setOpponentSlug] = useState("");
  const [showAllMatchups, setShowAllMatchups] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all(matchupKey.split(":")[1].split(",").filter(Boolean).map(async (slug) => {
      try {
        const response = await fetch(`/api/season/matchups?deck=${encodeURIComponent(slug)}&geography=${geography}`, { signal: controller.signal });
        if (!response.ok) return [slug, null] as const;
        const body = await response.json() as { matchups?: Matchup[] };
        return [slug, body.matchups ?? []] as const;
      } catch {
        return [slug, null] as const;
      }
    })).then((rows) => {
      if (!controller.signal.aborted) setMatchupData({ key: matchupKey, rows: Object.fromEntries(rows) });
    });
    return () => controller.abort();
  }, [geography, matchupKey]);

  const categorized = useMemo(() => Object.fromEntries(categories.map((category) =>
    [category, matchups.filter((matchup) => matchup.category === category)]
  )) as Record<(typeof categories)[number], Matchup[]>, [matchups]);
  const filtered = useMemo(() => matchups.filter((matchup) => category === "all" || matchup.category === category)
    .sort((a, b) => a.name.localeCompare(b.name)), [matchups, category]);
  const rankedMatchups = useMemo(() => [...filtered].sort((a, b) => b.matches - a.matches), [filtered]);
  const visibleMatchups = showAllMatchups ? rankedMatchups : rankedMatchups.slice(0, 5);
  const opponent = filtered.find((matchup) => matchup.slug === opponentSlug);

  function changeGeography(value: Geography) {
    setGeography(value);
    setSelectedSlug("");
    setCategory("all");
    setOpponentSlug("");
    setShowAllMatchups(false);
  }

  function toggleDeck(slug: string) {
    setSelectedSlug((current) => current === slug ? "" : slug);
    setCategory("all");
    setOpponentSlug("");
    setShowAllMatchups(false);
  }

  return (
    <>
      <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="section-kicker">2027 season / five regionals</p>
          <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Overall metagame</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#67757d]">The 15 most played decks across the selected Regionals. Favorable–neutral–unfavorable matchup counts are shown in each row; open Full matchup for opponent records.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
          <label htmlFor="overall-geography" className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#6f7a7f]">Geography</label>
          <select id="overall-geography" value={geography} onChange={(event) => changeGeography(event.target.value as Geography)} className="w-full rounded-xl border border-[#bfc8c9] bg-white px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#3485a4]">
            {GEO.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          </div>
          <div className="min-w-44 flex-1">
            <label htmlFor="overall-opponents" className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#6f7a7f]">Top meta matchups</label>
            <select id="overall-opponents" value={opponentCount} onChange={(event) => setOpponentCount(Number(event.target.value) as 10 | 15)} className="w-full rounded-xl border border-[#bfc8c9] bg-white px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#3485a4]">
              <option value={10}>Versus top 10</option>
              <option value={15}>Versus top 15</option>
            </select>
          </div>
        </div>
      </div>

        <section className="overflow-hidden rounded-2xl border border-[#d7d5cc] bg-white" aria-label="Top 15 decks">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-[#eeede7] text-xs uppercase tracking-wider text-[#6f7a7f]"><tr><th className="px-4 py-3"># / Deck</th><th className="px-3 py-3 text-right">Share</th><th className="px-3 py-3 text-right">Win %</th><th className="px-3 py-3 text-right">Day 2</th><th className="px-3 py-3 text-right">F–N–U <span className="sr-only">Favorable–neutral–unfavorable matchups against top meta decks</span></th><th className="px-4 py-3 text-right"><span className="sr-only">Full matchup details</span></th></tr></thead>
              <tbody className="divide-y divide-[#eeede8]">
                {decks.map((deck, index) => <Fragment key={deck.slug}><tr className={selected?.slug === deck.slug ? "bg-[#e9f1ec]" : "hover:bg-[#f7f6f2]"}>
                  <td className="px-4 py-3"><span className="mr-3 font-mono text-xs text-[#9ca5a8]">{index + 1}</span><span className="inline-flex items-center gap-2 font-semibold"><DeckSprites icons={deck.icons} /><span>{deck.name}</span></span></td>
                  <td className="px-3 py-3 text-right font-mono">{percent(deck.share)}</td>
                  <td className="px-3 py-3 text-right font-mono font-semibold">{percent(deck.winRate)}</td>
                  <td className="px-3 py-3 text-right font-mono">{deck.conversion === null ? "—" : percent(deck.conversion)}</td>
                  <td className="px-3 py-3 text-right"><MatchupCounts matchups={matchupRows[deck.slug]} opponents={opponentSlugs} loading={loading} /></td>
                  <td className="px-4 py-3 text-right"><button type="button" onClick={() => toggleDeck(deck.slug)} aria-expanded={selected?.slug === deck.slug} aria-controls={`matchup-${deck.slug}`} className="whitespace-nowrap rounded-md border border-[#c6d0d0] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#27566a] hover:border-[#3485a4] focus:outline-none focus:ring-2 focus:ring-[#3485a4]">{selected?.slug === deck.slug ? "Close ↑" : "Full matchup ↗"}</button></td>
                </tr>
                {selected?.slug === deck.slug ? <tr id={`matchup-${deck.slug}`}><td colSpan={6} className="bg-[#f7f8f4] px-4 py-5 sm:px-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div><p className="section-kicker">Matchup profile</p><h2 className="flex items-center gap-2 text-xl font-semibold"><DeckSprites icons={deck.icons} /><span>{deck.name}</span></h2><p className="mt-1 text-xs text-[#78858a]">{deck.record.wins}–{deck.record.losses}–{deck.record.ties} across {deck.events} event{deck.events === 1 ? "" : "s"}</p></div>
                    {!loading && !error ? <div className="flex flex-wrap gap-2" aria-label="Matchup categories">{categories.map((item) => <span key={item} className={`rounded-lg px-3 py-2 text-xs font-semibold ${item === "favorable" ? "bg-[#e3f2e5] text-[#237444]" : item === "unfavorable" ? "bg-[#f9e8e5] text-[#bd4c45]" : "bg-[#e9eef0] text-[#586d78]"}`}>{categorized[item].length} {item}</span>)}</div> : null}
                  </div>
                  {loading ? <p className="mt-5 text-sm text-[#6f7b80]">Loading matchup records…</p> : null}
                  {error ? <p className="mt-5 text-sm text-[#aa4d44]">{error}</p> : null}
                  {!loading && !error ? <><div className="mt-5 grid gap-4 border-t border-[#dfe2dc] pt-5 md:grid-cols-[minmax(0,180px)_minmax(0,280px)_minmax(0,1fr)] md:items-end">
                    <div><label htmlFor="matchup-category" className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#6f7a7f]">Result category</label><select id="matchup-category" value={category} onChange={(event) => { setCategory(event.target.value as typeof category); setOpponentSlug(""); setShowAllMatchups(false); }} className="w-full rounded-xl border border-[#bfc8c9] bg-white px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3485a4]"><option value="all">All matchups</option><option value="favorable">Favorable (≥55%)</option><option value="neutral">Neutral (45–55%)</option><option value="unfavorable">Unfavorable (≤45%)</option></select></div>
                    <div><label htmlFor="matchup-opponent" className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#6f7a7f]">Opposing meta deck</label><select id="matchup-opponent" value={opponentSlug} onChange={(event) => { setOpponentSlug(event.target.value); if (event.target.value) setShowAllMatchups(true); }} className="w-full rounded-xl border border-[#bfc8c9] bg-white px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3485a4]"><option value="">Select a deck…</option>{filtered.map((matchup) => <option key={matchup.slug} value={matchup.slug}>{matchup.name} · {percent(matchup.winRate)}</option>)}</select></div>
                    <div className="min-h-12 rounded-xl border border-[#e0e3df] bg-white px-4 py-3 text-sm" aria-live="polite">{opponent ? <div className="flex flex-wrap items-center justify-between gap-2"><span className="inline-flex items-center gap-1 font-semibold">vs. <DeckSprites icons={opponent.icons} compact />{opponent.name}</span><span className={opponent.category === "favorable" ? "font-bold text-[#237444]" : opponent.category === "unfavorable" ? "font-bold text-[#bd4c45]" : "font-bold text-[#586d78]"}>{percent(opponent.winRate)} · {opponent.category}</span><span className="font-mono text-xs text-[#78858a]">{opponent.record.wins}–{opponent.record.losses}–{opponent.record.ties} ({opponent.matches} matches)</span></div> : <span className="text-[#78858a]">Choose an opposing deck to see its win rate and record.</span>}</div>
                  </div>
                    <div className="mt-5 overflow-x-auto rounded-xl border border-[#dfe2dc] bg-white">
                      <table className="w-full min-w-[570px] text-left text-sm" aria-label={`${deck.name} matchup records`}>
                        <thead className="bg-[#eeede7] text-xs uppercase tracking-wider text-[#6f7a7f]"><tr><th className="px-4 py-3">Opposing deck</th><th className="px-3 py-3 text-right">W–L–T</th><th className="px-3 py-3 text-right">Win %</th><th className="px-4 py-3 text-right">Result</th></tr></thead>
                        <tbody className="divide-y divide-[#eeede8]">{visibleMatchups.map((matchup) => <tr key={matchup.slug} className={opponentSlug === matchup.slug ? "bg-[#e9f1ec]" : ""}><td className="px-4 py-3 font-semibold"><span className="inline-flex items-center gap-2"><DeckSprites icons={matchup.icons} compact /><span>{matchup.name}</span></span></td><td className="px-3 py-3 text-right font-mono">{matchup.record.wins}–{matchup.record.losses}–{matchup.record.ties}</td><td className="px-3 py-3 text-right font-mono">{percent(matchup.winRate)}</td><td className={`px-4 py-3 text-right font-semibold capitalize ${matchup.category === "favorable" ? "text-[#237444]" : matchup.category === "unfavorable" ? "text-[#bd4c45]" : "text-[#586d78]"}`}>{matchup.category}</td></tr>)}</tbody>
                      </table>
                      {filtered.length === 0 ? <p className="px-4 py-5 text-sm text-[#78858a]">No matchups in this category.</p> : null}
                    </div>
                    {rankedMatchups.length > 5 ? <button type="button" onClick={() => setShowAllMatchups((current) => !current)} className="mt-3 rounded-lg border border-[#b9c7c9] bg-white px-4 py-2 text-xs font-semibold text-[#27566a] hover:border-[#3485a4] focus:outline-none focus:ring-2 focus:ring-[#3485a4]">{showAllMatchups ? "Show fewer matchups ↑" : `See more (${rankedMatchups.length - 5} remaining) ↓`}</button> : null}
                  </> : null}
                </td></tr> : null}</Fragment>)}
              </tbody>
            </table>
          </div>
        </section>

      <p className="mt-8 text-xs leading-5 text-[#718087]">F–N–U counts favorable, neutral, and unfavorable records versus the selected top 10 or 15 opposing meta decks. Only recorded matchups count; mirror matches are excluded. Share is player count divided by all players in the selected events. Win percentages combine W–L–T records, counting each tie as one-third of a win. A matchup at exactly 55% is favorable; exactly 45% is unfavorable.</p>
    </>
  );
}
