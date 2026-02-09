/**
 * Helper to handle API responses with proper error checking
 * @param response - Fetch response
 * @returns Parsed JSON data
 * @throws Error if response is not ok
 */
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
 * Safely parse an ID string to a number, throwing 400 if invalid
 * @param idString - The ID string to parse
 * @param paramName - Name of the parameter for error message
 * @returns Parsed number
 * @throws NextResponse with 400 if NaN
 */
export function parseIdParam(idString: string, paramName: string = "id"): number {
  const id = parseInt(idString, 10);
  if (isNaN(id)) {
    throw new Error(`Invalid ${paramName}: must be a number`);
  }
  return id;
}

/**
 * Safely parse session user ID to number
 * @param session - NextAuth session
 * @returns Parsed user ID
 * @throws Error if session is invalid or user ID is NaN
 */
export function parseSessionUserId(session: any): number {
  if (!session?.user?.id) {
    throw new Error("Invalid session");
  }
  const userId = parseInt(session.user.id, 10);
  if (isNaN(userId)) {
    throw new Error("Invalid user session");
  }
  return userId;
}
