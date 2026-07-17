import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { venues, watches, slots } from "@/lib/schema";
import { eq } from "drizzle-orm";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireAdmin();
    if ("error" in gate) return gate.error;

    const { id } = await params;
    const venueId = parseInt(id, 10);

    if (isNaN(venueId)) {
      return NextResponse.json({ error: "Invalid venue ID" }, { status: 400 });
    }

    // Delete associated watches and slots first
    await db.delete(watches).where(eq(watches.venueId, venueId));
    await db.delete(slots).where(eq(slots.venueId, venueId));
    
    // Delete the venue
    await db.delete(venues).where(eq(venues.id, venueId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting venue:", error);
    return NextResponse.json({ error: "Failed to delete venue" }, { status: 500 });
  }
}
