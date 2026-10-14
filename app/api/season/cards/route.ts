import { NextRequest, NextResponse } from "next/server";
import { getCardComparison } from "@/lib/limitless/card-trends";
import { getRegionalData, SEASON_REGIONALS } from "@/lib/limitless/season";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";
  const deck = request.nextUrl.searchParams.get("deck") ?? "";
  if (!from || !to || !deck) return NextResponse.json({ error: "Choose two Regionals and a deck." }, { status: 400 });
  const fromEvent = SEASON_REGIONALS.find((event) => event.id === from);
  if (!fromEvent || !SEASON_REGIONALS.some((event) => event.id === to)) {
    return NextResponse.json({ error: "Unknown Regional." }, { status: 400 });
  }
  try {
    const source = await getRegionalData(fromEvent);
    const deckName = source.decks.find((item) => item.slug === deck)?.name;
    if (!deckName) return NextResponse.json({ error: "Deck not found at the starting Regional." }, { status: 404 });
    const comparison = await getCardComparison(from, to, deck, deckName);
    return NextResponse.json(comparison, { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=1800" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load card averages." }, { status: 502 });
  }
}
