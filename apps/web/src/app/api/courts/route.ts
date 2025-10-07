import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { courtSlots, venues } from "@10s/database";
import { eq, and, gte, desc } from "drizzle-orm";

// GET /api/courts - Fetch available court slots
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const venueId = searchParams.get('venueId');
    const limit = parseInt(searchParams.get('limit') || '50');

    const db = getDb();

    // Build query
    const now = new Date();
    const slots = await db
      .select({
        id: courtSlots.id,
        venueId: courtSlots.venueId,
        venueName: venues.name,
        courtName: courtSlots.courtName,
        startTime: courtSlots.startTime,
        endTime: courtSlots.endTime,
        price: courtSlots.price,
        currency: courtSlots.currency,
        bookingUrl: courtSlots.bookingUrl,
        isAvailable: courtSlots.isAvailable,
        scrapedAt: courtSlots.scrapedAt,
      })
      .from(courtSlots)
      .leftJoin(venues, eq(courtSlots.venueId, venues.id))
      .where(
        venueId
          ? and(
              eq(courtSlots.isAvailable, true),
              gte(courtSlots.startTime, now),
              eq(courtSlots.venueId, venueId)
            )
          : and(
              eq(courtSlots.isAvailable, true),
              gte(courtSlots.startTime, now)
            )
      )
      .orderBy(courtSlots.startTime)
      .limit(limit);

    return NextResponse.json({
      success: true,
      count: slots.length,
      slots,
    });
  } catch (error) {
    console.error('Error fetching courts:', error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch court slots",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
