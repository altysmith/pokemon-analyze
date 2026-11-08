import { NextRequest, NextResponse } from "next/server";
import { openJapanDb } from "@/db/japan";
import { fetchJapanDecklist, storedJapanDecklist, storeJapanDecklist } from "@/lib/japan/decklist-content";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const decklistId = request.nextUrl.searchParams.get("id") ?? "";
  if (!/^\d+$/.test(decklistId)) {
    return NextResponse.json({ error: "Invalid decklist." }, { status: 400 });
  }
  const db = openJapanDb();
  try {
    const row = db.prepare("SELECT source_url AS sourceUrl FROM jp_decklists WHERE source_url = ? LIMIT 1")
      .get(`https://www.limitlesstcg.com/decks/list/jp/${decklistId}`) as { sourceUrl: string } | undefined;
    if (!row) return NextResponse.json({ error: "Decklist not found." }, { status: 404 });
    let cards = storedJapanDecklist(db, row.sourceUrl);
    if (!cards) {
      try {
        cards = await fetchJapanDecklist(row.sourceUrl);
        storeJapanDecklist(db, row.sourceUrl, cards);
      } catch (error) {
        console.error("City League decklist unavailable", row.sourceUrl, error);
        return NextResponse.json({ error: "Could not load this decklist. Please try again." }, { status: 502 });
      }
    }
    return NextResponse.json({ cards }, { headers: { "Cache-Control": "private, max-age=60" } });
  } finally {
    db.close();
  }
}
