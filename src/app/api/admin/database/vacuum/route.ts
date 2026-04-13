import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";

export async function POST() {
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

    // Run VACUUM to optimize the database
    await db.run(sql`VACUUM`);

    return NextResponse.json({ success: true, message: "Database vacuumed successfully" });
  } catch (error) {
    console.error("Error vacuuming database:", error);
    return NextResponse.json({ error: "Failed to vacuum database" }, { status: 500 });
  }
}
