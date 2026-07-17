import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireAdmin();
    if ("error" in gate) return gate.error;
    const adminUser = gate.admin;

    const { id } = await params;
    const userId = parseInt(id, 10);

    if (isNaN(userId)) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    const body = await request.json();
    const { name, isAllowed, isAdmin } = body;

    // Prevent admin from demoting themselves
    if (userId === adminUser.id && isAdmin === false) {
      return NextResponse.json(
        { error: "Cannot remove your own admin privileges" },
        { status: 403 }
      );
    }

    // Update user
    const [updatedUser] = await db
      .update(users)
      .set({
        name: name !== undefined ? name : undefined,
        isAllowed: isAllowed !== undefined ? (isAllowed ? 1 : 0) : undefined,
        isAdmin: isAdmin !== undefined ? (isAdmin ? 1 : 0) : undefined,
      })
      .where(eq(users.id, userId))
      .returning();

    if (!updatedUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ user: updatedUser });
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireAdmin();
    if ("error" in gate) return gate.error;
    const adminUser = gate.admin;

    const { id } = await params;
    const userId = parseInt(id, 10);

    if (isNaN(userId)) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    // Prevent admin from deleting themselves
    if (userId === adminUser.id) {
      return NextResponse.json(
        { error: "Cannot delete your own account" },
        { status: 403 }
      );
    }

    // Delete user's data (cascade deletes will handle related records due to schema)
    await db.delete(users).where(eq(users.id, userId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting user:", error);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
