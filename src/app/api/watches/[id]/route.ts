import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { watches, venues } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";

// GET /api/watches/[id] - Get a specific watch
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const watchId = parseInt(id);
  const userId = parseInt(session.user.id);

  if (isNaN(watchId)) {
    return NextResponse.json({ error: "Invalid watch ID" }, { status: 400 });
  }

  const watch = await db.query.watches.findFirst({
    where: and(eq(watches.id, watchId), eq(watches.userId, userId)),
  });

  if (!watch) {
    return NextResponse.json({ error: "Watch not found" }, { status: 404 });
  }

  let venue = null;
  if (watch.venueId) {
    venue = await db.query.venues.findFirst({
      where: eq(venues.id, watch.venueId),
    });
  }

  // Support both new dayTimes and legacy weekday/weekend fields
  let dayTimes = null;
  if (watch.dayTimes) {
    dayTimes = JSON.parse(watch.dayTimes);
  } else if (watch.weekdayTimes || watch.weekendTimes) {
    // Convert legacy format to new format
    const weekday = watch.weekdayTimes ? JSON.parse(watch.weekdayTimes) : [];
    const weekend = watch.weekendTimes ? JSON.parse(watch.weekendTimes) : [];
    dayTimes = {
      monday: weekday,
      tuesday: weekday,
      wednesday: weekday,
      thursday: weekday,
      friday: weekday,
      saturday: weekend,
      sunday: weekend,
    };
  }

  return NextResponse.json({
    watch: {
      id: watch.id,
      userId: watch.userId,
      venue: venue ? { slug: venue.slug, name: venue.name } : null,
      dayTimes,
      active: Boolean(watch.active),
    },
  });
}

// PUT /api/watches/[id] - Update a watch
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const watchId = parseInt(id);
  const userId = parseInt(session.user.id);

  if (isNaN(watchId)) {
    return NextResponse.json({ error: "Invalid watch ID" }, { status: 400 });
  }

  // Verify watch belongs to user
  const existingWatch = await db.query.watches.findFirst({
    where: and(eq(watches.id, watchId), eq(watches.userId, userId)),
  });

  if (!existingWatch) {
    return NextResponse.json({ error: "Watch not found" }, { status: 404 });
  }

  const body = await request.json();
  const { dayTimes, active } = body;

  const updateData: {
    dayTimes?: string | null;
    active?: number;
  } = {};

  if (dayTimes !== undefined) {
    updateData.dayTimes = dayTimes ? JSON.stringify(dayTimes) : null;
  }

  if (active !== undefined) {
    updateData.active = active ? 1 : 0;
  }

  const updatedWatches = await db
    .update(watches)
    .set(updateData)
    .where(and(eq(watches.id, watchId), eq(watches.userId, userId)))
    .returning();

  // Defensive check: ensure update actually affected a row
  if (!updatedWatches || updatedWatches.length === 0) {
    return NextResponse.json(
      { error: "Watch not found or access denied" },
      { status: 404 }
    );
  }

  const updatedWatch = updatedWatches[0];

  let venue = null;
  if (updatedWatch.venueId) {
    venue = await db.query.venues.findFirst({
      where: eq(venues.id, updatedWatch.venueId),
    });
  }

  // Support both new dayTimes and legacy weekday/weekend fields
  let responseDayTimes = null;
  if (updatedWatch.dayTimes) {
    responseDayTimes = JSON.parse(updatedWatch.dayTimes);
  } else if (updatedWatch.weekdayTimes || updatedWatch.weekendTimes) {
    // Convert legacy format to new format
    const weekday = updatedWatch.weekdayTimes ? JSON.parse(updatedWatch.weekdayTimes) : [];
    const weekend = updatedWatch.weekendTimes ? JSON.parse(updatedWatch.weekendTimes) : [];
    responseDayTimes = {
      monday: weekday,
      tuesday: weekday,
      wednesday: weekday,
      thursday: weekday,
      friday: weekday,
      saturday: weekend,
      sunday: weekend,
    };
  }

  return NextResponse.json({
    watch: {
      id: updatedWatch.id,
      userId: updatedWatch.userId,
      venue: venue ? { slug: venue.slug, name: venue.name } : null,
      dayTimes: responseDayTimes,
      active: Boolean(updatedWatch.active),
    },
  });
}

// DELETE /api/watches/[id] - Delete a watch
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const watchId = parseInt(id);
  const userId = parseInt(session.user.id);

  if (isNaN(watchId)) {
    return NextResponse.json({ error: "Invalid watch ID" }, { status: 400 });
  }

  // Verify watch belongs to user
  const existingWatch = await db.query.watches.findFirst({
    where: and(eq(watches.id, watchId), eq(watches.userId, userId)),
  });

  if (!existingWatch) {
    return NextResponse.json({ error: "Watch not found" }, { status: 404 });
  }

  const deletedWatches = await db
    .delete(watches)
    .where(and(eq(watches.id, watchId), eq(watches.userId, userId)))
    .returning();

  // Defensive check: ensure delete actually affected a row
  if (!deletedWatches || deletedWatches.length === 0) {
    return NextResponse.json(
      { error: "Watch not found or access denied" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true });
}

// PATCH /api/watches/[id] - Toggle active status
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const watchId = parseInt(id);
  const userId = parseInt(session.user.id);

  if (isNaN(watchId)) {
    return NextResponse.json({ error: "Invalid watch ID" }, { status: 400 });
  }

  const body = await request.json();
  const { active } = body;

  if (typeof active !== "boolean") {
    return NextResponse.json(
      { error: "active must be a boolean" },
      { status: 400 }
    );
  }

  // Verify watch belongs to user
  const existingWatch = await db.query.watches.findFirst({
    where: and(eq(watches.id, watchId), eq(watches.userId, userId)),
  });

  if (!existingWatch) {
    return NextResponse.json({ error: "Watch not found" }, { status: 404 });
  }

  const updatedWatches = await db
    .update(watches)
    .set({ active: active ? 1 : 0 })
    .where(and(eq(watches.id, watchId), eq(watches.userId, userId)))
    .returning();

  // Defensive check: ensure update actually affected a row
  if (!updatedWatches || updatedWatches.length === 0) {
    return NextResponse.json(
      { error: "Watch not found or access denied" },
      { status: 404 }
    );
  }

  const updatedWatch = updatedWatches[0];

  let venue = null;
  if (updatedWatch.venueId) {
    venue = await db.query.venues.findFirst({
      where: eq(venues.id, updatedWatch.venueId),
    });
  }

  // Support both new dayTimes and legacy weekday/weekend fields
  let dayTimes = null;
  if (updatedWatch.dayTimes) {
    dayTimes = JSON.parse(updatedWatch.dayTimes);
  } else if (updatedWatch.weekdayTimes || updatedWatch.weekendTimes) {
    // Convert legacy format to new format
    const weekday = updatedWatch.weekdayTimes ? JSON.parse(updatedWatch.weekdayTimes) : [];
    const weekend = updatedWatch.weekendTimes ? JSON.parse(updatedWatch.weekendTimes) : [];
    dayTimes = {
      monday: weekday,
      tuesday: weekday,
      wednesday: weekday,
      thursday: weekday,
      friday: weekday,
      saturday: weekend,
      sunday: weekend,
    };
  }

  return NextResponse.json({
    watch: {
      id: updatedWatch.id,
      userId: updatedWatch.userId,
      venue: venue ? { slug: venue.slug, name: venue.name } : null,
      dayTimes,
      active: Boolean(updatedWatch.active),
    },
  });
}
