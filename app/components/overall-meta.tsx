"use client";

import { DeckSprites } from "./deck-sprites";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { Geography, Matchup, MetaDeck } from "@/lib/limitless/season";

const GEO: Array<{ value: Geography; label: string }> = [
  { value: "all", label: "All events" },
  { value: "us", label: "US" },
  { value: "europe", label: "Europe" },
  { value: "south-america", label: "South America" },
  { value: "oceania", label: "Oceania" },
  { value: "other", label: "Other locations" },
];
const categories = ["favorable", "neutral", "unfavorable"] as const;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const EMPTY_MATCHUPS: Matchup[] = [];
const MATCHUP_CACHE_MS = 5 * 60 * 1000;
const MATCHUP_CACHE_PREFIX = "lometa:matchups:v1:";

function readCachedMatchups(key: string, slugs: string[]): Record<string, Matchup[]> | null {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return null;
    const entry = JSON.parse(saved) as { expires: number; rows: Record<string, Matchup[]> };
    if (entry.expires > Date.now() && entry.rows && slugs.every((slug) => Array.isArray(entry.rows[slug]))) return entry.rows;
    localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in private browsing; requests still work.
  }
  return null;
}

function MatchupCounts({ matchups, opponents, loading }: { matchups: Matchup[] | null | undefined; opponents: Set<string>; loading: boolean }) {
  if (loading) return <span className="text-xs text-[#78858a]">Loading…</span>;
  if (!matchups) return <span className="text-xs text-[#aa4d44]">Unavailable</span>;
  const rows = matchups.filter((matchup) => opponents.has(matchup.slug));
  const favorable = rows.filter((matchup) => matchup.category === "favorable").length;
  const neutral = rows.filter((matchup) => matchup.category === "neutral").length;
  const unfavorable = rows.filter((matchup) => matchup.category === "unfavorable").length;
  return <span className="font-mono font-semibold tabular-nums" aria-label={`${favorable} favorable, ${neutral} neutral, ${unfavorable} unfavorable opposing decks in the selected top ${opponents.size}, excluding mirror matches`}><span className="text-[#237444]">{favorable}</span>-<span className="text-[#586d78]">{neutral}</span>-<span className="text-[#bd4c45]">{unfavorable}</span></span>;
}

