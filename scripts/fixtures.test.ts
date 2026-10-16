import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { nodes, relations } from "@/db/schema";
import { exportNodes, importNodes, previewImport } from "@/lib/nodes/transfer";
import { createTestDb } from "@/test/pglite";

describe("fixtures/nodes.json", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let raw: unknown;

  beforeAll(async () => {
    testDb = await createTestDb();
    raw = JSON.parse(await readFile(path.join(process.cwd(), "fixtures", "nodes.json"), "utf8"));
  });

  beforeEach(async () => {
    // nodes を消せば relations も cascade で消える
    await testDb.db.delete(relations);
    await testDb.db.delete(nodes);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("previewImport が ok: true で added が 6", async () => {
    expect(await previewImport(testDb.db, raw)).toEqual({ ok: true, added: 6, updated: 0 });
  });

  it("importNodes のあと、exportNodes の Node が 6 件", async () => {
    const now = () => new Date("2026-10-14T00:00:00.000Z");

    await importNodes(testDb.db, raw, now);

    const exported = await exportNodes(testDb.db, now);
    expect(exported.nodes).toHaveLength(6);
  });
});
