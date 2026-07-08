import "server-only";
import { auth } from "./auth";
import { parseSessionUserId } from "./utils/fetch-helpers";
import { verifyMobileToken } from "./mobile-token";

export { signMobileToken, verifyMobileToken } from "./mobile-token";

function getBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Resolve the authenticated user id for an API route, accepting EITHER a
 * NextAuth session cookie (web) OR an Authorization: Bearer mobile token (app).
 * Returns null when neither is present/valid — callers return 401.
 *
 * Cookie is tried first so existing web behaviour is unchanged.
 */
export async function getAuthedUserId(request: Request): Promise<number | null> {
  const session = await auth();
  if (session?.user?.id) {
    try {
      return parseSessionUserId(session);
    } catch {
      // fall through to bearer
    }
  }

  const bearer = getBearerToken(request);
  if (bearer) {
    return verifyMobileToken(bearer);
  }

  return null;
}
