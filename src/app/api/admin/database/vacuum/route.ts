import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export async function POST() {
  try {
    const gate = await requireAdmin();
    if ("error" in gate) return gate.error;

    // ANALYZE updates planner statistics; safer than VACUUM on Railway Postgres
    await db.execute(sql`ANALYZE`);

    return NextResponse.json({ success: true, message: "Database analyzed successfully" });
  } catch (error) {
    console.error("Error analyzing database:", error);
    return NextResponse.json({ error: "Failed to analyze database" }, { status: 500 });
  }
}
