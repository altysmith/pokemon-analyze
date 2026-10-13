import { NextRequest, NextResponse } from "next/server";
import { getOverallMetagame } from "@/lib/limitless";

export const dynamic = "force-dynamic";

const safeLimit = (value: string | null) =>
  Math.min(100, Math.max(1, Number(value) || 50));

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  try {
    const decks = await getOverallMetagame({
      format: params.get("format") || undefined,
      time: params.get("time") || "1months",
      splitVariants: params.get("variants") !== "combined",
      limit: safeLimit(params.get("limit")),
    });
    return NextResponse.json({ source: "limitless-overall-meta", decks });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load metagame." },
      { status: 502 },
    );
  }
}
