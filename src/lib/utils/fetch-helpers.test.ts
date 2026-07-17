import { describe, it, expect } from "vitest";
import { handleApiResponse, parseIdParam, parseSessionUserId } from "./fetch-helpers";

/** Minimal Response stand-in — enough surface for handleApiResponse. */
function fakeResponse(opts: {
  ok: boolean;
  status?: number;
  statusText?: string;
  json?: () => Promise<unknown>;
}): Response {
  return {
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
    statusText: opts.statusText ?? "",
    json: opts.json ?? (async () => ({})),
  } as unknown as Response;
}

describe("handleApiResponse", () => {
  it("returns parsed JSON on a 2xx response", async () => {
    const res = fakeResponse({ ok: true, json: async () => ({ hello: "world" }) });
    await expect(handleApiResponse(res)).resolves.toEqual({ hello: "world" });
  });

  it("throws the body's `error` message when present", async () => {
    const res = fakeResponse({ ok: false, status: 400, json: async () => ({ error: "Bad venue" }) });
    await expect(handleApiResponse(res)).rejects.toThrow("Bad venue");
  });

  it("falls back to status text when the error body isn't JSON", async () => {
    const res = fakeResponse({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: async () => {
        throw new Error("not json");
      },
    });
    await expect(handleApiResponse(res)).rejects.toThrow("API Error: 502 Bad Gateway");
  });
});

describe("parseIdParam", () => {
  it("parses a numeric string", () => {
    expect(parseIdParam("42")).toBe(42);
  });

  it("throws with the param name on a non-numeric string", () => {
    expect(() => parseIdParam("abc", "watchId")).toThrow("Invalid watchId: must be a number");
  });

  it("defaults the param name to 'id'", () => {
    expect(() => parseIdParam("nope")).toThrow("Invalid id: must be a number");
  });
});

describe("parseSessionUserId", () => {
  it("returns a numeric user id directly", () => {
    expect(parseSessionUserId({ user: { id: 7 } })).toBe(7);
  });

  it("parses a string user id", () => {
    expect(parseSessionUserId({ user: { id: "7" } })).toBe(7);
  });

  it("throws on a missing session or user", () => {
    expect(() => parseSessionUserId(null)).toThrow("Invalid session");
    expect(() => parseSessionUserId(undefined)).toThrow("Invalid session");
    expect(() => parseSessionUserId({})).toThrow("Invalid session");
  });

  it("throws when the user id isn't a number", () => {
    expect(() => parseSessionUserId({ user: { id: "abc" } })).toThrow("Invalid user session");
  });
});
