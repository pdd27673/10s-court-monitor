import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verificationTokens, users } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { signMobileToken } from "@/lib/mobile-token";

/**
 * POST /api/auth/mobile/verify  { email, token }
 *
 * Consumes the one-time token from the deep link and, if valid + unexpired +
 * the user is allowed, returns a long-lived bearer JWT the Expo app stores in
 * secure storage and sends as Authorization: Bearer on every request.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { email, token } = body ?? {};

    if (!email || typeof email !== "string" || !token || typeof token !== "string") {
      return NextResponse.json(
        { error: "email and token are required" },
        { status: 400 }
      );
    }

    const normalized = email.toLowerCase().trim();

    // Atomically consume the token (delete-returning prevents reuse / races),
    // mirroring the NextAuth adapter's useVerificationToken.
    const consumed = await db
      .delete(verificationTokens)
      .where(
        and(
          eq(verificationTokens.identifier, normalized),
          eq(verificationTokens.token, token)
        )
      )
      .returning();

    if (consumed.length === 0) {
      return NextResponse.json(
        { error: "Invalid or already-used sign-in link" },
        { status: 400 }
      );
    }

    if (new Date(consumed[0].expires).getTime() < Date.now()) {
      return NextResponse.json(
        { error: "Sign-in link has expired. Please request a new one." },
        { status: 400 }
      );
    }

    const user = await db.query.users.findFirst({
      where: eq(users.email, normalized),
    });
    if (!user || !user.isAllowed) {
      return NextResponse.json(
        { error: "This account isn't allowed to sign in." },
        { status: 403 }
      );
    }

    const bearer = await signMobileToken(user.id);

    return NextResponse.json({
      token: bearer,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    console.error("Error in mobile auth verify:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to verify sign-in" },
      { status: 500 }
    );
  }
}
