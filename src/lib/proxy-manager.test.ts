import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("got", () => ({ default: vi.fn() }));

import got from "got";

const PROXY_ENV = {
  WEBSHARE_PROXY_HOST: "p.webshare.io",
  WEBSHARE_PROXY_PORT: "80",
  WEBSHARE_USERNAME: "user-rotate",
  WEBSHARE_PASSWORD: "secret",
};

/**
 * `proxyManager` is a module singleton that latches its config on first use, so
 * each config permutation needs a fresh module registry rather than a reset
 * method (there isn't one — `resetStats` deliberately leaves `initialized` set).
 */
async function loadWithEnv(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string);
  return import("./proxy-manager");
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(got).mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("proxyManager – configuration", () => {
  it("reports unconfigured and hands back no agent when env is absent", async () => {
    const { proxyManager } = await loadWithEnv({
      WEBSHARE_PROXY_HOST: undefined,
      WEBSHARE_USERNAME: undefined,
      WEBSHARE_PASSWORD: undefined,
    });

    expect(proxyManager.getAgent()).toBeNull();
    expect(proxyManager.getStats().configured).toBe(false);
  });

  it("treats partial credentials as unconfigured", async () => {
    const { proxyManager } = await loadWithEnv({
      ...PROXY_ENV,
      WEBSHARE_PASSWORD: undefined,
    });

    expect(proxyManager.getAgent()).toBeNull();
    expect(proxyManager.getStats().configured).toBe(false);
  });

  it("builds an agent and counts requests when fully configured", async () => {
    const { proxyManager } = await loadWithEnv(PROXY_ENV);

    expect(proxyManager.getAgent()).not.toBeNull();
    expect(proxyManager.getAgent()).not.toBeNull();

    const stats = proxyManager.getStats();
    expect(stats.configured).toBe(true);
    expect(stats.initialized).toBe(true);
    expect(stats.totalRequests).toBe(2);
  });

  it("defaults the port to 80 when unset", async () => {
    const { proxyManager } = await loadWithEnv({
      ...PROXY_ENV,
      WEBSHARE_PROXY_PORT: undefined,
    });

    // Port isn't exposed directly; a working agent proves the default resolved.
    expect(proxyManager.getAgent()).not.toBeNull();
    expect(proxyManager.getStats().configured).toBe(true);
  });

  it("initialises lazily and only once", async () => {
    const { proxyManager } = await loadWithEnv(PROXY_ENV);
    const logSpy = vi.mocked(console.log);

    expect(proxyManager.getStats().initialized).toBe(true);
    const callsAfterFirst = logSpy.mock.calls.length;

    proxyManager.getAgent();
    proxyManager.getStats();

    // No second config banner — initialize() is latched.
    expect(logSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it("warns rather than throwing when the proxy is absent", async () => {
    await loadWithEnv({
      WEBSHARE_PROXY_HOST: undefined,
      WEBSHARE_USERNAME: undefined,
      WEBSHARE_PASSWORD: undefined,
    }).then((m) => m.proxyManager.getStats());

    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
      expect.stringContaining("Proxy not configured")
    );
  });
});

describe("proxyManager – sticky sessions", () => {
  it("returns null when unconfigured", async () => {
    const { proxyManager } = await loadWithEnv({
      WEBSHARE_PROXY_HOST: undefined,
      WEBSHARE_USERNAME: undefined,
      WEBSHARE_PASSWORD: undefined,
    });

    expect(proxyManager.createStickySession()).toBeNull();
  });

  it("issues a distinct session id per call and counts both sessions and requests", async () => {
    const { proxyManager } = await loadWithEnv(PROXY_ENV);

    const a = proxyManager.createStickySession();
    const b = proxyManager.createStickySession();

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.sessionId).not.toBe(b!.sessionId);
    expect(a!.agent).toBeDefined();

    const stats = proxyManager.getStats();
    expect(stats.totalSessions).toBe(2);
    expect(stats.totalRequests).toBe(2);
  });
});

describe("proxyManager – stats", () => {
  it("accumulates tracked bytes and clears them on reset", async () => {
    const { proxyManager } = await loadWithEnv(PROXY_ENV);

    proxyManager.trackBytes(100);
    proxyManager.trackBytes(250);
    expect(proxyManager.getStats().totalBytes).toBe(350);

    proxyManager.getAgent();
    proxyManager.createStickySession();
    proxyManager.resetStats();

    const stats = proxyManager.getStats();
    expect(stats.totalBytes).toBe(0);
    expect(stats.totalRequests).toBe(0);
    expect(stats.totalSessions).toBe(0);
    // resetStats clears counters but must not un-initialise the config.
    expect(stats.configured).toBe(true);
    expect(stats.initialized).toBe(true);
  });
});

describe("proxyManager – testConnection", () => {
  it("reports success when the proxy IP differs from the direct IP", async () => {
    const { proxyManager } = await loadWithEnv(PROXY_ENV);

    vi.mocked(got)
      .mockReturnValueOnce({ json: async () => ({ ip: "1.1.1.1" }) } as never)
      .mockReturnValueOnce({ json: async () => ({ ip: "2.2.2.2" }) } as never);

    const result = await proxyManager.testConnection();

    expect(result).toEqual({ success: true, ip: "2.2.2.2", direct: "1.1.1.1" });
  });

  it("reports failure when the proxy returns the same IP as direct", async () => {
    const { proxyManager } = await loadWithEnv(PROXY_ENV);

    vi.mocked(got)
      .mockReturnValueOnce({ json: async () => ({ ip: "1.1.1.1" }) } as never)
      .mockReturnValueOnce({ json: async () => ({ ip: "1.1.1.1" }) } as never);

    const result = await proxyManager.testConnection();

    expect(result.success).toBe(false);
    expect(result.ip).toBe("1.1.1.1");
  });

  it("short-circuits with the direct IP when no proxy is configured", async () => {
    const { proxyManager } = await loadWithEnv({
      WEBSHARE_PROXY_HOST: undefined,
      WEBSHARE_USERNAME: undefined,
      WEBSHARE_PASSWORD: undefined,
    });

    vi.mocked(got).mockReturnValueOnce({ json: async () => ({ ip: "9.9.9.9" }) } as never);

    const result = await proxyManager.testConnection();

    expect(result).toEqual({
      success: false,
      error: "Proxy not configured",
      direct: "9.9.9.9",
    });
    // Only the direct probe should have been attempted.
    expect(vi.mocked(got)).toHaveBeenCalledTimes(1);
  });

  it("captures the message when a probe throws", async () => {
    const { proxyManager } = await loadWithEnv(PROXY_ENV);

    vi.mocked(got).mockImplementationOnce(() => {
      throw new Error("ECONNREFUSED");
    });

    const result = await proxyManager.testConnection();

    expect(result).toEqual({ success: false, error: "ECONNREFUSED" });
  });

  it("stringifies a non-Error rejection", async () => {
    const { proxyManager } = await loadWithEnv(PROXY_ENV);

    vi.mocked(got).mockImplementationOnce(() => {
      throw "socket hang up";
    });

    const result = await proxyManager.testConnection();

    expect(result.success).toBe(false);
    expect(result.error).toBe("socket hang up");
  });
});

describe("proxyFetch", () => {
  function gotResponse(over: Partial<Record<string, unknown>> = {}) {
    return {
      statusCode: 200,
      statusMessage: "OK",
      headers: { "content-type": "text/html" },
      body: "<html>hi</html>",
      ...over,
    };
  }

  it("maps a got response onto the fetch-like shape", async () => {
    const { proxyFetch } = await loadWithEnv(PROXY_ENV);
    vi.mocked(got).mockResolvedValueOnce(gotResponse() as never);

    const res = await proxyFetch("https://example.test/page");

    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.statusText).toBe("OK");
    expect(res.body).toBe("<html>hi</html>");
    await expect(res.text()).resolves.toBe("<html>hi</html>");
  });

  it.each([
    [199, false],
    [200, true],
    [299, true],
    [300, false],
    [404, false],
    [500, false],
  ])("treats status %i as ok=%s", async (statusCode, ok) => {
    const { proxyFetch } = await loadWithEnv(PROXY_ENV);
    vi.mocked(got).mockResolvedValueOnce(gotResponse({ statusCode }) as never);

    const res = await proxyFetch("https://example.test/page");

    expect(res.ok).toBe(ok);
  });

  it("falls back to an empty statusText when got omits it", async () => {
    const { proxyFetch } = await loadWithEnv(PROXY_ENV);
    vi.mocked(got).mockResolvedValueOnce(gotResponse({ statusMessage: undefined }) as never);

    const res = await proxyFetch("https://example.test/page");

    expect(res.statusText).toBe("");
  });

  it("reads headers case-insensitively, unwraps arrays and nulls the absent", async () => {
    const { proxyFetch } = await loadWithEnv(PROXY_ENV);
    vi.mocked(got).mockResolvedValueOnce(
      gotResponse({
        headers: { "content-type": "application/json", "set-cookie": ["a=1", "b=2"] },
      }) as never
    );

    const res = await proxyFetch("https://example.test/page");

    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("set-cookie")).toBe("a=1");
    expect(res.headers.get("x-missing")).toBeNull();
  });

  it("parses a JSON body", async () => {
    const { proxyFetch } = await loadWithEnv(PROXY_ENV);
    vi.mocked(got).mockResolvedValueOnce(gotResponse({ body: '{"slots":3}' }) as never);

    const res = await proxyFetch("https://example.test/api");

    await expect(res.json()).resolves.toEqual({ slots: 3 });
  });

  it("counts the response bytes toward bandwidth stats", async () => {
    const { proxyFetch, proxyManager } = await loadWithEnv(PROXY_ENV);
    proxyManager.resetStats();
    vi.mocked(got).mockResolvedValueOnce(gotResponse({ body: "0123456789" }) as never);

    await proxyFetch("https://example.test/page");

    expect(proxyManager.getStats().totalBytes).toBe(10);
  });

  it("defaults to GET with a 30s timeout, no retries and errors not thrown", async () => {
    const { proxyFetch } = await loadWithEnv(PROXY_ENV);
    vi.mocked(got).mockResolvedValueOnce(gotResponse() as never);

    await proxyFetch("https://example.test/page");

    const [, opts] = vi.mocked(got).mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(opts.method).toBe("GET");
    expect(opts.timeout).toEqual({ request: 30000 });
    expect(opts.retry).toEqual({ limit: 0 });
    expect(opts.throwHttpErrors).toBe(false);
    // No agent means a direct connection, not an undefined-agent crash.
    expect(opts.agent).toBeUndefined();
  });

  it("forwards method, body, headers and timeout", async () => {
    const { proxyFetch } = await loadWithEnv(PROXY_ENV);
    vi.mocked(got).mockResolvedValueOnce(gotResponse() as never);

    await proxyFetch("https://example.test/api", {
      method: "POST",
      body: '{"a":1}',
      headers: { "X-Test": "1" },
      timeout: 5000,
    });

    const [url, opts] = vi.mocked(got).mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(url).toBe("https://example.test/api");
    expect(opts.method).toBe("POST");
    expect(opts.body).toBe('{"a":1}');
    expect(opts.headers).toEqual({ "X-Test": "1" });
    expect(opts.timeout).toEqual({ request: 5000 });
  });

  it("applies a supplied agent to both http and https", async () => {
    const { proxyFetch, proxyManager } = await loadWithEnv(PROXY_ENV);
    vi.mocked(got).mockResolvedValueOnce(gotResponse() as never);
    const agent = proxyManager.getAgent();

    await proxyFetch("https://example.test/page", { agent });

    const [, opts] = vi.mocked(got).mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(opts.agent).toEqual({ https: agent, http: agent });
  });
});
