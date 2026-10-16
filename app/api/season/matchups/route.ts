import { NextRequest, NextResponse } from "next/server";
import { aggregateMeta, getAggregatedMatchups, getSeasonData, type Geography } from "@/lib/limitless/season";

export const dynamic = "force-dynamic";

const geographies = new Set<Geography>(["all", "us", "europe", "south-america", "oceania", "other"]);

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("deck") ?? "";
  const requestedGeography = request.nextUrl.searchParams.get("geography") ?? "all";
  const geography = geographies.has(requestedGeography as Geography)
    ? requestedGeography as Geography
    : "all";
  const requestedOpponents = Number(request.nextUrl.searchParams.get("opponents"));
  const opponentCount = [10, 15, 20, 25].includes(requestedOpponents) ? requestedOpponents : 15;
  try {
    const all = await getSeasonData();
    const events = all.filter((event) => geography === "all" || event.geography === geography);
    const top = aggregateMeta(events).slice(0, opponentCount);
    const matchups = await getAggregatedMatchups(events, slug, top.map((deck) => deck.slug));
    return NextResponse.json({ deck: slug, geography, matchups }, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=1800" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load matchups." },
      { status: 502 },
    );
  }
}
