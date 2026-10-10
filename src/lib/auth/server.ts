import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";

import { getDb } from "@/db/client";
import * as authSchema from "@/db/auth-schema";
import { authEnv } from "@/lib/env";
import { isAllowedEmail } from "./allowlist";

/**
 * Better Auth のサーバー側インスタンス。
 * モジュールの読み込み時には作らず、初回の `getAuth()` で作ってキャッシュする
 * (環境変数なしで `next build` が通るようにするため)。
 */

function createAuth() {
  const env = authEnv();
  const { allowedEmails } = env;

  return betterAuth({
    baseURL: env.appUrl,
    secret: env.secret,
    database: drizzleAdapter(getDb(), { provider: "pg", schema: authSchema }),
    // メール・パスワードのログインは使わない (Google / GitHub のみ)
    socialProviders: {
      google: {
        clientId: env.google.clientId,
        clientSecret: env.google.clientSecret,
      },
      // GitHub App の Client ID / Secret
      github: {
        clientId: env.github.clientId,
        clientSecret: env.github.clientSecret,
      },
    },
    account: {
      accountLinking: { enabled: true, trustedProviders: ["google", "github"] },
    },
    databaseHooks: {
      user: {
        create: {
          // false を返すと better-auth はユーザーを作らない (許可リスト外は入れない)
          before: async (user) =>
            isAllowedEmail(user.email, allowedEmails) ? { data: user } : false,
        },
      },
    },
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
    plugins: [nextCookies()],
  });
}

let cached: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  cached ??= createAuth();
  return cached;
}

export type Auth = ReturnType<typeof getAuth>;

/** 現在のリクエストのセッション (未ログインなら null)。 */
export async function getSession() {
  return getAuth().api.getSession({ headers: await headers() });
}

/** 許可リストに含まれるユーザーのセッション (未ログイン・許可リスト外なら null)。 */
export async function getAllowedSession() {
  const session = await getSession();
  if (session === null) return null;
  if (!isAllowedEmail(session.user.email, authEnv().allowedEmails)) return null;
  return session;
}
