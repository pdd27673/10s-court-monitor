import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, watches, notificationChannels } from "@/lib/schema";
import { eq, count, sql } from "drizzle-orm";

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const user = await db.select().from(users).where(eq(users.email, session.user.email.toLowerCase())).limit(1);
    if (!user[0] || !user[0].isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const adminUser = await db.select().from(users).where(eq(users.email, session.user.email.toLowerCase())).limit(1);
    if (!adminUser[0] || !adminUser[0].isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { email, name, isAllowed, isAdmin } = await request.json();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    // Check if user already exists
    const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existingUser.length > 0) {
      return NextResponse.json({ error: "User with this email already exists" }, { status: 400 });
    }

    // Create new user
    const [newUser] = await db.insert(users).values({
      email,
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
