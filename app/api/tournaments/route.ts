import { NextRequest, NextResponse } from "next/server";
import { listTournaments } from "@/lib/limitless";

export const dynamic = "force-dynamic";

const boundedNumber = (value: string | null, fallback: number, max: number) =>
  Math.min(max, Math.max(1, Number(value) || fallback));

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  try {
    const tournaments = await listTournaments({
      game: params.get("game") || "PTCG",
      format: params.get("format") || undefined,
      organizerId: params.has("organizerId")
        ? boundedNumber(params.get("organizerId"), 1, Number.MAX_SAFE_INTEGER)
        : undefined,
      limit: boundedNumber(params.get("limit"), 50, 100),
      page: boundedNumber(params.get("page"), 1, 10_000),
    });
    return NextResponse.json({ source: "play-limitless-api", tournaments });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load tournaments." },
      { status: 502 },
    );
  }
}
