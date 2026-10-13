import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type * as authSchema from "./auth-schema";
import type * as appSchema from "./schema";

/** `src/db/client.ts` と同じく、アプリのテーブルと認証のテーブルを合わせたスキーマ。 */
export type AppSchema = typeof appSchema & typeof authSchema;

/**
 * 本番の neon-http と、テスト用の PGlite の両方を受け取れる DB の型。
 * neon-http には transaction が無く、PGlite には batch が無い。AppDb を受け取る関数では、どちらも使わず 1 文で済む書き方にする。
 */
export type AppDb = PgDatabase<PgQueryResultHKT, AppSchema>;
