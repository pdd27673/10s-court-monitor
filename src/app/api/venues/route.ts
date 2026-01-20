import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { VENUES } from "@/lib/scraper";

export async function GET() {
  // Return venues from the scraper config (always up to date)
  // Could also fetch from DB if we need dynamic venues
  return NextResponse.json({
    venues: VENUES,
  });
}
