import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { registrationRequests, users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { sendEmail } from "@/lib/notifiers/email";
import { escapeHtml } from "@/lib/utils/html-escape";

// Simple rate limiting using in-memory store (for production, use Redis or similar)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const limit = rateLimitStore.get(ip);

  if (!limit || now > limit.resetAt) {
    // Reset or create new limit (3 requests per hour)
    rateLimitStore.set(ip, {
      count: 1,
      resetAt: now + 60 * 60 * 1000, // 1 hour
    });
    return false;
  }

  if (limit.count >= 3) {
    return true;
  }

  limit.count++;
  return false;
}

export async function POST(request: Request) {
  try {
    // Get IP for rate limiting
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";

    // Check rate limit
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: "Too many registration requests. Please try again later." },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { email, name, reason } = body;

    // Validate input
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
    }

    if (!reason || reason.trim().length < 10) {
      return NextResponse.json(
        { error: "Please provide a reason (at least 10 characters)" },
        { status: 400 }
      );
    }

    // Normalize email to lowercase for case-insensitive comparison
    const normalizedEmail = email.toLowerCase();

    // Check if user already exists
    const existingUser = await db.select().from(users).where(eq(users.email, normalizedEmail));
    if (existingUser.length > 0) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 400 }
      );
    }

    // Check if there's already a pending request for this email
    const existingRequest = await db
      .select()
      .from(registrationRequests)
      .where(eq(registrationRequests.email, normalizedEmail));

    const pendingRequest = existingRequest.find((r) => r.status === "pending");
    if (pendingRequest) {
      return NextResponse.json(
        { error: "A registration request for this email is already pending review" },
        { status: 400 }
      );
    }

    // Create registration request
    const [newRequest] = await db
      .insert(registrationRequests)
      .values({
        email: normalizedEmail,
        name: name || null,
        reason: reason.trim(),
        status: "pending",
      })
      .returning();

    // Send notification to admins
    try {
      const admins = await db
        .select()
        .from(users)
        .where(eq(users.isAdmin, 1));

      const adminEmail = admins[0]?.email || process.env.ADMIN_EMAIL;

      if (adminEmail) {
        await sendEmail(
          adminEmail,
          "New Registration Request - Time for Tennis",
          `
            <h2>New Registration Request</h2>
            <p>A new user has requested access to Time for Tennis:</p>
            <ul>
              <li><strong>Email:</strong> ${escapeHtml(normalizedEmail)}</li>
              <li><strong>Name:</strong> ${escapeHtml(name) || "Not provided"}</li>
              <li><strong>Reason:</strong> ${escapeHtml(reason)}</li>
            </ul>
            <p>
              <a href="${process.env.NEXTAUTH_URL}/admin/requests" style="display: inline-block; padding: 10px 20px; background-color: #16a34a; color: white; text-decoration: none; border-radius: 5px;">
                Review Request
              </a>
            </p>
          `
        );
      }
    } catch (emailError) {
      console.error("Failed to send admin notification:", emailError);
      // Don't fail the request if email fails
    }

    return NextResponse.json({
      success: true,
      message: "Your registration request has been submitted for review",
      requestId: newRequest.id,
    });
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Failed to process registration request" },
      { status: 500 }
    );
  }
}
