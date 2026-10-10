import { describe, expect, test } from "vitest";
import { isAllowedEmail } from "./allowlist";

const allowed = ["me@example.com", "other@example.org"] as const;

describe("isAllowedEmail", () => {
  test("リストにあるメールは true", () => {
    expect(isAllowedEmail("me@example.com", allowed)).toBe(true);
    expect(isAllowedEmail("other@example.org", allowed)).toBe(true);
  });

  test("大文字小文字を無視する", () => {
    expect(isAllowedEmail("Me@Example.COM", allowed)).toBe(true);
    expect(isAllowedEmail("me@example.com", ["ME@EXAMPLE.COM"])).toBe(true);
  });

  test("前後の空白を無視する", () => {
    expect(isAllowedEmail("  me@example.com\t\n", allowed)).toBe(true);
    expect(isAllowedEmail("me@example.com", [" me@example.com "])).toBe(true);
  });

  test("空文字・空白だけ・null・undefined は false", () => {
    expect(isAllowedEmail("", allowed)).toBe(false);
    expect(isAllowedEmail("   ", allowed)).toBe(false);
    expect(isAllowedEmail(null, allowed)).toBe(false);
    expect(isAllowedEmail(undefined, allowed)).toBe(false);
    expect(isAllowedEmail("", ["", " "])).toBe(false);
  });

  test("リストにないものは false (部分一致もしない)", () => {
    expect(isAllowedEmail("stranger@example.com", allowed)).toBe(false);
    expect(isAllowedEmail("me@example.com.evil", allowed)).toBe(false);
    expect(isAllowedEmail("xme@example.com", allowed)).toBe(false);
    expect(isAllowedEmail("me@example", allowed)).toBe(false);
  });

  test("許可リストが空なら常に false", () => {
    expect(isAllowedEmail("me@example.com", [])).toBe(false);
  });
});
