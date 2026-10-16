"use client";

import { useEffect, useMemo, useState } from "react";
import type { EventDeck, Geography, Matchup, MetaDeck, RegionalData } from "@/lib/limitless/season";
import { CardShifts } from "./card-shifts";
import { DeckSprites } from "./deck-sprites";

const GEO: Array<{ value: Geography; label: string }> = [
  { value: "all", label: "All regions" },
  { value: "us", label: "US" },
  { value: "europe", label: "Europe" },
  { value: "south-america", label: "South America" },
  { value: "oceania", label: "Oceania" },
];

type Trend = { slug: string; name: string; icons: string[]; from: number; to: number; delta: number; fromSample: number; toSample: number };

const formatPercent = (value: number) => {
  const percentage = value * 100;
  return `${percentage.toFixed(percentage !== 0 && Math.abs(percentage) < 0.1 ? 2 : 1)}%`;
};
const formatDelta = (value: number) => {
  const points = value * 100;
  const magnitude = Math.abs(points);
  const digits = magnitude < 0.01 ? 3 : magnitude < 0.1 ? 2 : 1;
  return `${value > 0 ? "+" : ""}${points.toFixed(digits)} pts`;
};

function deckValue(deck: EventDeck | undefined, metric: "share" | "winRate") {
  return deck ? deck[metric] : 0;
}

function trends(from: RegionalData, to: RegionalData, metric: "share" | "winRate") {
  const left = new Map(from.decks.map((deck) => [deck.slug, deck]));
  const right = new Map(to.decks.map((deck) => [deck.slug, deck]));
  const slugs = new Set([...left.keys(), ...right.keys()]);
  return [...slugs].flatMap((slug): Trend[] => {
    if (slug === "other" || slug === "unknown") return [];
    const a = left.get(slug);
    const b = right.get(slug);
    const fromSample = metric === "share" ? a?.players ?? 0 : a ? a.record.wins + a.record.losses + a.record.ties : 0;
    const toSample = metric === "share" ? b?.players ?? 0 : b ? b.record.wins + b.record.losses + b.record.ties : 0;
    if (metric === "winRate" && (fromSample < 20 || toSample < 20)) return [];
    const first = deckValue(a, metric);
    const last = deckValue(b, metric);
    return [{ slug, name: b?.name ?? a?.name ?? slug, icons: b?.icons?.length ? b.icons : a?.icons ?? [], from: first, to: last, delta: last - first, fromSample, toSample }];
  });
}

type MatchupSummary = { favorable: number; neutral: number; unfavorable: number; total: number };

