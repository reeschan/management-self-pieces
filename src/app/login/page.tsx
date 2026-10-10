import { redirect } from "next/navigation";
import { connection } from "next/server";

import { SignInButtons } from "@/components/auth/sign-in-buttons";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { isAllowedEmail } from "@/lib/auth/allowlist";
import { getSession } from "@/lib/auth/server";
import { authEnv } from "@/lib/env";

// セッションと searchParams を読むので、サーバーで確かめてから描画する
export const instant = false;

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // getSession() は headers より先に環境変数を読むので、先にリクエスト時へ回す (build 時の事前生成で env を読まない)
  await connection();
  const { error } = await searchParams;
  const session = await getSession();

  // ログイン済みかつ許可リスト内のときだけ / へ (許可リスト外で / と /login を往復しないため)
  const allowed =
    session !== null &&
    isAllowedEmail(session.user.email, authEnv().allowedEmails);
  if (allowed) {
    redirect("/");
  }
  const deniedSession = session !== null;
  const showError = error !== undefined || deniedSession;

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="mb-6 text-center text-lg font-semibold">
          management-self-pieces
        </h1>
        {showError && (
          <p
            role="alert"
            className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            このアカウントでは利用できません
          </p>
        )}
        {deniedSession ? (
          <div className="flex flex-col items-center gap-3 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">
              {session.user.email}
            </span>
            <SignOutButton />
          </div>
        ) : (
          <SignInButtons />
        )}
      </div>
    </div>
  );
}
