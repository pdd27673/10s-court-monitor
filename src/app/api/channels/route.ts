import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notificationChannels } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { parseSessionUserId } from "@/lib/utils/fetch-helpers";

// GET /api/channels - List user's notification channels
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseSessionUserId(session);
    const channels = await db.query.notificationChannels.findMany({
      where: eq(notificationChannels.userId, userId),
    });

    return NextResponse.json({
      channels: channels.map((c) => ({
        id: c.id,
        type: c.type,
        destination: c.destination,
        active: Boolean(c.active),
      })),
    });
  } catch (error: any) {
    console.error("Error fetching channels:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch channels" },
      { status: 500 }
    );
  }
}

// POST /api/channels - Create a new notification channel
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseSessionUserId(session);
    const body = await request.json();
    const { type, destination } = body;

  if (!type || !destination) {
    return NextResponse.json(
      { error: "type and destination are required" },
      { status: 400 }
    );
  }

  // Validate destination is a string type
  if (typeof destination !== "string") {
    return NextResponse.json(
      { error: "destination must be a string" },
      { status: 400 }
    );
  }

  // Validate destination: must be non-empty after trimming whitespace
  const trimmedDestination = destination.trim();
  if (trimmedDestination === "") {
    return NextResponse.json(
      { error: "destination cannot be empty or whitespace-only" },
      { status: 400 }
    );
  }

  // Only allow telegram and email (whatsapp not yet implemented)
  if (!["telegram", "email"].includes(type)) {
    return NextResponse.json(
      { error: "type must be telegram or email. WhatsApp support is not yet available." },
      { status: 400 }
    );
  }

  const [channel] = await db
    .insert(notificationChannels)
    .values({
      userId,
      type,
      destination: trimmedDestination,
      active: 1,
    })
    .returning();

    // Filter response to only safe fields (same as GET endpoint)
    return NextResponse.json({
      channel: {
        id: channel.id,
        type: channel.type,
        destination: channel.destination,
        active: Boolean(channel.active),
      },
    });
  } catch (error: any) {
    console.error("Error creating channel:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create channel" },
      { status: 500 }
    );
  }
}
