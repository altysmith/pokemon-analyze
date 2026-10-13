"use client";

import { useMemo, useState } from "react";
import type { EventDeck, Geography, RegionalData } from "@/lib/limitless/season";

const GEO: Array<{ value: Geography; label: string }> = [
  { value: "all", label: "All regions" },
  { value: "us", label: "US" },
  { value: "europe", label: "Europe" },
  { value: "south-america", label: "South America" },
  { value: "oceania", label: "Oceania" },
];

type Trend = { slug: string; name: string; from: number; to: number; delta: number; fromSample: number; toSample: number };

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;
const formatDelta = (value: number) => `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)} pts`;

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
    return [{ slug, name: b?.name ?? a?.name ?? slug, from: first, to: last, delta: last - first, fromSample, toSample }];
  });
}

function TrendList({ title, items, tone }: { title: string; items: Trend[]; tone: "up" | "down" }) {
  return (
    <section className="rounded-2xl border border-[#d7d5cc] bg-white p-5">
      <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-[#52616b]">{title}</h3>
      <div className="mt-4 divide-y divide-[#eeede8]">
        {items.length ? items.map((item, index) => (
          <div key={item.slug} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 py-3 text-sm">
            <span className="font-mono text-xs text-[#9aa2a5]">{index + 1}</span>
            <div className="min-w-0">
              <div className="truncate font-semibold text-[#1b2930]">{item.name}</div>
              <div className="mt-0.5 text-xs text-[#7b8589]">{formatPercent(item.from)} → {formatPercent(item.to)} <span className="font-mono">({item.fromSample} → {item.toSample})</span></div>
            </div>
            <span className={tone === "up" ? "font-mono font-semibold text-[#237444]" : "font-mono font-semibold text-[#bd4c45]"}>{formatDelta(item.delta)}</span>
          </div>
        )) : <p className="py-5 text-sm text-[#68777f]">No decks meet the sample threshold for this comparison.</p>}
      </div>
    </section>
  );
}

export function SeasonTrends({ events }: { events: RegionalData[] }) {
  const [geography, setGeography] = useState<Geography>("all");
  const [selection, setSelection] = useState<{ geography: Geography; start: number; end: number }>({ geography: "all", start: Math.max(0, events.length - 3), end: events.length - 1 });
  const filtered = useMemo(() => events.filter((event) => geography === "all" || event.geography === geography), [events, geography]);
  const start = selection.geography === geography ? Math.min(selection.start, Math.max(0, filtered.length - 1)) : Math.max(0, filtered.length - 3);
  const end = selection.geography === geography ? Math.min(selection.end, Math.max(0, filtered.length - 1)) : filtered.length - 1;
  const first = filtered[start];
  const last = filtered[end];
  const allShare = first && last ? trends(first, last, "share") : [];
  const allWin = first && last ? trends(first, last, "winRate") : [];
  const upShare = allShare.filter((item) => item.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 10);
  const downShare = allShare.filter((item) => item.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 10);
  const upWin = allWin.filter((item) => item.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 10);
  const downWin = allWin.filter((item) => item.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 10);

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
          <section>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div><p className="section-kicker">Play rate</p><h2 className="section-title">Metagame share changes</h2></div>
              <p className="text-xs text-[#738088]">Player share • percentage point change</p>
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <TrendList title="Top 10 rising" items={upShare} tone="up" />
              <TrendList title="Top 10 falling" items={downShare} tone="down" />
            </div>
          </section>
          <section>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div><p className="section-kicker">Performance</p><h2 className="section-title">Win rate changes</h2></div>
              <p className="text-xs text-[#738088]">At least 20 recorded matches at each event</p>
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <TrendList title="Top 10 improving" items={upWin} tone="up" />
              <TrendList title="Top 10 declining" items={downWin} tone="down" />
            </div>
          </section>
        </div>
      ) : null}
      <p className="mt-8 text-xs leading-5 text-[#718087]">Win rate follows Limitless Labs: (wins + ties ÷ 3) ÷ all matches. Share rankings include new and disappearing decks as 0% at the event where they are absent. Win rate trends require recorded matches in both events.</p>
    </>
  );
}
