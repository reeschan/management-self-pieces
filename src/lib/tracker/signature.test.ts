import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import { verifyAsanaSignature } from "./signature";

const SECRET = "hook-secret-0123456789";
const BODY = JSON.stringify({ events: [{ action: "changed" }] });

function sign(secret: string, body: string) {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("verifyAsanaSignature", () => {
  test("正しい署名なら true", () => {
    expect(verifyAsanaSignature(SECRET, BODY, sign(SECRET, BODY))).toBe(true);
  });

  test("本文が 1 文字違うと false", () => {
    const signature = sign(SECRET, BODY);
    const tampered = BODY.slice(0, -1) + "]";
    expect(tampered).not.toBe(BODY);
    expect(verifyAsanaSignature(SECRET, tampered, signature)).toBe(false);
  });

  test("secret が違うと false", () => {
    expect(
      verifyAsanaSignature(SECRET, BODY, sign("other-secret", BODY)),
    ).toBe(false);
  });

  test("署名が null なら false", () => {
    expect(verifyAsanaSignature(SECRET, BODY, null)).toBe(false);
  });

  test("署名の長さが違うと false (例外を投げない)", () => {
    const signature = sign(SECRET, BODY);
    expect(verifyAsanaSignature(SECRET, BODY, signature.slice(0, -2))).toBe(
      false,
    );
    expect(verifyAsanaSignature(SECRET, BODY, signature + "00")).toBe(false);
    expect(verifyAsanaSignature(SECRET, BODY, "")).toBe(false);
  });
});
