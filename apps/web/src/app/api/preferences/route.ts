import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users, userVenuePreferences, userNotificationPreferences, venues } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

// Validation schema for preferences
const preferencesSchema = z.object({
  notificationPreferences: z.object({
    emailEnabled: z.boolean(),
    smsEnabled: z.boolean(),
    quietHoursStart: z.number().min(0).max(23),
    quietHoursEnd: z.number().min(0).max(23),
    maxNotificationsPerDay: z.number().min(1).max(100),
    notificationCooldownMinutes: z.number().min(1).max(1440), // Max 24 hours
  }),
  venuePreferences: z.array(
    z.object({
      venueId: z.string(),
      preferredDays: z.array(z.number().min(1).max(7)),
      preferredTimeStart: z.number().min(0).max(23),
      preferredTimeEnd: z.number().min(0).max(23),
      maxPricePerHour: z.number().optional(),
    })
  ),
});

// GET /api/preferences - Fetch user's current preferences
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Find user in database
    const db = getDb();
    const dbUsers = await db.select().from(users).where(eq(users.clerkId, user.id)).limit(1);
    const dbUser = dbUsers[0];

    if (!dbUser) {
      // User not found - they might be a new user, create them first
      const newUserId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      await db.insert(users).values({
        id: newUserId,
        clerkId: user.id,
        email: user.emailAddresses[0]?.emailAddress || '',
        status: "active",
      });

      // Return default preferences for new user
      const allVenues = await db.select().from(venues).where(eq(venues.isActive, true));
      return NextResponse.json({
        notificationPreferences: {
          emailEnabled: true,
          smsEnabled: false,
          quietHoursStart: 22,
          quietHoursEnd: 7,
          maxNotificationsPerDay: 10,
          notificationCooldownMinutes: 30,
        },
        venuePreferences: [],
        availableVenues: allVenues,
      });
    }

    // Fetch notification preferences
    const notificationPrefs = await db
      .select()
      .from(userNotificationPreferences)
      .where(eq(userNotificationPreferences.userId, dbUser.id))
      .limit(1);

    // Fetch venue preferences
    const venuePrefs = await db
      .select()
      .from(userVenuePreferences)
      .where(eq(userVenuePreferences.userId, dbUser.id));

    // Fetch all available venues
    const allVenues = await db.select().from(venues).where(eq(venues.isActive, true));

    return NextResponse.json({
      notificationPreferences: notificationPrefs[0] || {
        emailEnabled: true,
        smsEnabled: false,
        quietHoursStart: 22,
        quietHoursEnd: 7,
        maxNotificationsPerDay: 10,
        notificationCooldownMinutes: 30,
      },
      venuePreferences: venuePrefs || [],
      availableVenues: allVenues,
    });
  } catch (error) {
    console.error("Error fetching preferences:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST /api/preferences - Save user preferences
export async function POST(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    // Validate request body
    const validation = preferencesSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request data", details: validation.error.issues },
        { status: 400 }
      );
    }

    const { notificationPreferences, venuePreferences } = validation.data;

    // Find user in database
    const db = getDb();
    const dbUsers = await db.select().from(users).where(eq(users.clerkId, user.id)).limit(1);
    const dbUser = dbUsers[0];

    if (!dbUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Validate preferred times
    for (const venuePref of venuePreferences) {
      if (venuePref.preferredTimeStart >= venuePref.preferredTimeEnd) {
        return NextResponse.json(
          { error: "Preferred start time must be before end time" },
          { status: 400 }
        );
      }
    }

    // Upsert notification preferences
    const existingNotificationPrefs = await db
      .select()
      .from(userNotificationPreferences)
      .where(eq(userNotificationPreferences.userId, dbUser.id))
      .limit(1);

    if (existingNotificationPrefs.length > 0) {
      // Update existing
      await db
        .update(userNotificationPreferences)
        .set({
          ...notificationPreferences,
          updatedAt: new Date(),
        })
        .where(eq(userNotificationPreferences.userId, dbUser.id));
    } else {
      // Insert new
      await db.insert(userNotificationPreferences).values({
        userId: dbUser.id,
        ...notificationPreferences,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Delete existing venue preferences
    await db
      .delete(userVenuePreferences)
      .where(eq(userVenuePreferences.userId, dbUser.id));

    // Insert new venue preferences
    if (venuePreferences.length > 0) {
      await db.insert(userVenuePreferences).values(
        venuePreferences.map((pref) => ({
          userId: dbUser.id,
          venueId: pref.venueId,
          preferredDays: pref.preferredDays,
          preferredTimeStart: pref.preferredTimeStart,
          preferredTimeEnd: pref.preferredTimeEnd,
          maxPricePerHour: pref.maxPricePerHour?.toString(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving preferences:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}