export function OverallMeta({ byGeography }: { byGeography: Record<Geography, MetaDeck[]> }) {
  const [geography, setGeography] = useState<Geography>("all");
  const decks = byGeography[geography].slice(0, 15);
  const [opponentCount, setOpponentCount] = useState<10 | 15 | 20 | 25>(15);
  const opponentSlugs = new Set(byGeography[geography].slice(0, opponentCount).map((deck) => deck.slug));
  const deckSlugs = decks.map((deck) => deck.slug).join(",");
  const matchupKey = `${geography}:${deckSlugs}`;
  const [matchupData, setMatchupData] = useState<{ key: string; rows: Record<string, Matchup[] | null> } | null>(null);
  const loading = matchupData?.key !== matchupKey;
  const matchupRows = loading ? {} : matchupData?.rows ?? {};
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const selected = decks.find((deck) => deck.slug === selectedSlug);
  const selectedLoading = loading || !!selectedSlug && !(selectedSlug in matchupRows);
  const matchups = selectedSlug && selectedSlug in matchupRows
    ? (matchupRows[selectedSlug] ?? EMPTY_MATCHUPS).filter((matchup) => opponentSlugs.has(matchup.slug))
    : EMPTY_MATCHUPS;
  const error = !selectedLoading && selectedSlug && matchupRows[selectedSlug] === null ? "Unable to load matchup records." : "";
  const [category, setCategory] = useState<"all" | Matchup["category"]>("all");
  const [opponentSlug, setOpponentSlug] = useState("");
  const [showAllMatchups, setShowAllMatchups] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const cacheKey = `${MATCHUP_CACHE_PREFIX}${matchupKey}`;
    const slugs = deckSlugs.split(",").filter(Boolean);
    const cachedRows = readCachedMatchups(cacheKey, slugs);
    if (cachedRows) {
      queueMicrotask(() => {
        if (!controller.signal.aborted) setMatchupData({ key: matchupKey, rows: cachedRows });
      });
      return () => controller.abort();
    }
    Promise.all(slugs.map(async (slug) => {
      let result: Matchup[] | null;
      try {
        const response = await fetch(`/api/season/matchups?deck=${encodeURIComponent(slug)}&geography=${geography}&opponents=25`, { signal: controller.signal });
        if (!response.ok) throw new Error("Matchups unavailable");
        const body = await response.json() as { matchups?: Matchup[] };
        result = body.matchups ?? [];
      } catch {
        result = null;
      }
      if (!controller.signal.aborted) setMatchupData((current) => ({
        key: matchupKey,
        rows: { ...(current?.key === matchupKey ? current.rows : {}), [slug]: result },
      }));
      return [slug, result] as const;
    })).then((rows) => {
      if (controller.signal.aborted || rows.some(([, result]) => result === null)) return;
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ expires: Date.now() + MATCHUP_CACHE_MS, rows: Object.fromEntries(rows) }));
      } catch {
        // A full or disabled storage area does not affect the visible results.
      }
    });
    return () => controller.abort();
  }, [deckSlugs, geography, matchupKey]);

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
          <p className="section-kicker">2027 season / major events</p>
          <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Overall metagame</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#67757d]">The 15 most played decks across Regionals and Special Events. Favorable–neutral–unfavorable matchup counts are shown in each row; open Full matchup for opponent records.</p>
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
            <select id="overall-opponents" value={opponentCount} onChange={(event) => { setOpponentCount(Number(event.target.value) as 10 | 15 | 20 | 25); setCategory("all"); setOpponentSlug(""); setShowAllMatchups(false); }} className="w-full rounded-xl border border-[#bfc8c9] bg-white px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#3485a4]">
              <option value={10}>Versus top 10</option>
              <option value={15}>Versus top 15</option>
              <option value={20}>Versus top 20</option>
              <option value={25}>Versus top 25</option>
            </select>
          </div>
        </div>
      </div>

        <section className="overflow-hidden rounded-2xl border border-[#d7d5cc] bg-white" aria-label="Top 15 decks">
          <div className="md:overflow-x-auto">
            <table className="block w-full text-left text-sm md:table md:min-w-[760px]">
              <thead className="hidden bg-[#eeede7] text-xs uppercase tracking-wider text-[#6f7a7f] md:table-header-group"><tr><th className="px-4 py-3"># / Deck</th><th className="px-3 py-3 text-right">Share</th><th className="px-3 py-3 text-right">Win %</th><th className="px-3 py-3 text-right">Day 2</th><th className="px-3 py-3 text-right">F–N–U <span className="sr-only">Favorable–neutral–unfavorable matchups against top meta decks</span></th><th className="px-4 py-3 text-right"><span className="sr-only">Full matchup details</span></th></tr></thead>
              <tbody className="block divide-y divide-[#eeede8] md:table-row-group">
                {decks.map((deck, index) => <Fragment key={deck.slug}><tr className={`grid grid-cols-2 gap-2 p-4 md:table-row md:p-0 ${selected?.slug === deck.slug ? "bg-[#e9f1ec]" : "hover:bg-[#f7f6f2]"}`}>
                  <td className="col-span-2 pb-2 md:table-cell md:px-4 md:py-3"><span className="flex min-w-0 items-center gap-2 font-semibold"><span className="w-6 shrink-0 font-mono text-xs text-[#9ca5a8]">{index + 1}</span><DeckSprites icons={deck.icons} /><span className="min-w-0 break-words">{deck.name}</span></span></td>
                  <td className="rounded-lg bg-[#f7f8f4] px-3 py-2 text-left font-mono md:table-cell md:rounded-none md:bg-transparent md:py-3 md:text-right"><span className="mb-1 block font-sans text-[10px] font-bold uppercase tracking-wide text-[#718087] md:hidden">Share</span>{percent(deck.share)}</td>
                  <td className="rounded-lg bg-[#f7f8f4] px-3 py-2 text-left font-mono font-semibold md:table-cell md:rounded-none md:bg-transparent md:py-3 md:text-right"><span className="mb-1 block font-sans text-[10px] font-bold uppercase tracking-wide text-[#718087] md:hidden">Win %</span>{percent(deck.winRate)}</td>
                  <td className="rounded-lg bg-[#f7f8f4] px-3 py-2 text-left font-mono md:table-cell md:rounded-none md:bg-transparent md:py-3 md:text-right"><span className="mb-1 block font-sans text-[10px] font-bold uppercase tracking-wide text-[#718087] md:hidden">Day 2</span>{deck.conversion === null ? "—" : percent(deck.conversion)}</td>
                  <td className="rounded-lg bg-[#f7f8f4] px-3 py-2 text-left md:table-cell md:rounded-none md:bg-transparent md:py-3 md:text-right"><span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#718087] md:hidden">F–N–U · top {opponentCount}</span><MatchupCounts matchups={matchupRows[deck.slug]} opponents={opponentSlugs} loading={loading || !(deck.slug in matchupRows)} /></td>
                  <td className="col-span-2 pt-1 md:table-cell md:px-4 md:py-3 md:text-right"><button type="button" onClick={() => toggleDeck(deck.slug)} aria-expanded={selected?.slug === deck.slug} aria-controls={`matchup-${deck.slug}`} className="w-full whitespace-nowrap rounded-md border border-[#c6d0d0] bg-white px-2.5 py-2 text-xs font-semibold text-[#27566a] hover:border-[#3485a4] focus:outline-none focus:ring-2 focus:ring-[#3485a4] md:w-auto md:py-1.5 md:text-[11px]">{selected?.slug === deck.slug ? "Close ↑" : "Full matchup ↗"}</button></td>
                </tr>
                {selected?.slug === deck.slug ? <tr id={`matchup-${deck.slug}`} className="block md:table-row"><td colSpan={6} className="block w-full bg-[#f7f8f4] px-4 py-5 md:table-cell sm:px-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div><p className="section-kicker">Matchup profile</p><h2 className="flex items-center gap-2 text-xl font-semibold"><DeckSprites icons={deck.icons} /><span>{deck.name}</span></h2><p className="mt-1 text-xs text-[#78858a]">Overall W–L–T: {deck.record.wins}–{deck.record.losses}–{deck.record.ties} across {deck.events} event{deck.events === 1 ? "" : "s"}</p><p className="mt-1 text-xs text-[#78858a]">Win % counts each tie as ⅓ of a win.</p></div>
                    {!selectedLoading && !error ? <div><p className="mb-2 text-xs font-semibold text-[#6f7a7f]">Opposing decks versus top {opponentCount} · mirror excluded</p><div className="flex flex-wrap gap-2" aria-label={`Matchup categories versus top ${opponentCount} opposing decks, excluding mirror matches`}>{categories.map((item) => <span key={item} className={`rounded-lg px-3 py-2 text-xs font-semibold ${item === "favorable" ? "bg-[#e3f2e5] text-[#237444]" : item === "unfavorable" ? "bg-[#f9e8e5] text-[#bd4c45]" : "bg-[#e9eef0] text-[#586d78]"}`}>{categorized[item].length} {item}</span>)}</div></div> : null}
                  </div>
                  {selectedLoading ? <p className="mt-5 text-sm text-[#6f7b80]">Loading matchup records…</p> : null}
                  {error ? <p className="mt-5 text-sm text-[#aa4d44]">{error}</p> : null}
                  {!selectedLoading && !error ? <><div className="mt-5 grid gap-4 border-t border-[#dfe2dc] pt-5 md:grid-cols-[minmax(0,180px)_minmax(0,280px)_minmax(0,1fr)] md:items-end">
                    <div><label htmlFor="matchup-category" className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#6f7a7f]">Result category</label><select id="matchup-category" value={category} onChange={(event) => { setCategory(event.target.value as typeof category); setOpponentSlug(""); setShowAllMatchups(false); }} className="w-full rounded-xl border border-[#bfc8c9] bg-white px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3485a4]"><option value="all">All matchups</option><option value="favorable">Favorable (≥55%)</option><option value="neutral">Neutral (45–55%)</option><option value="unfavorable">Unfavorable (≤45%)</option></select></div>
                    <div><label htmlFor="matchup-opponent" className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#6f7a7f]">Opposing meta deck</label><select id="matchup-opponent" value={opponentSlug} onChange={(event) => { setOpponentSlug(event.target.value); if (event.target.value) setShowAllMatchups(true); }} className="w-full rounded-xl border border-[#bfc8c9] bg-white px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3485a4]"><option value="">Select a deck…</option>{filtered.map((matchup) => <option key={matchup.slug} value={matchup.slug}>{matchup.name} · {percent(matchup.winRate)}</option>)}</select></div>
                    <div className="min-h-12 rounded-xl border border-[#e0e3df] bg-white px-4 py-3 text-sm" aria-live="polite">{opponent ? <div className="flex flex-wrap items-center justify-between gap-2"><span className="inline-flex items-center gap-1 font-semibold">vs. <DeckSprites icons={opponent.icons} compact />{opponent.name}</span><span className={opponent.category === "favorable" ? "font-bold text-[#237444]" : opponent.category === "unfavorable" ? "font-bold text-[#bd4c45]" : "font-bold text-[#586d78]"}>{percent(opponent.winRate)} · {opponent.category}</span><span className="font-mono text-xs text-[#78858a]">{opponent.record.wins}–{opponent.record.losses}–{opponent.record.ties} ({opponent.matches} matches)</span></div> : <span className="text-[#78858a]">Choose an opposing deck to see its win rate and record.</span>}</div>
                  </div>
                    <div className="mt-5 rounded-xl border border-[#dfe2dc] bg-white md:overflow-x-auto">
                      <table className="block w-full text-left text-sm md:table md:min-w-[570px]" aria-label={`${deck.name} matchup records`}>
                        <thead className="hidden bg-[#eeede7] text-xs uppercase tracking-wider text-[#6f7a7f] md:table-header-group"><tr><th className="px-4 py-3">Opposing deck</th><th className="px-3 py-3 text-right">W–L–T</th><th className="px-3 py-3 text-right">Win %</th><th className="px-4 py-3 text-right">Result</th></tr></thead>
                        <tbody className="block divide-y divide-[#eeede8] md:table-row-group">{visibleMatchups.map((matchup) => <tr key={matchup.slug} className={`grid grid-cols-2 gap-2 p-4 md:table-row md:p-0 ${opponentSlug === matchup.slug ? "bg-[#e9f1ec]" : ""}`}><td className="col-span-2 font-semibold md:table-cell md:px-4 md:py-3"><span className="flex min-w-0 items-center gap-2"><DeckSprites icons={matchup.icons} compact /><span className="min-w-0 break-words">{matchup.name}</span></span></td><td className="rounded-lg bg-[#f7f8f4] px-3 py-2 text-left font-mono md:table-cell md:rounded-none md:bg-transparent md:py-3 md:text-right"><span className="mb-1 block font-sans text-[10px] font-bold uppercase tracking-wide text-[#718087] md:hidden">W–L–T</span>{matchup.record.wins}–{matchup.record.losses}–{matchup.record.ties}</td><td className="rounded-lg bg-[#f7f8f4] px-3 py-2 text-left font-mono md:table-cell md:rounded-none md:bg-transparent md:py-3 md:text-right"><span className="mb-1 block font-sans text-[10px] font-bold uppercase tracking-wide text-[#718087] md:hidden">Win %</span>{percent(matchup.winRate)}</td><td className={`col-span-2 rounded-lg bg-[#f7f8f4] px-3 py-2 text-left font-semibold capitalize md:table-cell md:rounded-none md:bg-transparent md:px-4 md:py-3 md:text-right ${matchup.category === "favorable" ? "text-[#237444]" : matchup.category === "unfavorable" ? "text-[#bd4c45]" : "text-[#586d78]"}`}><span className="mr-2 font-sans text-[10px] font-bold uppercase tracking-wide text-[#718087] md:hidden">Result</span>{matchup.category}</td></tr>)}</tbody>
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

      <p className="mt-8 text-xs leading-5 text-[#718087]">F–N–U counts favorable, neutral, and unfavorable records versus the selected top 10, 15, 20, or 25 opposing meta decks. Only recorded matchups count; mirror matches are excluded. Share is player count divided by all players in the selected events. Win percentages combine W–L–T records, counting each tie as one-third of a win. A matchup at exactly 55% is favorable; exactly 45% is unfavorable.</p>
    </>
  );
}
