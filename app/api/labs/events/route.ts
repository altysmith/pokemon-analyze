import { NextResponse } from "next/server";
import { listLabsEvents } from "@/lib/limitless";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const events = await listLabsEvents();
    return NextResponse.json({ source: "limitless-labs", events });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load Labs events." },
      { status: 502 },
    );
  }
}
