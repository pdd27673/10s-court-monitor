/**
 * Helper to handle API responses with proper error checking
 * @param response - Fetch response
 * @returns Parsed JSON data
 * @throws Error if response is not ok
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleApiResponse<T = any>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorMessage = `API Error: ${response.status} ${response.statusText}`;
    try {
      const errorData = await response.json();
      if (errorData.error) {
        errorMessage = errorData.error;
      }
    } catch {
      // If response body isn't JSON, use status text
    }
    throw new Error(errorMessage);
  }
  return response.json();
}

/**
 * Safely parse session user ID to number
 * @param session - NextAuth session
 * @returns Parsed user ID
 * @throws Error if session is invalid or user ID is NaN
 */
export function parseSessionUserId(session: { user?: { id?: string | number } } | null | undefined): number {
  if (!session?.user?.id) {
    throw new Error("Invalid session");
  }
  const userId = typeof session.user.id === 'number' ? session.user.id : parseInt(session.user.id, 10);
  if (isNaN(userId)) {
    throw new Error("Invalid user session");
  }
  return userId;
}
