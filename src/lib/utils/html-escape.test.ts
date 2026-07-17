import { describe, it, expect } from "vitest";
import { escapeHtml, escapeTelegramHtml } from "./html-escape";

describe("escapeHtml", () => {
  it("returns empty string for null/undefined/empty", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml("")).toBe("");
  });

  it("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#039;");
  });

  it("escapes ampersands before other entities (no double-escaping)", () => {
    // `<` → `&lt;`; the introduced `&` must not itself be re-escaped.
    expect(escapeHtml("a < b")).toBe("a &lt; b");
    expect(escapeHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("Court 3")).toBe("Court 3");
  });
});

describe("escapeTelegramHtml", () => {
  it("returns empty string for falsy input", () => {
    expect(escapeTelegramHtml(null)).toBe("");
    expect(escapeTelegramHtml(undefined)).toBe("");
    expect(escapeTelegramHtml("")).toBe("");
  });

  it("escapes only &, < and > (Telegram's HTML subset)", () => {
    expect(escapeTelegramHtml(`&<>"'`)).toBe("&amp;&lt;&gt;\"'");
  });
});
