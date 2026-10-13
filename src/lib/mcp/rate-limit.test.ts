import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { mcpRateLimits } from "@/db/schema";
import { createTestDb } from "@/test/pglite";

import { consumeRateLimit, purgeRateLimits, RATE_LIMITS, windowStartOf } from "./rate-limit";

describe("windowStartOf", () => {
  it("UTC の正時に切り下げ、元の日時は変更しない", () => {
    const now = new Date("2026-10-13T09:59:59.999+09:00");
    expect(windowStartOf(now)).toEqual(new Date("2026-10-13T00:00:00.000Z"));
    expect(now.toISOString()).toBe("2026-10-13T00:59:59.999Z");
    expect(windowStartOf(new Date("2026-10-13T01:00:00.000Z")))
      .toEqual(new Date("2026-10-13T01:00:00.000Z"));
  });
});

describe("レート制限", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  const now = new Date("2026-10-13T00:30:00.000Z");

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  beforeEach(async () => {
    await testDb.db.delete(mcpRateLimits);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it.each([
    ["all", 1200],
    ["write", 300],
  ] as const)("%s は %i 回まで許可し、その後も回数を記録する", async (kind, limit) => {
    expect(RATE_LIMITS[kind]).toBe(limit);
    for (let count = 1; count <= limit; count++) {
      expect(await consumeRateLimit(testDb.db, { tokenId: "token-a", kind, now }))
        .toEqual({ allowed: true, count });
    }
    for (let count = limit + 1; count <= limit + 2; count++) {
      expect(await consumeRateLimit(testDb.db, { tokenId: "token-a", kind, now }))
        .toEqual({ allowed: false, count });
    }
  });

  it("同じ窓では継続し、日付をまたいで窓が変わると数え直す", async () => {
    const input = { tokenId: "token-a", kind: "all" as const };
    for (const [time, count] of [
      ["2026-10-13T23:00:00.000Z", 1],
      ["2026-10-13T23:59:59.999Z", 2],
      ["2026-10-14T00:00:00.000Z", 1],
    ] as const) {
      expect(await consumeRateLimit(testDb.db, { ...input, now: new Date(time) }))
        .toEqual({ allowed: true, count });
    }
  });

  it("トークンと種類ごとに独立して数える", async () => {
    for (const [tokenId, kind, count] of [
      ["token-a", "all", 1],
      ["token-a", "all", 2],
      ["token-b", "all", 1],
      ["token-a", "write", 1],
    ] as const) {
      expect(await consumeRateLimit(testDb.db, { tokenId, kind, now }))
        .toEqual({ allowed: true, count });
    }
  });

  it("同時に呼び出しても増分を失わない", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () =>
      consumeRateLimit(testDb.db, { tokenId: "token-a", kind: "all", now }),
    ));
    expect(results.map((result) => result.count).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(await testDb.db.select().from(mcpRateLimits)).toMatchObject([{ count: 20 }]);
  });

  it("2 時間より前の窓だけを削除し、境界と新しい窓を残す", async () => {
    await testDb.db.insert(mcpRateLimits).values(
      [0, 1, 2, 3, 4].map((hour) => ({
        tokenId: "token-a",
        kind: "all",
        windowStart: new Date(`2026-10-13T0${hour}:00:00.000Z`),
        count: 1,
      })),
    );
    expect(await purgeRateLimits(testDb.db, new Date("2026-10-13T04:00:00.000Z"))).toBe(2);
    const rows = await testDb.db.select().from(mcpRateLimits).orderBy(mcpRateLimits.windowStart);
    expect(rows.map((row) => row.windowStart.toISOString())).toEqual([
      "2026-10-13T02:00:00.000Z",
      "2026-10-13T03:00:00.000Z",
      "2026-10-13T04:00:00.000Z",
    ]);
    expect(await purgeRateLimits(testDb.db, new Date("2026-10-13T04:00:00.000Z"))).toBe(0);
    expect(await purgeRateLimits(testDb.db, new Date("2026-10-13T04:30:00.000Z"))).toBe(1);
  });
});
