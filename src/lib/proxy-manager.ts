import { HttpsProxyAgent } from "https-proxy-agent";

class ProxyManager {
  private host: string | null = null;
  private port: string | null = null;
  private username: string | null = null;
  private password: string | null = null;
  private requestCount = 0;
  private sessionCount = 0;
  private initialized = false;

  initialize() {
    if (this.initialized) return;
    this.initialized = true;

    this.host = process.env.WEBSHARE_PROXY_HOST || null;
    this.port = process.env.WEBSHARE_PROXY_PORT || "80";
    this.username = process.env.WEBSHARE_USERNAME || null;
    this.password = process.env.WEBSHARE_PASSWORD || null;

    if (!this.host || !this.username || !this.password) {
      console.warn(
        "⚠️  Proxy not configured - requests will use direct connection"
      );
      return;
    }

    console.log(`✅ Rotating residential proxy initialized: ${this.host}:${this.port}`);
  }

  /**
   * Get a new rotating proxy agent (new IP for each call)
   */
  getAgent(): HttpsProxyAgent<string> | null {
    if (!this.initialized) {
      this.initialize();
    }

    if (!this.host || !this.username || !this.password) {
      return null;
    }

    this.requestCount++;
    console.log(`🔄 Proxy request #${this.requestCount} (new residential IP)`);

    // Each call creates a new agent, getting a new IP from the rotating pool
    const proxyUrl = `http://${this.username}:${this.password}@${this.host}:${this.port}`;
    return new HttpsProxyAgent(proxyUrl);
  }

  /**
   * Get a sticky session agent - same IP for multiple requests
   * Returns a session object with the agent and session ID
   */
  createStickySession(): { agent: HttpsProxyAgent<string>; sessionId: string } | null {
    if (!this.initialized) {
      this.initialize();
    }

    if (!this.host || !this.username || !this.password) {
      return null;
    }

    this.sessionCount++;
    this.requestCount++;

    // Generate unique session ID
    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // For Webshare, append session ID to username for sticky sessions
    // Format: username-session-SESSIONID
    const stickyUsername = `${this.username}-session-${sessionId}`;
    const proxyUrl = `http://${stickyUsername}:${this.password}@${this.host}:${this.port}`;

    console.log(`🔗 Sticky session #${this.sessionCount} created (session: ${sessionId.slice(-6)})`);

    return {
      agent: new HttpsProxyAgent(proxyUrl),
      sessionId,
    };
  }

  getStats() {
    return {
      configured: !!(this.host && this.username && this.password),
      initialized: this.initialized,
      totalRequests: this.requestCount,
      totalSessions: this.sessionCount,
    };
  }
}

export const proxyManager = new ProxyManager();
