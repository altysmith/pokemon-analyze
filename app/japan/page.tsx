import { SiteHeader } from "../components/site-header";
import { DeckSprites } from "../components/deck-sprites";
import { openJapanDb } from "@/db/japan";
import { resolveJapanDateRange } from "@/lib/japan/date-range";
import { japanSourceData, summarizeJapanData, type JapanSourceData } from "@/lib/japan/overview";
import previewOverview from "@/lib/japan/preview-overview.json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const number = (value: number) => value.toLocaleString();
const shortDate = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

export default async function JapanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const single = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const range = resolveJapanDateRange({ range: single(params?.range), from: single(params?.from), to: single(params?.to) });
  let source: JapanSourceData;
  try {
    const db = openJapanDb();
    try { source = japanSourceData(db); } finally { db.close(); }
  } catch (error) {
    if (process.env.JP_DB_PATH) throw error;
    source = previewOverview as JapanSourceData;
  }
  const { counts, archetypes } = summarizeJapanData(source, range);
  const showAll = single(params?.show) === "all";
  const visibleArchetypes = showAll ? archetypes : archetypes.slice(0, 30);
  const rankingParams = new URLSearchParams({ range: range.key });
  if (range.key === "custom") {
    rankingParams.set("from", range.from!);
    rankingParams.set("to", range.to!);
  }
  if (!showAll) rankingParams.set("show", "all");
  const rankingToggleHref = `/japan?${rankingParams.toString()}#placement-ranking`;
  const share = (top8: number) => counts.classified_top8 ? `${(top8 / counts.classified_top8 * 100).toFixed(1)}%` : "—";
  const span = range.key === "all" ? (counts.first_date && counts.latest_date ? `${shortDate(counts.first_date)} – ${shortDate(counts.latest_date)}` : "No imported dates") : `${shortDate(range.from!)} – ${shortDate(range.to!)}`;

  return <main className="min-h-screen bg-[#f4f3ed] text-[#19252d]">
    <SiteHeader active="japan" />
    <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="section-kicker">LoMeta / Japan</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">City League meta</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#66747b]">Which decks are placing best in the imported Japanese City League results? Rankings are based on finishes, not match win rate.</p>
        </div>
        {source.events.length > 0 && <div className="rounded-full border border-[#cdd7cd] bg-[#e5efe8] px-4 py-2 text-xs font-semibold text-[#33694b]">Latest imported: {shortDate(source.events.map((event) => event.event_date).sort().at(-1)!)}</div>}
      </div>

      <div className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3" aria-label="City League overview stats">
        {[["Events sampled", number(counts.events)], ["Ranked archetypes", number(archetypes.length)], ["Classified Top 8", `${counts.classified_top8}/${counts.top8}`]].map(([label, value], index) =>
          <div key={label} className={`rounded-xl border border-[#d7d5cc] bg-white px-4 py-3 sm:px-5 sm:py-4 ${index === 2 ? "col-span-2 sm:col-span-1" : ""}`}><p className="text-[11px] font-semibold uppercase tracking-wider text-[#78858a] sm:text-xs">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums text-[#1d343f] sm:mt-2 sm:text-2xl">{value}</p></div>)}
      </div>

      <section className="mt-8 rounded-2xl border border-[#d7d5cc] bg-white p-5 sm:p-6" aria-label="City League date range">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div><h2 className="text-sm font-semibold text-[#1d343f]">Date range</h2><p className="mt-1 text-sm text-[#66747b]">{range.label} · {span}</p></div>
          <nav aria-label="Quick date ranges" className="flex flex-wrap gap-2">{[["7d", "7 days"], ["30d", "1 month"], ["90d", "3 months"], ["all", "All"]].map(([key, label]) => <a key={key} href={`/japan?range=${key}`} aria-current={range.key === key ? "page" : undefined} className={range.key === key ? "rounded-lg bg-[#1d343f] px-3 py-2 text-xs font-semibold text-white" : "rounded-lg bg-[#f0efe9] px-3 py-2 text-xs font-semibold text-[#52616b] hover:bg-[#e6e4dc]"}>{label}</a>)}</nav>
        </div>
        <form action="/japan" method="get" className="mt-5 flex flex-wrap items-end gap-3 border-t border-[#eeece6] pt-5">
          <input type="hidden" name="range" value="custom" />
          <label className="text-xs font-semibold text-[#52616b]">From<input className="mt-1 block min-h-10 rounded-lg border border-[#d7d5cc] bg-white px-3 text-sm font-normal text-[#1d343f]" type="date" name="from" required defaultValue={range.from ?? counts.first_date ?? ""} /></label>
          <label className="text-xs font-semibold text-[#52616b]">To<input className="mt-1 block min-h-10 rounded-lg border border-[#d7d5cc] bg-white px-3 text-sm font-normal text-[#1d343f]" type="date" name="to" required defaultValue={range.to ?? counts.latest_date ?? ""} /></label>
          <button className="min-h-10 rounded-lg border border-[#b7c8cf] px-4 text-sm font-semibold text-[#27566a] hover:bg-[#edf3f4]" type="submit">Apply dates</button>
        </form>
      </section>

      {!source.events.length && <p className="mt-7 rounded-xl border border-[#d7d5cc] bg-white p-4 text-sm text-[#52616b]">No local City League data yet. Run <code>pnpm japan:sync</code> to import a first sample.</p>}
      {source.events.length > 0 && !counts.events && <p className="mt-7 rounded-xl border border-[#d7d5cc] bg-white p-4 text-sm text-[#52616b]">No imported events fall within {span}. Choose a wider date range.</p>}

      <section id="placement-ranking" className="mt-8 overflow-hidden rounded-2xl border border-[#d7d5cc] bg-white">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#e8e6de] px-5 py-5 sm:px-6">
          <div><h2 className="text-xl font-semibold tracking-tight">Placement ranking</h2><p className="mt-1 text-xs leading-5 text-[#78858a]">{span}. Every figure and winning-list link is limited to this range.</p></div>
          <span className="rounded-full bg-[#f0efe9] px-3 py-1 text-xs font-semibold text-[#52616b]">Showing {visibleArchetypes.length} of {archetypes.length}</span>
        </div>
        {archetypes.length ? <div className="md:overflow-x-auto"><table className="block w-full border-collapse text-left text-sm md:table md:min-w-[760px]">
          <thead className="hidden bg-[#f8f7f3] text-xs font-semibold uppercase tracking-wider text-[#758289] md:table-header-group"><tr><th className="px-5 py-3 sm:px-6" scope="col">Rank / deck</th><th className="px-3 py-3 text-right" scope="col">Points</th><th className="px-3 py-3 text-right" scope="col">1st</th><th className="px-3 py-3 text-right" scope="col">Top 8</th><th className="px-3 py-3 text-right" scope="col">Top 8 share</th><th className="px-5 py-3 text-right sm:px-6" scope="col">Winning list</th></tr></thead>
          <tbody className="block divide-y divide-[#eeece6] md:table-row-group md:divide-y-0">{visibleArchetypes.map((deck, index) => <tr key={deck.id} className="grid grid-cols-2 gap-2 p-4 hover:bg-[#faf9f6] md:table-row md:border-t md:border-[#eeece6] md:p-0"><th scope="row" className="col-span-2 block pb-1 text-left font-medium md:table-cell md:px-5 md:py-4 md:pb-4 md:align-middle"><span className="flex min-w-0 items-center gap-2 text-[#1d343f]"><span className="w-6 shrink-0 tabular-nums text-[#9aa3a5]">{index + 1}</span><DeckSprites icons={deck.icons} /><span className="min-w-0 break-words">{deck.name}</span></span></th><td className="rounded-lg bg-[#f7f8f4] px-3 py-2 font-bold tabular-nums text-[#1d343f] md:table-cell md:rounded-none md:bg-transparent md:py-4 md:text-right"><span className="mb-1 block font-sans text-[10px] font-bold uppercase tracking-wide text-[#718087] md:hidden">Points</span>{deck.placementPoints}</td><td className="rounded-lg bg-[#f7f8f4] px-3 py-2 tabular-nums text-[#52616b] md:table-cell md:rounded-none md:bg-transparent md:py-4 md:text-right"><span className="mb-1 block font-sans text-[10px] font-bold uppercase tracking-wide text-[#718087] md:hidden">1st</span>{deck.wins}</td><td className="rounded-lg bg-[#f7f8f4] px-3 py-2 tabular-nums text-[#52616b] md:table-cell md:rounded-none md:bg-transparent md:py-4 md:text-right"><span className="mb-1 block font-sans text-[10px] font-bold uppercase tracking-wide text-[#718087] md:hidden">Top 8</span>{deck.top8}</td><td className="rounded-lg bg-[#f7f8f4] px-3 py-2 tabular-nums text-[#52616b] md:table-cell md:rounded-none md:bg-transparent md:py-4 md:text-right"><span className="mb-1 block font-sans text-[10px] font-bold uppercase tracking-wide text-[#718087] md:hidden">Top 8 share</span>{share(deck.top8)}</td><td className="col-span-2 pt-1 md:table-cell md:px-5 md:py-4 md:pt-4 md:text-right">{deck.latestWinningListUrl ? <a className="block rounded-lg border border-[#c6d0d0] bg-white px-3 py-2 text-center font-semibold text-[#27566a] hover:border-[#3485a4] md:inline md:border-0 md:bg-transparent md:p-0 md:text-right md:underline md:underline-offset-4" href={deck.latestWinningListUrl} target="_blank" rel="noreferrer" aria-label={`Latest 1st-place ${deck.name} list on Limitless`}><span className="md:hidden">Winning list · </span>{deck.latestWinningDate} ↗</a> : <span className="text-[#9aa3a5]"><span className="md:hidden">No winning list</span><span className="hidden md:inline">—</span></span>}</td></tr>)}</tbody>
        </table></div> : <p className="px-6 py-8 text-sm text-[#66747b]">No classified placements imported yet.</p>}
        {archetypes.length > 30 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e8e6de] px-5 py-4 sm:px-6">
          <p className="text-xs text-[#66747b]">{showAll ? "All ranked archetypes are shown." : "Top 30 shown for this date range."}</p>
          <a className="inline-flex min-h-10 items-center rounded-lg border border-[#b7c8cf] px-4 text-sm font-semibold text-[#27566a] hover:bg-[#edf3f4] focus:outline-none focus:ring-2 focus:ring-[#9fd1e3]" href={rankingToggleHref}>{showAll ? "Show top 30" : `Show all ${archetypes.length}`}</a>
        </div>}
      </section>

      <div className="mt-5 rounded-xl border border-[#d7d5cc] bg-[#fbfaf6] px-5 py-4 text-xs leading-5 text-[#66747b]">
        <p><strong className="text-[#1d343f]">How points work:</strong> 1st = 8, 2nd = 6, 3rd–4th = 4, 5th–8th = 2, 9th–16th = 1. Points add across imported results. Top 8 share is the deck’s share of classified Top 8 appearances.</p>
        <p className="mt-2">This is a placement measure, not a match win rate or a Top 8 conversion rate. Entrants and unplaced decks are not known. Winning-list links go to the most recent available 1st-place decklist for that archetype.</p>
      </div>

      <footer className="mt-12 border-t border-[#d2d0c6] pt-5 text-xs text-[#78858a]">Source: <a className="underline" href="https://www.limitlesstcg.com/tournaments/jp" target="_blank" rel="noreferrer">Limitless City League</a> · Independent analysis, not affiliated with Limitless or The Pokémon Company.</footer>
    </div>
  </main>;
}
