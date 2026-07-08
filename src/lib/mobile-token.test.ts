import { describe, it, expect, beforeEach } from "vitest";
import { signMobileToken, verifyMobileToken } from "./mobile-token";

describe("mobile-token", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-for-mobile-tokens";
  });

  it("signs a token that verifies back to the same user id", async () => {
    const token = await signMobileToken(42);
    expect(typeof token).toBe("string");
    expect(await verifyMobileToken(token)).toBe(42);
  });

  it("rejects a garbage token", async () => {
    expect(await verifyMobileToken("not-a-jwt")).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signMobileToken(7);
    process.env.AUTH_SECRET = "a-completely-different-secret";
    expect(await verifyMobileToken(token)).toBeNull();
  });

  it("rejects a NextAuth-style token without the mobile audience", async () => {
    // A token minted for a different audience must not authenticate the app.
    const { SignJWT } = await import("jose");
    const key = new TextEncoder().encode(process.env.AUTH_SECRET);
    const wrongAudienceToken = await new SignJWT({ userId: 1 })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("some-other-audience")
      .setExpirationTime("60d")
      .sign(key);
    expect(await verifyMobileToken(wrongAudienceToken)).toBeNull();
  });
});
