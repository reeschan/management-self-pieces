import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { isAllowedEmail } from "@/lib/auth/allowlist";
import { getSession } from "@/lib/auth/server";
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

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-end gap-3 border-b border-zinc-200 px-4 py-2 text-sm dark:border-zinc-800">
        <nav aria-label="メインナビゲーション" className="mr-auto flex gap-3">
          <Link href="/" className="hover:underline">
            ダッシュボード
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
