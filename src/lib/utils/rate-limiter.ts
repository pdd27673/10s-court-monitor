/**
 * Simple rate limiter with delay between requests
 */
export class RateLimiter {
  private lastRequestTime = 0;
  private minDelayMs: number;
  private maxDelayMs: number;

  constructor(minDelayMs = 1000, maxDelayMs = 3000) {
    this.minDelayMs = minDelayMs;
    this.maxDelayMs = maxDelayMs;
  }

  /**
   * Wait for the rate limit delay before allowing the next request
   */
  async wait(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    // Random delay between min and max
    const randomDelay = Math.random() * (this.maxDelayMs - this.minDelayMs) + this.minDelayMs;
    const remainingDelay = Math.max(0, randomDelay - timeSinceLastRequest);

    if (remainingDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, remainingDelay));
    }

    this.lastRequestTime = Date.now();
  }
}

// Singleton instance for the entire app
export const globalRateLimiter = new RateLimiter(2000, 4000); // 2-4 seconds between requests
