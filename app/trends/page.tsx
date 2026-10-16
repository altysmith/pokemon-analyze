import { SeasonTrends } from "../components/season-trends";
import { SiteHeader } from "../components/site-header";
import { aggregateMeta, getSeasonData, type Geography } from "@/lib/limitless/season";

export const dynamic = "force-dynamic";

export default async function Home() {
  let events;
  try {
    events = await getSeasonData();
  } catch (error) {
    return <main className="min-h-screen bg-[#f4f3ed] text-[#161d24]"><SiteHeader active="trends" /><div className="mx-auto max-w-7xl px-5 py-16 sm:px-8"><h1 className="text-3xl font-semibold">Regional data is temporarily unavailable</h1><p className="mt-3 text-[#68777f]">{error instanceof Error ? error.message : "Please try again shortly."}</p></div></main>;
  }

  return (
    <main className="min-h-screen bg-[#f4f3ed] text-[#161d24]">
      <SiteHeader active="trends" />
      <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
          <div><p className="section-kicker">LoMeta / 2027 season</p><h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Regional trends</h1><p className="mt-3 text-sm leading-6 text-[#66747b]">Five Regionals so far. Compare shifts in play rate and performance from event to event.</p></div>
          <div className="rounded-xl border border-[#cdd7cd] bg-[#e5efe8] px-4 py-3 text-sm font-semibold text-[#33694b]">{events.length} events · {events.reduce((sum, event) => sum + event.playerTotal, 0).toLocaleString()} decks</div>
        </div>
        <SeasonTrends events={events} byGeography={Object.fromEntries(
          (["all", "us", "europe", "south-america", "oceania"] as Geography[]).map((geography) => [
            geography,
            aggregateMeta(events.filter((event) => geography === "all" || event.geography === geography)),
          ]),
        ) as Record<Geography, ReturnType<typeof aggregateMeta>>} />
        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#d7d5cc] bg-white px-5 py-4">
          <p className="text-sm text-[#52616b]">Want to see every deck in the 2027 field?</p>
          <a href="/rankings" className="inline-flex min-h-11 items-center font-semibold text-[#27566a] underline underline-offset-4 hover:text-[#18323d] focus:outline-none focus:ring-2 focus:ring-[#3485a4]">View full deck ranking →</a>
        </div>
        <footer className="mt-12 border-t border-[#d2d0c6] pt-5 text-xs text-[#78858a]">Data: <a className="underline" href="https://labs.limitlesstcg.com/" target="_blank" rel="noreferrer">Limitless Labs</a> · Independent Pokémon TCG analysis.</footer>
      </div>
    </main>
  );
}
