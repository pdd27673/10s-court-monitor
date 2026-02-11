import { HttpsProxyAgent } from "https-proxy-agent";

class ProxyManager {
  private agent: HttpsProxyAgent<string> | null = null;
  private requestCount = 0;
  private initialized = false;

  initialize() {
    if (this.initialized) return;
    this.initialized = true;

    const host = process.env.WEBSHARE_PROXY_HOST;
    const port = process.env.WEBSHARE_PROXY_PORT;
    const username = process.env.WEBSHARE_USERNAME;
    const password = process.env.WEBSHARE_PASSWORD;

    if (!host || !username || !password) {
      console.warn(
        "⚠️  Proxy not configured - requests will use direct connection"
      );
      return;
    }

    const proxyUrl = `http://${username}:${password}@${host}:${port || 80}`;
    this.agent = new HttpsProxyAgent(proxyUrl);
    console.log(`✅ Rotating residential proxy initialized: ${host}:${port}`);
  }

  getAgent(): HttpsProxyAgent<string> | null {
    // Auto-initialize on first use
    if (!this.initialized) {
      this.initialize();
    }

    if (this.agent) {
      this.requestCount++;
      console.log(`🔄 Proxy request #${this.requestCount} (new residential IP)`);
    }
    return this.agent;
  }

  getStats() {
    return {
      configured: !!this.agent,
      initialized: this.initialized,
      totalRequests: this.requestCount,
    };
  }
}

export const proxyManager = new ProxyManager();
