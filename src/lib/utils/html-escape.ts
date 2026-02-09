/**
 * Escapes HTML special characters to prevent XSS attacks
 * @param text - The text to escape
 * @returns HTML-safe string
 */
export function escapeHtml(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Escapes text for use in Telegram HTML messages
 * Telegram uses a subset of HTML tags and requires escaping
 * @param text - The text to escape
 * @returns Telegram HTML-safe string
 */
export function escapeTelegramHtml(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
