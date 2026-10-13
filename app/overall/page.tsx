import { OverallMeta } from "../components/overall-meta";
import { SiteHeader } from "../components/site-header";
import { aggregateMeta, getSeasonData, type Geography, type MetaDeck } from "@/lib/limitless/season";

export const dynamic = "force-dynamic";

const geographies: Geography[] = ["all", "us", "europe", "south-america", "oceania"];

export default async function OverallPage() {
  let events;
  try {
    events = await getSeasonData();
  } catch (error) {
    return <main className="min-h-screen bg-[#f4f3ed] text-[#161d24]"><SiteHeader active="overall" /><div className="mx-auto max-w-7xl px-5 py-16 sm:px-8"><h1 className="text-3xl font-semibold">Metagame data is temporarily unavailable</h1><p className="mt-3 text-[#68777f]">{error instanceof Error ? error.message : "Please try again shortly."}</p></div></main>;
  }
  const byGeography = Object.fromEntries(geographies.map((geography) => [
    geography,
    aggregateMeta(events.filter((event) => geography === "all" || event.geography === geography)),
  ])) as Record<Geography, MetaDeck[]>;
  return <main className="min-h-screen bg-[#f4f3ed] text-[#161d24]"><SiteHeader active="overall" /><div className="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-14"><OverallMeta byGeography={byGeography} /><div className="mt-12 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#d7d5cc] bg-white px-5 py-4"><p className="text-sm text-[#52616b]">Looking beyond the top 15?</p><a href="/rankings" className="inline-flex min-h-11 items-center font-semibold text-[#27566a] underline underline-offset-4 hover:text-[#18323d] focus:outline-none focus:ring-2 focus:ring-[#3485a4]">View full deck ranking →</a></div><footer className="mt-12 border-t border-[#d2d0c6] pt-5 text-xs text-[#78858a]">Data: <a className="underline" href="https://labs.limitlesstcg.com/" target="_blank" rel="noreferrer">Limitless Labs</a> · Independent Pokémon TCG analysis.</footer></div></main>;
}