function TrendList({ title, items, tone, matchupSummaries, matchupLoading, matchupOpponentCount, matchupDecks }: { title: string; items: Trend[]; tone: "up" | "down"; matchupSummaries: Record<string, MatchupSummary>; matchupLoading: boolean; matchupOpponentCount: number; matchupDecks: Set<string> }) {
  return (
    <section className="rounded-2xl border border-[#d7d5cc] bg-white p-5">
      <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-[#52616b]">{title}</h3>
      <div className="mt-4 divide-y divide-[#eeede8]">
        {items.length ? items.map((item, index) => (
          <div key={item.slug} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 py-3 text-sm">
            <span className="font-mono text-xs text-[#9aa2a5]">{index + 1}</span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-semibold text-[#1b2930]"><DeckSprites icons={item.icons} compact /><span className="truncate">{item.name}</span></div>
              <div className="mt-0.5 text-xs text-[#7b8589]">{formatPercent(item.from)} → {formatPercent(item.to)} <span className="font-mono">({item.fromSample} → {item.toSample})</span></div>
              {item.slug in matchupSummaries ? <div className="mt-1 text-[11px] text-[#65747b]" aria-label={`Matchups versus top ${matchupOpponentCount} meta decks: ${matchupSummaries[item.slug].favorable} favorable, ${matchupSummaries[item.slug].neutral} neutral, ${matchupSummaries[item.slug].unfavorable} unfavorable`}>
                vs top {matchupOpponentCount}: <span className="font-semibold text-[#237444]">{matchupSummaries[item.slug].favorable} F</span> · <span className="font-semibold text-[#586d78]">{matchupSummaries[item.slug].neutral} N</span> · <span className="font-semibold text-[#bd4c45]">{matchupSummaries[item.slug].unfavorable} U</span>{matchupSummaries[item.slug].total < matchupOpponentCount - 1 ? <span> · {matchupSummaries[item.slug].total} recorded opponents</span> : null}
              </div> : matchupLoading && matchupDecks.has(item.slug) ? <div className="mt-1 text-[11px] text-[#78858a]">Loading matchups…</div> : null}
            </div>
            <span className={tone === "up" ? "font-mono font-semibold text-[#237444]" : "font-mono font-semibold text-[#bd4c45]"}>{formatDelta(item.delta)}</span>
          </div>
        )) : <p className="py-5 text-sm text-[#68777f]">No decks meet the sample threshold for this comparison.</p>}
      </div>
    </section>
  );
}

export function SeasonTrends({ events, byGeography }: { events: RegionalData[]; byGeography: Record<Geography, MetaDeck[]> }) {
  const [geography, setGeography] = useState<Geography>("all");
  const [trendCount, setTrendCount] = useState(15);
  const [matchupOpponentCount, setMatchupOpponentCount] = useState<10 | 15>(10);
  const [matchupData, setMatchupData] = useState<{ key: string; rows: Record<string, Matchup[]> } | null>(null);
  const [selection, setSelection] = useState<{ geography: Geography; start: number; end: number }>({ geography: "all", start: Math.max(0, events.length - 3), end: events.length - 1 });
  const filtered = useMemo(() => events.filter((event) => geography === "all" || event.geography === geography), [events, geography]);
  const start = selection.geography === geography ? Math.min(selection.start, Math.max(0, filtered.length - 1)) : Math.max(0, filtered.length - 3);
  const end = selection.geography === geography ? Math.min(selection.end, Math.max(0, filtered.length - 1)) : filtered.length - 1;
  const first = filtered[start];
  const last = filtered[end];
  const ranking = byGeography[geography];
  const topDecks = useMemo(() => new Set(ranking.slice(0, trendCount).map((deck) => deck.slug)), [ranking, trendCount]);
  const topTen = ranking.slice(0, 10).map((deck) => deck.slug);
  const matchupDecks = new Set(topTen);
  const topTenKey = topTen.join(",");
  const matchupKey = `${geography}:${topTenKey}`;
  const matchupLoading = matchupData?.key !== matchupKey;
  const matchups = matchupLoading ? {} : matchupData?.rows ?? {};
  const opponentSlugs = new Set(ranking.slice(0, matchupOpponentCount).map((deck) => deck.slug));
  const matchupSummaries = Object.fromEntries(topTen.filter((slug) => slug in matchups).map((slug) => {
    const relevant = matchups[slug].filter((matchup) => opponentSlugs.has(matchup.slug));
    return [slug, {
      favorable: relevant.filter((matchup) => matchup.category === "favorable").length,
      neutral: relevant.filter((matchup) => matchup.category === "neutral").length,
      unfavorable: relevant.filter((matchup) => matchup.category === "unfavorable").length,
      total: relevant.length,
    }];
  })) as Record<string, MatchupSummary>;
  const allShare = first && last ? trends(first, last, "share").filter((item) => topDecks.has(item.slug)) : [];
  const allWin = first && last ? trends(first, last, "winRate").filter((item) => topDecks.has(item.slug)) : [];
  const upShare = allShare.filter((item) => item.delta > 0).sort((a, b) => b.delta - a.delta);
  const downShare = allShare.filter((item) => item.delta < 0).sort((a, b) => a.delta - b.delta);
  const upWin = allWin.filter((item) => item.delta > 0).sort((a, b) => b.delta - a.delta);
  const downWin = allWin.filter((item) => item.delta < 0).sort((a, b) => a.delta - b.delta);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all(topTenKey.split(",").filter(Boolean).map(async (slug) => {
      try {
        const response = await fetch(`/api/season/matchups?deck=${encodeURIComponent(slug)}&geography=${geography}`, { signal: controller.signal });
        if (!response.ok) return null;
        const body = await response.json() as { matchups?: Matchup[] };
        return [slug, body.matchups ?? []] as const;
      } catch {
        return null;
      }
    })).then((rows) => {
      if (!controller.signal.aborted) setMatchupData({ key: matchupKey, rows: Object.fromEntries(rows.filter((row) => row !== null)) });
    });
    return () => controller.abort();
  }, [geography, topTenKey, matchupKey]);

  function updateStart(next: number) {
    setSelection({ geography, start: next, end: Math.max(next, end) });
  }
  function updateEnd(next: number) {
    setSelection({ geography, start: Math.min(start, next), end: next });
  }

  return (
    <>
      <section className="rounded-3xl border border-[#d0cec3] bg-[#fbfaf6] p-5 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="section-kicker">2027 season / regional tracker</p>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Compare the meta as it moves</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#64727a]">Select a geography and slide between tournaments. Rankings compare the first and last event in your window; any events between them remain in the selection.</p>
          </div>
          <div className="min-w-48">
            <label htmlFor="geography" className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#6f7a7f]">Geography</label>
            <select id="geography" value={geography} onChange={(event) => setGeography(event.target.value as Geography)} className="w-full rounded-xl border border-[#bfc8c9] bg-white px-4 py-3 text-sm font-medium text-[#1b2930] focus:outline-none focus:ring-2 focus:ring-[#3485a4]">
              {GEO.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
        </div>

        {first && last ? (
          <div className="mt-7 grid gap-6 border-t border-[#e2e0d8] pt-6 md:grid-cols-2">
            <div>
              <label htmlFor="from-regional" className="block text-xs font-bold uppercase tracking-wider text-[#7b8589]">From Regional</label>
              <div className="mt-1 text-xl font-semibold">{first.shortName} <span className="text-sm font-normal text-[#788389]">{first.date}</span></div>
              <input id="from-regional" className="mt-4 w-full accent-[#237444]" type="range" min="0" max={filtered.length - 1} value={start} onChange={(event) => updateStart(Number(event.target.value))} aria-valuetext={`${first.shortName}, ${first.date}`} />
            </div>
            <div>
              <label htmlFor="to-regional" className="block text-xs font-bold uppercase tracking-wider text-[#7b8589]">To Regional</label>
              <div className="mt-1 text-xl font-semibold">{last.shortName} <span className="text-sm font-normal text-[#788389]">{last.date}</span></div>
              <input id="to-regional" className="mt-4 w-full accent-[#e85245]" type="range" min="0" max={filtered.length - 1} value={end} onChange={(event) => updateEnd(Number(event.target.value))} aria-valuetext={`${last.shortName}, ${last.date}`} />
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2 text-xs text-[#5a6a71]">
          {filtered.map((event, index) => <span key={event.id} className={index >= start && index <= end ? "rounded-full bg-[#e5efe8] px-3 py-1.5 font-semibold text-[#2e6846]" : "rounded-full bg-[#ecebe5] px-3 py-1.5"}>{event.shortName}</span>)}
        </div>
      </section>

      {first && last && start === end ? <div className="mt-6 rounded-2xl border border-[#d7d5cc] bg-white p-6 text-sm text-[#68777f]">Move one slider to a different Regional to compare changes.</div> : null}
      {first && last && start !== end ? (
        <div className="mt-8 space-y-10">
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-full rounded-xl border border-[#d7d5cc] bg-[#fbfaf6] px-4 py-3 sm:w-80">
              <label htmlFor="trend-count" className="flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-wider text-[#52616b]"><span>Top meta decks</span><output htmlFor="trend-count" className="font-mono text-base text-[#1d343f]">{trendCount}</output></label>
              <input id="trend-count" type="range" min="5" max="35" step="1" value={trendCount} onChange={(event) => setTrendCount(Number(event.target.value))} aria-valuetext={`Compare share and win-rate changes among the top ${trendCount} decks by overall meta share`} className="mt-3 w-full accent-[#3485a4]" />
              <div className="flex justify-between text-[11px] text-[#738088]"><span>Top 5</span><span>Top 35</span></div>
            </div>
            <div className="min-w-48 rounded-xl border border-[#d7d5cc] bg-[#fbfaf6] px-4 py-3">
              <label htmlFor="matchup-opponents" className="block text-xs font-bold uppercase tracking-wider text-[#52616b]">Matchup opponents</label>
              <select id="matchup-opponents" value={matchupOpponentCount} onChange={(event) => setMatchupOpponentCount(Number(event.target.value) as 10 | 15)} className="mt-2 w-full rounded-lg border border-[#bfc8c9] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3485a4]">
                <option value={10}>Top 10 meta decks</option>
                <option value={15}>Top 15 meta decks</option>
              </select>
            </div>
          </div>
          <p className="-mt-6 text-xs leading-5 text-[#738088]">The slider chooses decks by their full-season share in the selected geography, then ranks changes within that same group for both tables. Matchup counts appear for the top 10 decks.</p>
          <section>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div><p className="section-kicker">Play rate</p><h2 className="section-title">Metagame share changes</h2></div>
            </div>
            <p className="mb-4 text-xs text-[#738088]">Player share • percentage point change • selected from the top {trendCount} overall decks</p>
            <div className="grid gap-5 lg:grid-cols-2">
              <TrendList title="Rising" items={upShare} tone="up" matchupSummaries={matchupSummaries} matchupLoading={matchupLoading} matchupOpponentCount={matchupOpponentCount} matchupDecks={matchupDecks} />
              <TrendList title="Falling" items={downShare} tone="down" matchupSummaries={matchupSummaries} matchupLoading={matchupLoading} matchupOpponentCount={matchupOpponentCount} matchupDecks={matchupDecks} />
            </div>
          </section>
          <section>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div><p className="section-kicker">Performance</p><h2 className="section-title">Win rate changes</h2></div>
              <p className="text-xs text-[#738088]">At least 20 recorded matches at each event • same top {trendCount} overall decks</p>
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <TrendList title="Improving" items={upWin} tone="up" matchupSummaries={matchupSummaries} matchupLoading={matchupLoading} matchupOpponentCount={matchupOpponentCount} matchupDecks={matchupDecks} />
              <TrendList title="Declining" items={downWin} tone="down" matchupSummaries={matchupSummaries} matchupLoading={matchupLoading} matchupOpponentCount={matchupOpponentCount} matchupDecks={matchupDecks} />
            </div>
          </section>
          <CardShifts from={first} to={last} ranking={ranking} />
        </div>
      ) : null}
      <p className="mt-8 text-xs leading-5 text-[#718087]">Win rate follows Limitless Labs: (wins + ties ÷ 3) ÷ all matches. Share rankings include new and disappearing decks as 0% at the event where they are absent. Win rate trends require recorded matches in both events. Matchup counts are favorable (≥55%), neutral (between 45% and 55%), and unfavorable (≤45%) versus recorded opponents in the selected geography; mirror matches are excluded.</p>
    </>
  );
}
