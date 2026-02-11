import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { proxyManager } from "@/lib/proxy-manager";

export async function GET() {
  try {
    // Test database connection
    const result = db.get<{ ok: number }>(sql`SELECT 1 as ok`);
    const proxyStats = proxyManager.getStats();

    return NextResponse.json({
      status: "healthy",
      database: result?.ok === 1 ? "connected" : "error",
      proxy: {
        configured: proxyStats.configured,
        totalRequests: proxyStats.totalRequests,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "unhealthy",
        database: "error",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
