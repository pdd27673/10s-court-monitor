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
