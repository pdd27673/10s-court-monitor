import { NextResponse } from "next/server";
import { runFeedIngest } from "@/lib/ingest/run";

// HTTP trigger for feed-primary ingestion. Since Phase 5 the ingest loop lives in
// the standalone worker (`src/lib/ingest/worker.ts`, its own Railway service); this
// route stays as a manual / fallback trigger an external scheduler can POST. Both
// call the same `runFeedIngest`, so they run identical logic.

// Protect the cron endpoint with a secret (skip in development)
const CRON_SECRET = process.env.CRON_SECRET;
const isDev = process.env.NODE_ENV === "development";

// Prevent overlapping runs within this process (the worker has its own guard).
let isJobRunning = false;

export async function POST(request: Request) {
  // Verify cron secret (deny by default in production)
  if (!isDev) {
    if (!CRON_SECRET) {
      console.error("CRON_SECRET is not configured");
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Check if a job is already running
  if (isJobRunning) {
    return NextResponse.json({ error: "Ingest job already running" }, { status: 409 });
  }

  // Start the ingest in the background (don't await)
  isJobRunning = true;
  runFeedIngest()
    .catch((error) => {
      console.error("Unhandled error in ingest job:", error);
    })
    .finally(() => {
      isJobRunning = false;
    });

  // Return immediately
  return NextResponse.json({ success: true, message: "Feed ingest started" });
}
