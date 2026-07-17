import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { users, watches, notificationChannels } from "@/lib/schema";
import { eq, count, sql } from "drizzle-orm";

export async function GET() {
  try {
    const gate = await requireAdmin();
    if ("error" in gate) return gate.error;

    // Get all users with watch and channel counts
    const allUsers = await db.select().from(users);

    const usersWithCounts = await Promise.all(
      allUsers.map(async (user) => {
        const [watchCount] = await db
          .select({ count: count() })
          .from(watches)
          .where(eq(watches.userId, user.id));

        const [channelCount] = await db
          .select({ count: count() })
          .from(notificationChannels)
          .where(eq(notificationChannels.userId, user.id));

        return {
          ...user,
          watchCount: watchCount.count,
          channelCount: channelCount.count,
        };
      })
    );

    return NextResponse.json({ users: usersWithCounts });
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const gate = await requireAdmin();
    if ("error" in gate) return gate.error;

    const { email, name, isAllowed, isAdmin } = await request.json();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    // Normalize email to lowercase for consistency
    const normalizedEmail = email.toLowerCase();

    // Check if user already exists
    const existingUser = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
    if (existingUser.length > 0) {
      return NextResponse.json({ error: "User with this email already exists" }, { status: 400 });
    }

    // Create new user
    const [newUser] = await db.insert(users).values({
      email: normalizedEmail,
      name: name || null,
      isAllowed: isAllowed ? 1 : 0,
      isAdmin: isAdmin ? 1 : 0,
      createdAt: sql`CURRENT_TIMESTAMP`,
    }).returning();

    return NextResponse.json({ user: newUser }, { status: 201 });
  } catch (error) {
    console.error("Error creating user:", error);
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}
