import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { getDb } from "@/db/client";
import { nodes } from "@/db/schema";
import type { AppDb } from "@/db/types";

import { createTestDb } from "./pglite";

// 型だけの確認: neon-http の getDb() の戻り値が AppDb に代入できること (実行時に DB へは繋がない)
const _check: AppDb = null as unknown as ReturnType<typeof getDb>;
void _check;

describe("createTestDb", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("マイグレーション済みの DB に nodes を insert して select で読み戻せる", async () => {
    const { db } = testDb;
    await db.insert(nodes).values({
      id: "test-node",
      kind: "app",
      title: "テスト用の Node",
      summary: "PGlite の土台を確かめるための行",
      status: "active",
      detailPath: "README.md",
      tags: ["test"],
      sourceRepo: "owner/test-repo",
      sourceSha: "0000000",
    });

    const rows = await db.select().from(nodes).where(eq(nodes.id, "test-node"));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "test-node",
      title: "テスト用の Node",
      tags: ["test"],
      links: {},
    });
  });
});
