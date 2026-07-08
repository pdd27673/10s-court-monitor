import { NextResponse } from "next/server";
import type { ChannelResponse } from "@pdd27673/10s-contract";
import { Expo } from "expo-server-sdk";
import { db } from "@/lib/db";
import { notificationChannels } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { getAuthedUserId } from "@/lib/mobile-auth";

// Channel types a user may set on their own channels.
const ALLOWED_CHANNEL_TYPES = ["telegram", "email", "expo-push"];

// GET /api/channels/[id] - Get a specific channel
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getAuthedUserId(request);
  if (userId === null) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const channelId = parseInt(id);

  if (isNaN(channelId)) {
    return NextResponse.json({ error: "Invalid channel ID" }, { status: 400 });
  }

  const channel = await db.query.notificationChannels.findFirst({
    where: and(
      eq(notificationChannels.id, channelId),
      eq(notificationChannels.userId, userId)
    ),
  });

  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  const response: ChannelResponse = {
    channel: {
      id: channel.id,
      type: channel.type,
      destination: channel.destination,
      active: Boolean(channel.active),
    },
  };
  return NextResponse.json(response);
}

// PUT /api/channels/[id] - Update a channel
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getAuthedUserId(request);
  if (userId === null) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const channelId = parseInt(id);

  if (isNaN(channelId)) {
    return NextResponse.json({ error: "Invalid channel ID" }, { status: 400 });
  }

  // Verify channel belongs to user
  const existingChannel = await db.query.notificationChannels.findFirst({
    where: and(
      eq(notificationChannels.id, channelId),
      eq(notificationChannels.userId, userId)
    ),
  });

  if (!existingChannel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  const body = await request.json();
  const { type, destination, active } = body;

  const updateData: {
    type?: string;
    destination?: string;
    active?: number;
  } = {};

  if (type !== undefined) {
    if (!ALLOWED_CHANNEL_TYPES.includes(type)) {
      return NextResponse.json(
        { error: "type must be telegram, email, or expo-push." },
        { status: 400 }
      );
    }
    updateData.type = type;
  }

  if (destination !== undefined) {
    if (!destination || destination.trim() === "") {
      return NextResponse.json(
        { error: "destination is required" },
        { status: 400 }
      );
    }
    updateData.destination = destination.trim();
  }

  // If the resulting channel is a push channel, its destination must be a valid token.
  const effectiveType = updateData.type ?? existingChannel.type;
  const effectiveDestination = updateData.destination ?? existingChannel.destination;
  if (effectiveType === "expo-push" && !Expo.isExpoPushToken(effectiveDestination)) {
    return NextResponse.json(
      { error: "destination must be a valid Expo push token (ExponentPushToken[...])." },
      { status: 400 }
    );
  }

  if (active !== undefined) {
    updateData.active = active ? 1 : 0;
  }

  const updatedChannels = await db
    .update(notificationChannels)
    .set(updateData)
    .where(
      and(
        eq(notificationChannels.id, channelId),
        eq(notificationChannels.userId, userId)
      )
    )
    .returning();

  // Defensive check: ensure update actually affected a row
  if (!updatedChannels || updatedChannels.length === 0) {
    return NextResponse.json(
      { error: "Channel not found or access denied" },
      { status: 404 }
    );
  }

  const updatedChannel = updatedChannels[0];

  const response: ChannelResponse = {
    channel: {
      id: updatedChannel.id,
      type: updatedChannel.type,
      destination: updatedChannel.destination,
      active: Boolean(updatedChannel.active),
    },
  };
  return NextResponse.json(response);
}

// DELETE /api/channels/[id] - Delete a channel
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getAuthedUserId(request);
  if (userId === null) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const channelId = parseInt(id);

  if (isNaN(channelId)) {
    return NextResponse.json({ error: "Invalid channel ID" }, { status: 400 });
  }

  // Verify channel belongs to user
  const existingChannel = await db.query.notificationChannels.findFirst({
    where: and(
      eq(notificationChannels.id, channelId),
      eq(notificationChannels.userId, userId)
    ),
  });

  if (!existingChannel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  const deletedChannels = await db
    .delete(notificationChannels)
    .where(
      and(
        eq(notificationChannels.id, channelId),
        eq(notificationChannels.userId, userId)
      )
    )
    .returning();

  // Defensive check: ensure delete actually affected a row
  if (!deletedChannels || deletedChannels.length === 0) {
    return NextResponse.json(
      { error: "Channel not found or access denied" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true });
}

// PATCH /api/channels/[id] - Toggle active status
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getAuthedUserId(request);
  if (userId === null) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const channelId = parseInt(id);

  if (isNaN(channelId)) {
    return NextResponse.json({ error: "Invalid channel ID" }, { status: 400 });
  }

  const body = await request.json();
  const { active } = body;

  if (typeof active !== "boolean") {
    return NextResponse.json(
      { error: "active must be a boolean" },
      { status: 400 }
    );
  }

  // Verify channel belongs to user
  const existingChannel = await db.query.notificationChannels.findFirst({
    where: and(
      eq(notificationChannels.id, channelId),
      eq(notificationChannels.userId, userId)
    ),
  });

  if (!existingChannel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }

  const updatedChannels = await db
    .update(notificationChannels)
    .set({ active: active ? 1 : 0 })
    .where(
      and(
        eq(notificationChannels.id, channelId),
        eq(notificationChannels.userId, userId)
      )
    )
    .returning();

  // Defensive check: ensure update actually affected a row
  if (!updatedChannels || updatedChannels.length === 0) {
    return NextResponse.json(
      { error: "Channel not found or access denied" },
      { status: 404 }
    );
  }

  const updatedChannel = updatedChannels[0];

  const response: ChannelResponse = {
    channel: {
      id: updatedChannel.id,
      type: updatedChannel.type,
      destination: updatedChannel.destination,
      active: Boolean(updatedChannel.active),
    },
  };
  return NextResponse.json(response);
}
