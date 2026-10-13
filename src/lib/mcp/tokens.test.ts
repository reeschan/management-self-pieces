import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { agentTokens } from "@/db/schema";
import type { AppDb } from "@/db/types";
import { createTestDb } from "@/test/pglite";

import {
  generateRawToken,
  hashToken,
  issueToken,
  listTokens,
  revokeToken,
  type Scope,
  verifyToken,
} from "./tokens";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const LATER = new Date("2026-10-02T00:00:00.000Z");

describe("tokens", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let db: AppDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  });

  afterEach(async () => {
    await testDb?.close();
  });

  describe("generateRawToken / hashToken", () => {
    it("msp_ で始まり、毎回違う値を作る", () => {
      const a = generateRawToken();
      const b = generateRawToken();
      expect(a.startsWith("msp_")).toBe(true);
      expect(a).toMatch(/^msp_[A-Za-z0-9_-]{43}$/);
      expect(a).not.toBe(b);
    });

    it("SHA-256 の hex を返す", () => {
      expect(hashToken("abc")).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      );
    });
  });

  describe("issueToken / verifyToken", () => {
    it("発行した raw で検証すると id と scopes が返り、lastUsedAt が now になる", async () => {
      const { id, raw } = await issueToken(db, {
        name: "  エージェント A  ",
        scopes: ["read", "board"],
        expiresAt: null,
        now: NOW,
      });

      const result = await verifyToken(db, raw, LATER);
      expect(result).toEqual({ id, scopes: ["read", "board"] });

      const [row] = await db.select().from(agentTokens).where(eq(agentTokens.id, id));
      expect(row?.lastUsedAt?.getTime()).toBe(LATER.getTime());
      expect(row?.name).toBe("エージェント A");
      expect(row?.createdAt.getTime()).toBe(NOW.getTime());
    });

    it("DB の行には raw そのものがどの列にも入っていない", async () => {
      const { id, raw } = await issueToken(db, {
        name: "agent",
        scopes: ["read"],
        expiresAt: LATER,
        now: NOW,
      });

      const [row] = await db.select().from(agentTokens).where(eq(agentTokens.id, id));
      expect(row).toBeDefined();
      for (const value of Object.values(row ?? {})) {
        expect(JSON.stringify(value) ?? "").not.toContain(raw);
      }
      // 本体部分 (接頭辞を除いた値) も入っていない
      expect(JSON.stringify(row)).not.toContain(raw.slice(4));
      expect(row?.tokenHash).toBe(hashToken(raw));
    });

    it("1 文字違う値・接頭辞が無い値・空文字・長すぎる値は null", async () => {
      const { raw } = await issueToken(db, {
        name: "agent",
        scopes: ["read"],
        expiresAt: null,
        now: NOW,
      });

      const last = raw.at(-1);
      const oneOff = raw.slice(0, -1) + (last === "A" ? "B" : "A");
      expect(await verifyToken(db, oneOff, NOW)).toBeNull();
      expect(await verifyToken(db, raw.slice(4), NOW)).toBeNull();
      expect(await verifyToken(db, "", NOW)).toBeNull();
      expect(await verifyToken(db, raw + "x".repeat(200), NOW)).toBeNull();
    });

    it("失効後は null", async () => {
      const { id, raw } = await issueToken(db, {
        name: "agent",
        scopes: ["loop"],
        expiresAt: null,
        now: NOW,
      });
      expect(await verifyToken(db, raw, NOW)).not.toBeNull();

      expect(await revokeToken(db, id, LATER)).toBe(true);
      expect(await verifyToken(db, raw, LATER)).toBeNull();
    });

    it("期限ちょうど (expiresAt == now) は null、その前なら通る", async () => {
      const { raw } = await issueToken(db, {
        name: "agent",
        scopes: ["read"],
        expiresAt: LATER,
        now: NOW,
      });

      expect(await verifyToken(db, raw, new Date(LATER.getTime() - 1))).not.toBeNull();
      expect(await verifyToken(db, raw, LATER)).toBeNull();
      expect(await verifyToken(db, raw, new Date(LATER.getTime() + 1))).toBeNull();
    });

    it("DB の scopes に知らない値があっても、SCOPES に含まれるものだけを返す", async () => {
      const raw = generateRawToken();
      await db.insert(agentTokens).values({
        id: "manual",
        name: "manual",
        tokenHash: hashToken(raw),
        scopes: ["read", "admin", "loop"],
        createdAt: NOW,
      });

      expect(await verifyToken(db, raw, NOW)).toEqual({
        id: "manual",
        scopes: ["read", "loop"],
      });
    });

    it.each([
      ["空の name", { name: "", scopes: ["read"] as Scope[] }],
      ["空白だけの name", { name: "   ", scopes: ["read"] as Scope[] }],
      ["61 文字の name", { name: "a".repeat(61), scopes: ["read"] as Scope[] }],
      ["空の scopes", { name: "agent", scopes: [] as Scope[] }],
      ["重複した scopes", { name: "agent", scopes: ["read", "read"] as Scope[] }],
      ["知らない scope", { name: "agent", scopes: ["admin"] as unknown as Scope[] }],
    ])("%s で例外を投げる", async (_label, input) => {
      await expect(
        issueToken(db, { ...input, expiresAt: null, now: NOW }),
      ).rejects.toThrow(Error);
      expect(await listTokens(db)).toHaveLength(0);
    });

    it("前後の空白を除いて 60 文字の name は通る", async () => {
      await expect(
        issueToken(db, {
          name: ` ${"a".repeat(60)} `,
          scopes: ["read"],
          expiresAt: null,
          now: NOW,
        }),
      ).resolves.toMatchObject({ id: expect.any(String) });
    });
  });

  describe("revokeToken", () => {
    it("存在しない id や、既に失効済みなら false", async () => {
      const { id } = await issueToken(db, {
        name: "agent",
        scopes: ["read"],
        expiresAt: null,
        now: NOW,
      });

      expect(await revokeToken(db, "no-such-id", NOW)).toBe(false);
      expect(await revokeToken(db, id, NOW)).toBe(true);
      expect(await revokeToken(db, id, LATER)).toBe(false);

      const [row] = await db.select().from(agentTokens).where(eq(agentTokens.id, id));
      expect(row?.revokedAt?.getTime()).toBe(NOW.getTime());
    });
  });

  describe("listTokens", () => {
    it("作成の新しい順に返し、ハッシュの項目を含まない", async () => {
      const older = await issueToken(db, {
        name: "older",
        scopes: ["read"],
        expiresAt: null,
        now: NOW,
      });
      const newer = await issueToken(db, {
        name: "newer",
        scopes: ["board", "loop"],
        expiresAt: LATER,
        now: LATER,
      });

      const list = await listTokens(db);
      expect(list.map((t) => t.id)).toEqual([newer.id, older.id]);
      for (const item of list) {
        expect(Object.keys(item).sort()).toEqual(
          ["createdAt", "expiresAt", "id", "lastUsedAt", "name", "revokedAt", "scopes"].sort(),
        );
        expect(item).not.toHaveProperty("tokenHash");
        expect(JSON.stringify(item)).not.toContain(hashToken(newer.raw));
        expect(JSON.stringify(item)).not.toContain(hashToken(older.raw));
      }
      expect(list[0]).toMatchObject({
        name: "newer",
        scopes: ["board", "loop"],
        revokedAt: null,
        lastUsedAt: null,
      });
    });
  });
});
