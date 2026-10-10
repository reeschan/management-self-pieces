import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { dbEnv } from "@/lib/env";
import * as authSchema from "./auth-schema";
import * as appSchema from "./schema";

/**
 * DB クライアント。モジュールの読み込み時には接続も環境変数の検証もしない
 * (環境変数なしで `next build` が通るようにするため)。
 * neon-http はトランザクションに対応しないので、まとめて書くときは `db.batch([...])` を使う。
 */

const schema = { ...appSchema, ...authSchema };

function createDb() {
  const { databaseUrl } = dbEnv();
  return drizzle({ client: neon(databaseUrl), schema });
}

let cached: ReturnType<typeof createDb> | undefined;

export function getDb() {
  cached ??= createDb();
  return cached;
}

export type Db = ReturnType<typeof getDb>;
