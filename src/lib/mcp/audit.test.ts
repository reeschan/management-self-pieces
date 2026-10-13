import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { mcpAuditLog } from "@/db/schema";
import { createTestDb } from "@/test/pglite";

import { type AuditEntry, listAudit, purgeAudit, recordAudit, summarizeArgs } from "./audit";

describe("監査ログ", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  const entry: AuditEntry = {
    mode: "host",
    tokenId: "token-a",
    ip: "192.0.2.1",
    tool: "list_nodes",
    argsSummary: '{"limit":10}',
    outcome: "ok",
    reason: null,
    durationMs: 42,
    now: new Date("2026-10-13T00:30:00.000Z"),
  };

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  beforeEach(async () => {
    await testDb.db.delete(mcpAuditLog);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("指定された時刻と全項目を保存し、読み戻せる", async () => {
    await recordAudit(testDb.db, entry);
    const { now, ...values } = entry;
    expect(await listAudit(testDb.db, { onlyRejected: false, limit: 10 }))
      .toEqual([{ id: expect.any(Number), ...values, createdAt: now }]);
  });

  it("local のログと null の項目も保存できる", async () => {
    const local: AuditEntry = {
      ...entry, mode: "local", tokenId: null, ip: null, tool: null,
      argsSummary: null, durationMs: null,
    };
    await recordAudit(testDb.db, local);
    const { now, ...values } = local;
    expect(await listAudit(testDb.db, { onlyRejected: false, limit: 10 }))
      .toEqual([{ id: expect.any(Number), ...values, createdAt: now }]);
  });

  it("記録順にかかわらず新しい順で返し、rejected だけに絞れる", async () => {
    for (const [time, outcome] of [
      ["03:00", "rejected"],
      ["01:00", "rejected"],
      ["04:00", "tool_error"],
      ["02:00", "ok"],
    ] as const) {
      await recordAudit(testDb.db, {
        ...entry, outcome, reason: outcome === "rejected" ? "rate_limit" : null,
        now: new Date(`2026-10-13T${time}:00.000Z`),
      });
    }
    const all = await listAudit(testDb.db, { onlyRejected: false, limit: 10 });
    expect(all.map((row) => row.outcome)).toEqual(["tool_error", "rejected", "ok", "rejected"]);
    const rejected = await listAudit(testDb.db, { onlyRejected: true, limit: 10 });
    expect(rejected).toEqual([all[1], all[3]]);
    expect(rejected.every((row) => row.reason === "rate_limit")).toBe(true);
    expect(await listAudit(testDb.db, { onlyRejected: true, limit: 1 })).toEqual([all[1]]);
  });

  it("limit を 1〜500 の整数に丸める", async () => {
    const { now, ...values } = entry;
    await testDb.db.insert(mcpAuditLog).values(Array.from({ length: 501 }, () => ({
      ...values, createdAt: now,
    })));
    for (const [limit, count] of [[-10, 1], [0, 1], [2.9, 2], [500, 500], [501, 500], [NaN, 1], [Infinity, 500]]) {
      expect(await listAudit(testDb.db, { onlyRejected: false, limit })).toHaveLength(count);
    }
  });

  it("90 日より前だけを削除し、境界の行を残す", async () => {
    const now = new Date("2026-10-13T12:34:56.789Z");
    const cutoff = new Date("2026-07-15T12:34:56.789Z");
    for (const time of [cutoff.getTime() - 1, cutoff.getTime(), cutoff.getTime() + 1, now.getTime()]) {
      await recordAudit(testDb.db, { ...entry, now: new Date(time) });
    }
    expect(await purgeAudit(testDb.db, now)).toBe(1);
    const rows = await listAudit(testDb.db, { onlyRejected: false, limit: 10 });
    expect(rows.map((row) => row.createdAt)).toEqual([now, new Date(cutoff.getTime() + 1), cutoff]);
    expect(await purgeAudit(testDb.db, now)).toBe(0);
  });
});

describe("summarizeArgs", () => {
  it("undefined と null は null にする", () => {
    expect(summarizeArgs(undefined)).toBeNull();
    expect(summarizeArgs(null)).toBeNull();
  });

  it("40 文字までの文字列と数値・真偽値を保持する", () => {
    const args = { text: "あ".repeat(40), count: 12, enabled: true, disabled: false, empty: null };
    expect(summarizeArgs(args)).toBe(JSON.stringify(args));
  });

  it("長い文字列は先頭 20 文字と全体の文字数にする", () => {
    expect(summarizeArgs({ text: "あ".repeat(41) }))
      .toBe(JSON.stringify({ text: `${"あ".repeat(20)}…(41文字)` }));
  });

  it("配列は件数、入れ子のオブジェクトは省略表記にする", () => {
    expect(summarizeArgs({ items: [1, 2, 3], empty: [], nested: { secret: "value" } }))
      .toBe('{"items":"[3件]","empty":"[0件]","nested":"{…}"}');
  });

  it("JSON 文字列の 200 文字を超えた部分を切り詰める", () => {
    const exact = { text: "あ".repeat(40), key: "い".repeat(40), a: "う".repeat(40), b: "え".repeat(40), c: "お".repeat(1) };
    const args = { ...exact, more: "か".repeat(40) };
    const serialized = JSON.stringify(args);
    expect(serialized.length).toBeGreaterThan(200);
    expect(summarizeArgs(args)).toBe(serialized.slice(0, 200));
    expect(summarizeArgs(args)).toHaveLength(200);
  });
});
