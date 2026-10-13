"use client";

import { useEffect, useMemo, useState } from "react";
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

export function OverallMeta({ byGeography }: { byGeography: Record<Geography, MetaDeck[]> }) {
  const [geography, setGeography] = useState<Geography>("all");
  const decks = byGeography[geography].slice(0, 15);
  const [selectedSlug, setSelectedSlug] = useState<string>(decks[0]?.slug ?? "");
  const selected = decks.find((deck) => deck.slug === selectedSlug) ?? decks[0];
  const [matchups, setMatchups] = useState<Matchup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/season/matchups?deck=${encodeURIComponent(selected.slug)}&geography=${geography}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Unable to load matchups.");
        return body.matchups as Matchup[];
      })
      .then((rows) => { setMatchups(rows); setLoading(false); })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Unable to load matchups.");
        setLoading(false);
      });
    return () => controller.abort();
  }, [selected?.slug, geography]);

  const categorized = useMemo(() => Object.fromEntries(categories.map((category) =>
    [category, matchups.filter((matchup) => matchup.category === category)]
  )) as Record<(typeof categories)[number], Matchup[]>, [matchups]);

  function changeGeography(value: Geography) {
    setGeography(value);
    setSelectedSlug(byGeography[value][0]?.slug ?? "");
  }

  return (
    <>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="section-kicker">2027 season / five regionals</p>
          <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Overall metagame</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#67757d]">The 15 most played decks across the selected Regionals. Select a deck to see its combined matchups against the other top decks.</p>
        </div>
        <div className="min-w-48">
          <label htmlFor="overall-geography" className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#6f7a7f]">Geography</label>
          <select id="overall-geography" value={geography} onChange={(event) => changeGeography(event.target.value as Geography)} className="w-full rounded-xl border border-[#bfc8c9] bg-white px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#3485a4]">
            {GEO.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)]">
        <section className="overflow-hidden rounded-2xl border border-[#d7d5cc] bg-white" aria-label="Top 15 decks">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[570px] text-left text-sm">
              <thead className="bg-[#eeede7] text-xs uppercase tracking-wider text-[#6f7a7f]"><tr><th className="px-4 py-3"># / Deck</th><th className="px-3 py-3 text-right">Players</th><th className="px-3 py-3 text-right">Share</th><th className="px-3 py-3 text-right">Win %</th><th className="px-4 py-3 text-right">Day 2</th></tr></thead>
              <tbody className="divide-y divide-[#eeede8]">
                {decks.map((deck, index) => <tr key={deck.slug} className={selected?.slug === deck.slug ? "bg-[#e9f1ec]" : "hover:bg-[#f7f6f2]"}>
                  <td className="p-0"><button type="button" onClick={() => setSelectedSlug(deck.slug)} className="flex w-full items-center gap-3 px-4 py-3 text-left focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#3485a4]" aria-pressed={selected?.slug === deck.slug}><span className="w-5 font-mono text-xs text-[#9ca5a8]">{index + 1}</span><span className="font-semibold">{deck.name}</span></button></td>
                  <td className="px-3 py-3 text-right font-mono">{deck.players.toLocaleString()}</td>
                  <td className="px-3 py-3 text-right font-mono">{percent(deck.share)}</td>
                  <td className="px-3 py-3 text-right font-mono font-semibold">{percent(deck.winRate)}</td>
                  <td className="px-4 py-3 text-right font-mono">{deck.conversion === null ? "—" : percent(deck.conversion)}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-[#d7d5cc] bg-[#fbfaf6] p-5 sm:p-6" aria-live="polite">
          {selected ? <>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#dddcd3] pb-5">
              <div><p className="section-kicker">Matchup profile</p><h2 className="text-2xl font-semibold tracking-tight">{selected.name}</h2><p className="mt-2 text-xs text-[#78858a]">{selected.record.wins}–{selected.record.losses}–{selected.record.ties} across {selected.events} event{selected.events === 1 ? "" : "s"}</p></div>
              <span className="rounded-xl bg-[#18323d] px-3 py-2 font-mono text-sm font-semibold text-white">{percent(selected.winRate)} WR</span>
            </div>
            {loading ? <p className="py-8 text-sm text-[#6f7b80]">Loading matchup records…</p> : null}
            {error ? <p className="py-8 text-sm text-[#aa4d44]">{error}</p> : null}
            {!loading && !error ? <>
              <div className="grid grid-cols-3 gap-2 border-b border-[#dddcd3] py-5">
                {categories.map((category) => <div key={category} className="rounded-xl bg-white p-3 text-center"><div className={category === "favorable" ? "text-2xl font-bold text-[#237444]" : category === "unfavorable" ? "text-2xl font-bold text-[#bd4c45]" : "text-2xl font-bold text-[#586d78]"}>{categorized[category].length}</div><div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[#748187]">{category}</div></div>)}
              </div>
              <div className="max-h-[640px] space-y-6 overflow-y-auto pr-1 pt-5">
                {categories.map((category) => <div key={category}>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-[#68767d]">{category} {category === "favorable" ? "≥55%" : category === "unfavorable" ? "≤45%" : "(45–55%)"}</h3>
                  <div className="divide-y divide-[#e4e2d9] rounded-xl border border-[#e4e2d9] bg-white px-3">
                    {categorized[category].length ? categorized[category].map((matchup) => <div key={matchup.slug} className="flex items-center justify-between gap-3 py-2.5 text-sm"><span className="min-w-0 truncate font-medium">{matchup.name}</span><span className="shrink-0 text-right font-mono"><span className="font-bold">{percent(matchup.winRate)}</span><span className="ml-2 text-xs text-[#8b969b]">{matchup.record.wins}–{matchup.record.losses}–{matchup.record.ties}</span></span></div>) : <p className="py-3 text-xs text-[#8b969b]">No matchups in this range.</p>}
                  </div>
                </div>)}
              </div>
            </> : null}
          </> : <p className="text-sm text-[#6f7b80]">No decks available for this selection.</p>}
        </section>
      </div>
      <p className="mt-8 text-xs leading-5 text-[#718087]">Share is player count divided by all players in the selected events. Win percentages combine W–L–T records, counting each tie as one-third of a win. A matchup at exactly 55% is favorable; exactly 45% is unfavorable. Mirror matches are excluded from the matchup profile.</p>
    </>
  );
}
