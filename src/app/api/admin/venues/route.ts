import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { venues } from "@/lib/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const gate = await requireAdmin();
    if ("error" in gate) return gate.error;

    const allVenues = await db.select().from(venues);

    return NextResponse.json({ venues: allVenues });
  } catch (error) {
    console.error("Error fetching venues:", error);
    return NextResponse.json({ error: "Failed to fetch venues" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const gate = await requireAdmin();
    if ("error" in gate) return gate.error;

    const { name, slug } = await request.json();

    if (!name || !slug) {
      return NextResponse.json({ error: "Name and slug are required" }, { status: 400 });
    }

    // Check if venue with slug already exists
    const existingVenue = await db.select().from(venues).where(eq(venues.slug, slug)).limit(1);
    if (existingVenue.length > 0) {
      return NextResponse.json({ error: "Venue with this slug already exists" }, { status: 400 });
    }

    // Create new venue (type/platform config is defined in constants.ts)
    const [newVenue] = await db.insert(venues).values({
      name,
      slug,
    }).returning();

    return NextResponse.json({ venue: newVenue }, { status: 201 });
  } catch (error) {
    console.error("Error creating venue:", error);
    return NextResponse.json({ error: "Failed to create venue" }, { status: 500 });
  }
}
