import { db } from "./db";
import { users } from "./schema";
import { eq } from "drizzle-orm";
import type { User } from "./schema";

/**
 * Find a user by email, creating one (open signup) if it doesn't exist.
 *
 * New users are created allowed (isAllowed = 1). `isAllowed` is retained as a
 * ban switch: an admin can set it to 0 to block an existing user, and this
 * helper never re-enables a blocked user — it returns the existing row as-is.
 *
 * Email is normalised to lowercase to match the rest of the auth code.
 */
export async function findOrCreateAllowedUser(
  email: string,
  name?: string | null
): Promise<User> {
  const normalized = email.toLowerCase().trim();

  const existing = await db.query.users.findFirst({
    where: eq(users.email, normalized),
  });
  if (existing) return existing;

  const [created] = await db
    .insert(users)
    .values({
      email: normalized,
      name: name ?? null,
      isAllowed: 1,
    })
    .returning();

  return created;
}
