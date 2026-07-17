import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { cleanupOldData } from "@/lib/cleanup";

export async function POST(request: Request) {
  try {
    const gate = await requireAdmin();
    if ("error" in gate) return gate.error;

    const body = await request.json();
    const days = body.days !== undefined ? body.days : 7;

    // Validate days parameter
    if (typeof days !== 'number' || days < 1 || days > 365) {
      return NextResponse.json(
        { error: "Invalid days parameter: must be a number between 1 and 365" },
        { status: 400 }
      );
    }

    const result = await cleanupOldData(days);

    return NextResponse.json({
      success: true,
      deletedSlots: result.deletedSlots,
      deletedLogs: result.deletedLogs,
    });
  } catch (error) {
    console.error("Error running cleanup:", error);
    return NextResponse.json({ error: "Failed to run cleanup" }, { status: 500 });
  }
}
