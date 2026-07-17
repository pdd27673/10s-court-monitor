import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";

export type AdminUser = typeof users.$inferSelect;

/**
 * Shared gate for /api/admin/* routes. Returns the admin row or a ready-to-
 * return 401/403 response so handlers don't re-copy the auth/isAdmin check.
 */
export async function requireAdmin(): Promise<
  { admin: AdminUser } | { error: NextResponse }
> {
  const session = await auth();
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email.toLowerCase()))
    .limit(1);

  if (!user?.isAdmin) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { admin: user };
}
