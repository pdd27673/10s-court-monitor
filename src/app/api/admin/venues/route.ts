import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, venues } from "@/lib/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const user = await db.select().from(users).where(eq(users.email, session.user.email)).limit(1);
    if (!user[0] || !user[0].isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const allVenues = await db.select().from(venues);

    return NextResponse.json({ venues: allVenues });
  } catch (error) {
    console.error("Error fetching venues:", error);
    return NextResponse.json({ error: "Failed to fetch venues" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const adminUser = await db.select().from(users).where(eq(users.email, session.user.email)).limit(1);
    if (!adminUser[0] || !adminUser[0].isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
