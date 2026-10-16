import { FullRankings } from "../components/full-rankings";
import { SiteHeader } from "../components/site-header";
import { aggregateMeta, getSeasonData, type Geography, type MetaDeck } from "@/lib/limitless/season";

export const dynamic = "force-dynamic";

const geographies: Geography[] = ["all", "us", "europe", "south-america", "oceania", "other"];

export default async function RankingsPage() {
  let events;
  try {
    events = await getSeasonData();
  } catch (error) {
    return <main className="min-h-screen bg-[#f4f3ed] text-[#161d24]"><SiteHeader active="rankings" /><div className="mx-auto max-w-7xl px-5 py-16 sm:px-8"><h1 className="text-3xl font-semibold">Metagame data is temporarily unavailable</h1><p className="mt-3 text-[#68777f]">{error instanceof Error ? error.message : "Please try again shortly."}</p></div></main>;
  }
  const byGeography = Object.fromEntries(geographies.map((geography) => [
    geography,
    aggregateMeta(events.filter((event) => geography === "all" || event.geography === geography)),
  ])) as Record<Geography, MetaDeck[]>;
  return <main className="min-h-screen bg-[#f4f3ed] text-[#161d24]"><SiteHeader active="rankings" /><div className="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-14"><FullRankings byGeography={byGeography} /><footer className="mt-12 border-t border-[#d2d0c6] pt-5 text-xs text-[#78858a]">Data: <a className="underline" href="https://labs.limitlesstcg.com/" target="_blank" rel="noreferrer">Limitless Labs</a> · Independent Pokémon TCG analysis.</footer></div></main>;
}
