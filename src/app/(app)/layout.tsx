import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { getDb } from "@/db/client";
import { isAllowedEmail } from "@/lib/auth/allowlist";
import { getSession } from "@/lib/auth/server";
import { countOwnerDecisions } from "@/lib/devloop/task-cache";
import { authEnv } from "@/lib/env";

// セッション (headers) を読むので、サーバーで確かめてから描画する
export const instant = false;

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // getSession() は headers より先に環境変数を読むので、先にリクエスト時へ回す (build 時の事前生成で env を読まない)
  await connection();
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  // 許可リストから外したユーザーの既存セッションは通さない
  if (!isAllowedEmail(session.user.email, authEnv().allowedEmails)) {
    redirect("/login?error=denied");
  }

  // 件数の取得に失敗してもヘッダーは出す (バッジだけ出さない)
  let ownerDecisions = 0;
  try {
    ownerDecisions = await countOwnerDecisions(getDb());
  } catch {
    ownerDecisions = 0;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-end gap-3 border-b border-zinc-200 px-4 py-2 text-sm dark:border-zinc-800">
        <nav aria-label="メインナビゲーション" className="mr-auto flex gap-3">
          <Link href="/" className="hover:underline">
            ダッシュボード
          </Link>
          <Link href="/owner" className="flex items-center gap-1 hover:underline">
            Owner 判断
            {ownerDecisions > 0 && (
              <span
                aria-label={`未回答 ${ownerDecisions} 件`}
                className="rounded-full bg-red-600 px-1.5 text-xs font-medium text-white"
              >
                {ownerDecisions}
              </span>
            )}
          </Link>
          <Link href="/settings" className="hover:underline">
            設定
          </Link>
        </nav>
        <span className="text-zinc-600 dark:text-zinc-400">
          {session.user.email}
        </span>
        <SignOutButton />
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
