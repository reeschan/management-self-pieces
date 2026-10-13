import { z } from "zod";

/**
 * 環境変数の検証。読み込み時には検証せず、機能ごとの関数を呼んだときに検証する
 * (環境変数が無くても `next build` が通るようにするため)。
 * DB・認証・GitHub・Asana・Cron の各モジュールはここの関数だけを通して環境変数を読む。
 */

type EnvSource = Record<string, string | undefined>;

// ローカル機能を明示的に有効にしたときだけローカルとして扱う。
// Vercel ではフラグにかかわらず必ずホストとして扱う。
export function runtimeMode(source: EnvSource = process.env): "local" | "host" {
  return source.LOCAL_AGENT_FEATURES === "1" &&
    (source.VERCEL === undefined || source.VERCEL === "")
    ? "local"
    : "host";
}

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

const nonEmpty = () => z.string().min(1);

const appUrl = () =>
  z.url().transform((value) => value.replace(/\/+$/, ""));

function parse<S extends z.ZodType>(
  feature: string,
  schema: S,
  source: EnvSource,
): z.output<S> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;

  // 値を含めないよう、エラーメッセージにはキー名だけを使う
  const keys = [
    ...new Set(
      result.error.issues.map((issue) =>
        issue.path.length > 0 ? String(issue.path[0]) : "(unknown)",
      ),
    ),
  ];
  throw new EnvError(
    `[env:${feature}] 環境変数が足りないか不正です: ${keys.join(", ")}`,
  );
}

const dbSchema = z.object({
  DATABASE_URL: z.url(),
});

export function dbEnv(source: EnvSource = process.env) {
  const env = parse("db", dbSchema, source);
  return { databaseUrl: env.DATABASE_URL };
}

const allowedEmails = z
  .string()
  .min(1)
  .transform((value) =>
    value
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  )
  .pipe(z.array(z.string()).min(1));

const authSchema = z.object({
  APP_URL: appUrl(),
  BETTER_AUTH_SECRET: z.string().min(16),
  ALLOWED_EMAILS: allowedEmails,
  GOOGLE_CLIENT_ID: nonEmpty(),
  GOOGLE_CLIENT_SECRET: nonEmpty(),
  GITHUB_APP_CLIENT_ID: nonEmpty(),
  GITHUB_APP_CLIENT_SECRET: nonEmpty(),
});

export function authEnv(source: EnvSource = process.env) {
  const env = parse("auth", authSchema, source);
  return {
    appUrl: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    allowedEmails: env.ALLOWED_EMAILS,
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
    github: {
      clientId: env.GITHUB_APP_CLIENT_ID,
      clientSecret: env.GITHUB_APP_CLIENT_SECRET,
    },
  };
}

const githubSchema = z.object({
  GITHUB_APP_ID: nonEmpty(),
  // Vercel の環境変数に 1 行で入れられるよう、"\n" (2 文字) を改行に戻す
  GITHUB_APP_PRIVATE_KEY: nonEmpty().transform((value) =>
    value.replace(/\\n/g, "\n"),
  ),
  GITHUB_WEBHOOK_SECRET: nonEmpty(),
});

export function githubEnv(source: EnvSource = process.env) {
  const env = parse("github", githubSchema, source);
  return {
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
  };
}

const asanaSchema = z.object({
  APP_URL: appUrl(),
  ASANA_PAT: nonEmpty(),
  ASANA_WORKSPACE_GID: nonEmpty(),
  ASANA_TEAM_GID: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export function asanaEnv(source: EnvSource = process.env): {
  appUrl: string;
  pat: string;
  workspaceGid: string;
  teamGid?: string;
} {
  const env = parse("asana", asanaSchema, source);
  return {
    appUrl: env.APP_URL,
    pat: env.ASANA_PAT,
    workspaceGid: env.ASANA_WORKSPACE_GID,
    teamGid: env.ASANA_TEAM_GID,
  };
}

const cronSchema = z.object({
  CRON_SECRET: z.string().min(16),
});

export function cronEnv(source: EnvSource = process.env) {
  const env = parse("cron", cronSchema, source);
  return { cronSecret: env.CRON_SECRET };
}
