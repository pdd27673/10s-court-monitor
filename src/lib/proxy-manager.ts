import { HttpsProxyAgent } from "https-proxy-agent";
import got from "got";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

class ProxyManager {
  private host: string | null = null;
  private port: string | null = null;
  private username: string | null = null;
  private password: string | null = null;
  private requestCount = 0;
  private sessionCount = 0;
  private totalBytes = 0;
  private initialized = false;

  initialize() {
    if (this.initialized) return;
    this.initialized = true;

    this.host = process.env.WEBSHARE_PROXY_HOST || null;
    this.port = process.env.WEBSHARE_PROXY_PORT || "80";
    this.username = process.env.WEBSHARE_USERNAME || null;
    this.password = process.env.WEBSHARE_PASSWORD || null;

    console.log(`🔧 Proxy config:`);
    console.log(`   Host: ${this.host || "(not set)"}`);
    console.log(`   Port: ${this.port}`);
    console.log(`   Username: ${this.username ? `${this.username.slice(0, 8)}...` : "(not set)"}`);
    console.log(`   Password: ${this.password ? "***" : "(not set)"}`);

    if (!this.host || !this.username || !this.password) {
      console.warn("⚠️  Proxy not configured - requests will use direct connection");
      return;
    }

    console.log(`✅ Rotating residential proxy ready: ${this.host}:${this.port}`);
  }

  getAgent(): HttpsProxyAgent<string> | null {
    if (!this.initialized) {
      this.initialize();
    }

    if (!this.host || !this.username || !this.password) {
      return null;
    }

    this.requestCount++;
    const proxyUrl = `http://${this.username}:${this.password}@${this.host}:${this.port}`;
    return new HttpsProxyAgent(proxyUrl);
  }

  createStickySession(): { agent: HttpsProxyAgent<string>; sessionId: string } | null {
    if (!this.initialized) {
      this.initialize();
    }

    if (!this.host || !this.username || !this.password) {
      return null;
    }

    this.sessionCount++;
    this.requestCount++;

    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const stickyUsername = `${this.username}-session-${sessionId}`;
    const proxyUrl = `http://${stickyUsername}:${this.password}@${this.host}:${this.port}`;

    console.log(`🔗 Sticky session #${this.sessionCount} (${sessionId.slice(-6)})`);

    return {
      agent: new HttpsProxyAgent(proxyUrl),
      sessionId,
    };
  }

  trackBytes(bytes: number) {
    this.totalBytes += bytes;
  }

  resetStats() {
    this.requestCount = 0;
    this.sessionCount = 0;
    this.totalBytes = 0;
  }

  getStats() {
    if (!this.initialized) {
      this.initialize();
    }
    return {
      configured: !!(this.host && this.username && this.password),
      initialized: this.initialized,
      totalRequests: this.requestCount,
      totalSessions: this.sessionCount,
      totalBytes: this.totalBytes,
    };
  }

  async testConnection(): Promise<{ success: boolean; ip?: string; error?: string; direct?: string }> {
    if (!this.initialized) {
      this.initialize();
    }

    try {
      console.log(`🧪 Testing direct connection...`);
      const directResponse = await got("https://api.ipify.org?format=json", {
        headers: { "User-Agent": "curl/7.88.1" },
        timeout: { request: 10000 },
      }).json<{ ip: string }>();
      console.log(`   Direct IP: ${directResponse.ip}`);

      const agent = this.getAgent();
      if (!agent) {
        return { success: false, error: "Proxy not configured", direct: directResponse.ip };
      }

      console.log(`🧪 Testing proxy connection...`);
      const proxyResponse = await got("https://api.ipify.org?format=json", {
        agent: { https: agent },
        headers: { "User-Agent": "curl/7.88.1" },
        timeout: { request: 15000 },
      }).json<{ ip: string }>();
      console.log(`   Proxy IP: ${proxyResponse.ip}`);

      const success = directResponse.ip !== proxyResponse.ip;
      console.log(success ? `✅ Proxy working! IPs differ.` : `❌ Proxy NOT working! Same IP.`);

      return { success, ip: proxyResponse.ip, direct: directResponse.ip };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`❌ Proxy test failed: ${msg}`);
      return { success: false, error: msg };
    }
  }
}

export const proxyManager = new ProxyManager();

/**
 * Proxy-aware fetch using got
 */
export async function proxyFetch(
  url: string,
  options: {
    agent?: HttpsProxyAgent<string> | null;
    headers?: Record<string, string>;
    method?: "GET" | "POST";
    body?: string;
    timeout?: number;
  } = {}
): Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get: (name: string) => string | null };
  text: () => Promise<string>;
  json: () => Promise<unknown>;
  body: string;
}> {
  const response = await got(url, {
    method: options.method || "GET",
    headers: options.headers || {},
    body: options.body,
    timeout: { request: options.timeout || 30000 },
    throwHttpErrors: false,
    retry: { limit: 0 },
    agent: options.agent ? { https: options.agent, http: options.agent } : undefined,
  });

  // Track bytes for bandwidth monitoring
  proxyManager.trackBytes(response.body.length);

  return {
    ok: response.statusCode >= 200 && response.statusCode < 300,
    status: response.statusCode,
    statusText: response.statusMessage || "",
    headers: {
      get: (name: string) => {
        const val = response.headers[name.toLowerCase()];
        return Array.isArray(val) ? val[0] : val || null;
      },
    },
    text: async () => response.body,
    json: async () => JSON.parse(response.body),
    body: response.body,
  };
}
