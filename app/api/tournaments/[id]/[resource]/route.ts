import { NextResponse } from "next/server";
import {
  getTournamentDetails,
  getTournamentPairings,
  getTournamentStandings,
} from "@/lib/limitless";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string; resource: string }>;
};

export async function GET(_request: Request, context: Context) {
  const { id, resource } = await context.params;
  try {
    const data =
      resource === "details"
        ? await getTournamentDetails(id)
        : resource === "standings"
          ? await getTournamentStandings(id)
          : resource === "pairings"
            ? await getTournamentPairings(id)
            : null;

    if (data === null) {
      return NextResponse.json(
        { error: "Resource must be details, standings, or pairings." },
        { status: 404 },
      );
    }
    return NextResponse.json({ source: "play-limitless-api", data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load tournament data.";
    const status = message === "Invalid tournament ID." ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
