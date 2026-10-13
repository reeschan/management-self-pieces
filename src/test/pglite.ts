import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as authSchema from "@/db/auth-schema";
import * as appSchema from "@/db/schema";
import type { AppDb } from "@/db/types";

const schema = { ...appSchema, ...authSchema };

/**
 * テスト用に、メモリ上の Postgres (PGlite) を作り、リポジトリの drizzle フォルダの
 * マイグレーションをすべて適用した DB を返す。使い終わったら `close()` を呼ぶ。
 */
export async function createTestDb(): Promise<{
  db: AppDb;
  close(): Promise<void>;
}> {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  // テストはリポジトリのルートで実行される前提
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  return {
    db,
    close: () => client.close(),
  };
}
