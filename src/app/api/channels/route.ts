import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notificationChannels } from "@/lib/schema";
import { eq } from "drizzle-orm";

// GET /api/channels - List all notification channels
export async function GET() {
  const channels = await db.query.notificationChannels.findMany();

  return NextResponse.json({
    channels: channels.map((c) => ({
      id: c.id,
      userId: c.userId,
      type: c.type,
      destination: c.destination,
      active: Boolean(c.active),
    })),
  });
}

// POST /api/channels - Create a new notification channel
export async function POST(request: Request) {
  const body = await request.json();
  const { userId, type, destination } = body;

  if (!userId || !type || !destination) {
    return NextResponse.json(
      { error: "userId, type, and destination are required" },
      { status: 400 }
    );
  }

  if (!["telegram", "email", "whatsapp"].includes(type)) {
    return NextResponse.json(
      { error: "type must be telegram, email, or whatsapp" },
      { status: 400 }
    );
  }

  const [channel] = await db
    .insert(notificationChannels)
    .values({
      userId,
      type,
      destination,
      active: 1,
    })
    .returning();

  return NextResponse.json({ channel });
}
