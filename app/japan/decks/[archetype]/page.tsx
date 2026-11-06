import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "../../../components/site-header";
import { DeckSprites } from "../../../components/deck-sprites";
import { openJapanDb } from "@/db/japan";
import { resolveJapanDateRange } from "@/lib/japan/date-range";
import { japanSourceData, summarizeJapanData, topJapanDecklists, type JapanSourceData } from "@/lib/japan/overview";
import previewOverview from "@/lib/japan/preview-overview.json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const shortDate = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const ordinal = (value: number) => {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;
  return `${value}${value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th"}`;
};

export default async function JapanDeckPage({ params, searchParams }: {
  params: Promise<{ archetype: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ archetype: archetypeId }, query] = await Promise.all([params, searchParams]);
  const single = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const range = resolveJapanDateRange({ range: single(query.range), from: single(query.from), to: single(query.to) });
  let source: JapanSourceData;
  try {
    const db = openJapanDb();
    try { source = japanSourceData(db); } finally { db.close(); }
  } catch (error) {
    if (process.env.JP_DB_PATH) throw error;
    source = previewOverview as JapanSourceData;
  }
  const { archetypes } = summarizeJapanData(source, range);
  const archetype = archetypes.find((item) => item.id === archetypeId);
  if (!archetype) notFound();
  const decklists = topJapanDecklists(source, archetype.id, range);
  const rangeParams = new URLSearchParams({ range: range.key });
  if (range.key === "custom") {
    rangeParams.set("from", range.from!);
    rangeParams.set("to", range.to!);
  }
  const backHref = `/japan?${rangeParams.toString()}#placement-ranking`;

  return <main className="min-h-screen bg-[#f4f3ed] text-[#19252d]">
    <SiteHeader active="japan" />
    <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <Link href={backHref} className="inline-flex min-h-10 items-center text-sm font-semibold text-[#27566a] underline underline-offset-4 hover:text-[#18323d] focus:outline-none focus:ring-2 focus:ring-[#9fd1e3]">← Back to Japan rankings</Link>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <DeckSprites icons={archetype.icons} />
        <div>
          <p className="section-kicker">LoMeta / Japan / {range.label}</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">{archetype.name}</h1>
        </div>
      </div>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-[#66747b]">The strongest published City League lists in this date range, ordered by finish with newer results breaking ties.</p>

      <div className="mt-7 grid grid-cols-3 gap-2 sm:gap-3" aria-label={`${archetype.name} summary`}>
        {[["Points", archetype.placementPoints], ["1st place", archetype.wins], ["Top 8", archetype.top8]].map(([label, value]) => <div key={label} className="rounded-xl border border-[#d7d5cc] bg-white px-4 py-3 sm:px-5 sm:py-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-[#78858a] sm:text-xs">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums text-[#1d343f] sm:mt-2 sm:text-2xl">{value}</p></div>)}
      </div>

      <section className="mt-8 overflow-hidden rounded-2xl border border-[#d7d5cc] bg-white" aria-labelledby="top-decklists-heading">
        <div className="border-b border-[#e8e6de] px-5 py-5 sm:px-6">
          <h2 id="top-decklists-heading" className="text-xl font-semibold tracking-tight">Top {Math.min(10, decklists.length)} decklists</h2>
          <p className="mt-1 text-xs leading-5 text-[#78858a]">Only placements with a published Limitless decklist are included.</p>
        </div>
        {decklists.length ? <ol className="divide-y divide-[#eeece6]">{decklists.map((deck, index) => <li key={`${deck.event_id}-${deck.decklist_url}`} className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-start gap-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#f0efe9] text-sm font-bold tabular-nums text-[#52616b]">{index + 1}</span>
            <div className="min-w-0">
              <p className="font-semibold text-[#1d343f]">{ordinal(deck.placing)} place · {shortDate(deck.event_date)}</p>
              {deck.player_name_raw && <p className="mt-1 break-words text-sm text-[#52616b]">{deck.player_name_raw}</p>}
              <p className="mt-1 text-xs text-[#78858a]">{[deck.shop_raw, deck.prefecture_raw].filter(Boolean).join(" · ") || `City League event ${deck.event_id}`}</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 pl-13 sm:pl-0">
            <a href={`https://www.limitlesstcg.com/tournaments/jp/${deck.event_id}`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center rounded-lg border border-[#c6d0d0] px-3 text-sm font-semibold text-[#52616b] hover:border-[#3485a4]">Event ↗</a>
            <a href={deck.decklist_url} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center rounded-lg bg-[#27566a] px-4 text-sm font-semibold text-white hover:bg-[#18323d]">View decklist ↗</a>
          </div>
        </li>)}</ol> : <p className="px-6 py-10 text-sm text-[#66747b]">No published decklists are available for this archetype in the selected date range.</p>}
      </section>

      <div className="mt-5 rounded-xl border border-[#d7d5cc] bg-[#fbfaf6] px-5 py-4 text-xs leading-5 text-[#66747b]">Results rank tournament finishes rather than match win rate. If fewer than ten published lists are available, every available list is shown.</div>
    </div>
  </main>;
}
