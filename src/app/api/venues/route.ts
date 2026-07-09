import { NextResponse } from "next/server";
import type { VenuesResponse } from "@pdd27673/10s-contract";
import { VENUES } from "@/lib/constants";

export async function GET() {
  // Return venues from the scraper config (always up to date)
  // Could also fetch from DB if we need dynamic venues
  const response: VenuesResponse = {
    venues: [...VENUES],
  };
  return NextResponse.json(response);
}
