import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { verificationTokens } from "@/lib/schema";
import { findOrCreateAllowedUser } from "@/lib/users";
import { sendEmail } from "@/lib/notifiers/email";
import { escapeHtml } from "@/lib/utils/html-escape";

// Short-lived token used only to exchange for a long-lived mobile bearer JWT.
const TOKEN_TTL_MS = 20 * 60 * 1000; // 20 minutes

// Simple in-memory IP rate limit (mirrors /api/register). For multi-instance
// production, back this with Redis.
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const limit = rateLimitStore.get(ip);
  if (!limit || now > limit.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return false;
  }
  if (limit.count >= 5) return true;
  limit.count++;
  return false;
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.AUTH_URL ||
    "http://localhost:3000"
  );
}

/**
 * POST /api/auth/mobile/start  { email, name? }
 *
 * Open signup: provisions the user if new, then emails a universal-link that
 * deep-links into the Expo app carrying a one-time token. The app calls
 * /api/auth/mobile/verify with that token to obtain a bearer JWT.
 *
 * Always returns a generic 200 so the endpoint can't be used to enumerate
 * which emails exist or are blocked.
 */
export async function POST(request: Request) {
  try {
    const ip =
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "unknown";
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { email, name } = body ?? {};
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json(
        { error: "Valid email is required" },
        { status: 400 }
      );
    }

    const normalized = email.toLowerCase().trim();
    const user = await findOrCreateAllowedUser(normalized, name);

    // Blocked users get the same generic response but no email / token.
    if (!user.isAllowed) {
      return NextResponse.json({ ok: true });
    }

    const token = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
    await db.insert(verificationTokens).values({
      identifier: normalized,
      token,
      expires,
    });

    const link = `${appBaseUrl()}/m/auth?token=${encodeURIComponent(
      token
    )}&email=${encodeURIComponent(normalized)}`;

    await sendEmail(
      normalized,
      "Sign in to Time for Tennis",
      `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
          <h2>Sign in to Time for Tennis</h2>
          <p>Tap the button below on your phone to sign in to the app:</p>
          <a href="${escapeHtml(link)}" style="display: inline-block; background: #22c55e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">
            Open the app &amp; sign in
          </a>
          <p style="color: #666; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
          <p style="color: #666; font-size: 12px;">This link expires in 20 minutes.</p>
        </div>
      `
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error in mobile auth start:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start sign-in" },
      { status: 500 }
    );
  }
}
