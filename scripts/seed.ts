import { db } from "../src/lib/db";
import { users, watches, notificationChannels } from "../src/lib/schema";
import { ensureVenuesExist } from "../src/lib/differ";

async function seed() {
  console.log("Seeding database...");

  // Ensure venues exist
  await ensureVenuesExist();
  console.log("✓ Venues created");

  // Create a test user
  const [user] = await db
    .insert(users)
    .values({
      email: "test@example.com",
    })
    .onConflictDoNothing()
    .returning();

  if (user) {
    console.log(`✓ Created user: ${user.email} (ID: ${user.id})`);

    // Create a watch for evening slots on weekdays
    const [watch] = await db
      .insert(watches)
      .values({
        userId: user.id,
        venueId: null, // All venues
        preferredTimes: JSON.stringify(["5pm", "6pm", "7pm", "8pm"]),
        weekdaysOnly: 1,
        weekendsOnly: 0,
        active: 1,
      })
      .returning();
    console.log(`✓ Created watch for evening weekday slots (ID: ${watch.id})`);

    // Create email notification channel
    const [emailChannel] = await db
      .insert(notificationChannels)
      .values({
        userId: user.id,
        type: "email",
        destination: "test@example.com",
        active: 1,
      })
      .returning();
    console.log(`✓ Created email channel (ID: ${emailChannel.id})`);
  } else {
    console.log("User already exists, skipping...");
  }

  console.log("\nDone! Database seeded.");
}

seed().catch(console.error);
