import { db } from "../src/lib/db";
import { users, registrationRequests } from "../src/lib/schema";
import { eq } from "drizzle-orm";

async function normalizeEmails() {
  console.log("🔄 Normalizing emails to lowercase...\n");

  try {
    // Get all users
    const allUsers = await db.select().from(users);
    console.log(`Found ${allUsers.length} users`);

    let usersUpdated = 0;
    for (const user of allUsers) {
      const normalizedEmail = user.email.toLowerCase();
      if (user.email !== normalizedEmail) {
        await db
          .update(users)
          .set({ email: normalizedEmail })
          .where(eq(users.id, user.id));
        console.log(`✓ Updated user: ${user.email} → ${normalizedEmail}`);
        usersUpdated++;
      }
    }

    // Get all registration requests
    const allRequests = await db.select().from(registrationRequests);
    console.log(`\nFound ${allRequests.length} registration requests`);

    let requestsUpdated = 0;
    for (const request of allRequests) {
      const normalizedEmail = request.email.toLowerCase();
      if (request.email !== normalizedEmail) {
        await db
          .update(registrationRequests)
          .set({ email: normalizedEmail })
          .where(eq(registrationRequests.id, request.id));
        console.log(`✓ Updated request: ${request.email} → ${normalizedEmail}`);
        requestsUpdated++;
      }
    }

    console.log(`\n✅ Done!`);
    console.log(`   - Users updated: ${usersUpdated}/${allUsers.length}`);
    console.log(`   - Requests updated: ${requestsUpdated}/${allRequests.length}`);
  } catch (error) {
    console.error("❌ Error normalizing emails:", error);
    process.exit(1);
  }
}

normalizeEmails();
