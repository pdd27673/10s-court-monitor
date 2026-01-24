import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notificationChannels } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";

// GET /api/channels - List user's notification channels
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);
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
}

// POST /api/channels - Create a new notification channel
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);
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
}
