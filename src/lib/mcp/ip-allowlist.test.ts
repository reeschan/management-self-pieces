import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ipAllowlist } from "@/db/schema";
import { createTestDb } from "@/test/pglite";

import { addAllowlistEntry, isIpAllowed, listAllowlist, removeAllowlistEntry } from "./ip-allowlist";

describe("IP 許可リスト", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(async () => {
    await testDb?.close();
  });

  it("空のときはループバックを含めてすべて拒否する", async () => {
    expect(await listAllowlist(testDb.db)).toEqual([]);
    for (const ip of ["203.0.113.5", "2001:db8::1", "127.0.0.1", "::1"]) {
      expect(await isIpAllowed(testDb.db, ip)).toBe(false);
    }
  });

  it("登録した IPv4・IPv6 範囲だけを許可する", async () => {
    const { db } = testDb;
    expect(await addAllowlistEntry(db, { cidr: "203.0.113.5/24", label: "  自宅  " }))
      .toBe("203.0.113.0/24");
    await addAllowlistEntry(db, { cidr: "2001:db8:1:2::/64", label: "IPv6" });
    for (const ip of ["203.0.113.5", "::ffff:203.0.113.5", "2001:db8:1:2::1"]) {
      expect(await isIpAllowed(db, ip)).toBe(true);
    }
    for (const ip of ["203.0.114.5", "2001:db8:1:3::1", "127.0.0.1", "abc"]) {
      expect(await isIpAllowed(db, ip)).toBe(false);
    }
    expect((await listAllowlist(db))[0]).toEqual({
      id: expect.any(Number), cidr: "203.0.113.0/24", label: "自宅", createdAt: expect.any(Date),
    });
  });

  it("同じ CIDR と正規化後に同じになる CIDR は追加も更新もしない", async () => {
    const { db } = testDb;
    await addAllowlistEntry(db, { cidr: "203.0.113.5", label: "最初" });
    const original = await listAllowlist(db);
    for (const cidr of ["203.0.113.5", "203.0.113.5/32", "::ffff:cb00:7105"]) {
      expect(await addAllowlistEntry(db, { cidr, label: "後から" })).toBe("203.0.113.5/32");
    }
    expect(await listAllowlist(db)).toEqual(original);
    expect(original).toHaveLength(1);
  });

  it("削除の有無を返し、削除後は許可しない", async () => {
    const { db } = testDb;
    await addAllowlistEntry(db, { cidr: "203.0.113.0/24", label: "自宅" });
    const [entry] = await listAllowlist(db);
    expect(await removeAllowlistEntry(db, entry.id)).toBe(true);
    expect(await removeAllowlistEntry(db, entry.id)).toBe(false);
    expect(await isIpAllowed(db, "203.0.113.5")).toBe(false);
  });

  it("不正な CIDR と空または長すぎるラベルは例外にして保存しない", async () => {
    const { db } = testDb;
    for (const cidr of ["abc", "0.0.0.0/0", "::/0", "10.0.0.0/7"]) {
      await expect(addAllowlistEntry(db, { cidr, label: "自宅" })).rejects.toThrow("CIDR");
    }
    for (const label of ["", " \t\n", "あ".repeat(61)]) {
      await expect(addAllowlistEntry(db, { cidr: "203.0.113.5", label })).rejects.toThrow("ラベル");
    }
    expect(await listAllowlist(db)).toEqual([]);
    await addAllowlistEntry(db, { cidr: "203.0.113.5", label: " あ " });
    await addAllowlistEntry(db, { cidr: "203.0.113.6", label: ` ${"あ".repeat(60)} ` });
    expect((await listAllowlist(db)).map(({ label }) => label)).toEqual(["あ", "あ".repeat(60)]);
  });

  it("作成日時の古い順、同時刻なら ID 順に返す", async () => {
    const { db } = testDb;
    await db.insert(ipAllowlist).values([
      { cidr: "203.0.113.1/32", label: "新しい", createdAt: new Date("2026-01-02") },
      { cidr: "203.0.113.2/32", label: "古い", createdAt: new Date("2026-01-01") },
      { cidr: "203.0.113.3/32", label: "同時刻", createdAt: new Date("2026-01-01") },
    ]);
    expect((await listAllowlist(db)).map(({ label }) => label)).toEqual(["古い", "同時刻", "新しい"]);
  });

  it("DB に不正な CIDR があっても許可せず、他の有効な行を判定する", async () => {
    const { db } = testDb;
    await db.insert(ipAllowlist).values({ cidr: "0.0.0.0/0", label: "不正な既存行" });
    expect(await isIpAllowed(db, "203.0.113.5")).toBe(false);
    await addAllowlistEntry(db, { cidr: "203.0.113.5", label: "有効" });
    expect(await isIpAllowed(db, "203.0.113.5")).toBe(true);
  });
});
