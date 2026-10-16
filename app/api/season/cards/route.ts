import { NextRequest, NextResponse } from "next/server";
import { getCardComparison } from "@/lib/limitless/card-trends";
import { getSeasonData } from "@/lib/limitless/season";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";
  const deck = request.nextUrl.searchParams.get("deck") ?? "";
  if (!from || !to || !deck) return NextResponse.json({ error: "Choose two events and a deck." }, { status: 400 });
  try {
    const season = await getSeasonData();
    const fromEvent = season.find((event) => event.id === from);
    const toEvent = season.find((event) => event.id === to);
    if (!fromEvent || !toEvent) return NextResponse.json({ error: "Unknown event." }, { status: 400 });
    if (!fromEvent.mainEventId || !toEvent.mainEventId) return NextResponse.json({
      status: "unavailable", fromDecklists: 0, toDecklists: 0, added: [], removed: [],
      fromUrl: `https://labs.limitlesstcg.com/${from}/decks`, toUrl: `https://labs.limitlesstcg.com/${to}/decks`,
      message: "Published card averages have not been linked for one of these events yet.",
    });
    const deckName = season.flatMap((event) => event.decks).find((item) => item.slug === deck)?.name;
    if (!deckName) return NextResponse.json({ error: "Deck not found in this season." }, { status: 404 });
    const comparison = await getCardComparison(fromEvent.mainEventId, toEvent.mainEventId, deck, deckName);
    return NextResponse.json(comparison, { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=1800" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load card averages." }, { status: 502 });
  }
}
