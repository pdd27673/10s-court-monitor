import { SignJWT, jwtVerify } from "jose";

// Long-lived bearer tokens for the mobile app. Signed with the same AUTH_SECRET
// NextAuth uses, but they are a distinct token type ("mobile") verified here —
// they are NOT NextAuth session cookies.
const MOBILE_TOKEN_TTL = "60d";
const MOBILE_TOKEN_AUDIENCE = "mobile";

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set — cannot sign/verify mobile tokens");
  }
  return new TextEncoder().encode(secret);
}

/** Mint a long-lived bearer JWT for a user id (used by the Expo app). */
export async function signMobileToken(userId: number): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setAudience(MOBILE_TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(MOBILE_TOKEN_TTL)
    .sign(getSecretKey());
}

/** Verify a mobile bearer JWT. Returns the user id, or null if invalid/expired. */
export async function verifyMobileToken(token: string): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      audience: MOBILE_TOKEN_AUDIENCE,
    });
    const userId =
      typeof payload.userId === "number"
        ? payload.userId
        : parseInt(String(payload.userId), 10);
    return Number.isNaN(userId) ? null : userId;
  } catch {
    return null;
  }
}
