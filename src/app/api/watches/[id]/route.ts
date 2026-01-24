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

  return NextResponse.json({
    watch: {
      id: watch.id,
      userId: watch.userId,
      venue: venue ? { slug: venue.slug, name: venue.name } : null,
      weekdayTimes: watch.weekdayTimes
        ? JSON.parse(watch.weekdayTimes)
        : null,
      weekendTimes: watch.weekendTimes
        ? JSON.parse(watch.weekendTimes)
        : null,
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
  const { venueSlug, weekdayTimes, weekendTimes, active } = body;

  // Get venue ID if provided
  let venueId = existingWatch.venueId;
  if (venueSlug !== undefined) {
    if (venueSlug === null) {
      venueId = null;
    } else {
      const venue = await db.query.venues.findFirst({
        where: eq(venues.slug, venueSlug),
      });
      if (venue) {
        venueId = venue.id;
      } else {
        return NextResponse.json({ error: "Invalid venue" }, { status: 400 });
      }
    }
  }

  const updateData: {
    venueId: number | null;
    weekdayTimes: string | null;
    weekendTimes: string | null;
    active?: number;
  } = {
    venueId,
    weekdayTimes: weekdayTimes !== undefined
      ? weekdayTimes ? JSON.stringify(weekdayTimes) : null
      : existingWatch.weekdayTimes,
    weekendTimes: weekendTimes !== undefined
      ? weekendTimes ? JSON.stringify(weekendTimes) : null
      : existingWatch.weekendTimes,
  };

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

  return NextResponse.json({
    watch: {
      id: updatedWatch.id,
      userId: updatedWatch.userId,
      venue: venue ? { slug: venue.slug, name: venue.name } : null,
      weekdayTimes: updatedWatch.weekdayTimes
        ? JSON.parse(updatedWatch.weekdayTimes)
        : null,
      weekendTimes: updatedWatch.weekendTimes
        ? JSON.parse(updatedWatch.weekendTimes)
        : null,
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

  return NextResponse.json({
    watch: {
      id: updatedWatch.id,
      userId: updatedWatch.userId,
      venue: venue ? { slug: venue.slug, name: venue.name } : null,
      weekdayTimes: updatedWatch.weekdayTimes
        ? JSON.parse(updatedWatch.weekdayTimes)
        : null,
      weekendTimes: updatedWatch.weekendTimes
        ? JSON.parse(updatedWatch.weekendTimes)
        : null,
      active: Boolean(updatedWatch.active),
    },
  });
}
