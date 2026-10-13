import { NextResponse } from "next/server";
import { checkLimitlessSources } from "@/lib/limitless";

export const dynamic = "force-dynamic";

export async function GET() {
  const sources = await checkLimitlessSources();
  const connected = sources.filter((source) => source.status === "connected").length;
  return NextResponse.json(
    {
      status: connected === sources.length ? "connected" : "degraded",
      connected,
      total: sources.length,
      sources,
    },
    {
      status: connected > 0 ? 200 : 503,
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    },
  );
}
