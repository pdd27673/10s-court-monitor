import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { registrationRequests } from "@/lib/schema";

export async function GET() {
  try {
    const gate = await requireAdmin();
    if ("error" in gate) return gate.error;

    // Get all registration requests
    const requests = await db.select().from(registrationRequests);

    return NextResponse.json({ requests });
  } catch (error) {
    console.error("Error fetching registration requests:", error);
    return NextResponse.json({ error: "Failed to fetch requests" }, { status: 500 });
  }
}
