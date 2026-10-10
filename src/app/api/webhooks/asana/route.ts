import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { syncState } from "@/db/schema";
import {
  refreshTasksByProject,
  webhookPendingKey,
  webhookSecretKey,
} from "@/lib/tracker/service";
import { verifyAsanaSignature } from "@/lib/tracker/signature";

/** pending (asana:webhook-pending:<project>) を受け付ける期間 */
const PENDING_TTL_MS = 5 * 60 * 1000;

async function readState(key: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ value: syncState.value })
    .from(syncState)
    .where(eq(syncState.key, key))
    .limit(1);
  return row?.value ?? null;
}

/**
 * ハンドシェイク。createWebhook の直前に置いた webhook-pending が 5 分以内にあり、
 * まだ secret が無い project のときだけ受け付ける (第三者による secret の登録・差し替えを防ぐ)。
 */
async function handleHandshake(project: string, hookSecret: string) {
  const conflict = () =>
    Response.json({ error: "handshake not expected" }, { status: 409 });

  const secretKey = webhookSecretKey(project);
  const pendingKey = webhookPendingKey(project);

  if ((await readState(secretKey)) !== null) return conflict();

  const pending = await readState(pendingKey);
  if (pending === null) return conflict();
  const pendingAt = Date.parse(pending);
  const age = Date.now() - pendingAt;
  if (Number.isNaN(pendingAt) || age < 0 || age > PENDING_TTL_MS) {
    return conflict();
  }

  const db = getDb();
  // 同時に届いたハンドシェイクのうち 1 つだけが pending を消せる
  const claimed = await db
    .delete(syncState)
    .where(eq(syncState.key, pendingKey))
    .returning({ key: syncState.key });
  if (claimed.length === 0) return conflict();

  const inserted = await db
    .insert(syncState)
    .values({ key: secretKey, value: hookSecret })
    .onConflictDoNothing({ target: syncState.key })
    .returning({ key: syncState.key });
  if (inserted.length === 0) return conflict();

  return new Response(null, {
    status: 200,
    headers: { "X-Hook-Secret": hookSecret },
  });
}

export async function POST(req: Request) {
  const project = new URL(req.url).searchParams.get("project");
  if (!project) {
    return Response.json({ error: "missing project" }, { status: 400 });
  }

  // 署名の検証には生の本文が要る。検証より前に JSON.parse しない
  const rawBody = await req.text();

  try {
    const hookSecret = req.headers.get("x-hook-secret");
    if (hookSecret) {
      return await handleHandshake(project, hookSecret);
    }

    const secret = await readState(webhookSecretKey(project));
    if (secret === null) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const signature = req.headers.get("x-hook-signature");
    if (!verifyAsanaSignature(secret, rawBody, signature)) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    // events の中身は見ず、変更があったらプロジェクトのタスクを全部取り直す
    const count = await refreshTasksByProject(project);
    return Response.json({ refreshed: count });
  } catch (error) {
    console.error(
      "[webhook:asana] failed",
      error instanceof Error ? error.message : error,
    );
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
