import { describe, expect, test } from "vitest";
import { asanaEnv, authEnv, cronEnv, dbEnv, EnvError, githubEnv } from "./env";

const authSource = {
  APP_URL: "https://example.com/",
  BETTER_AUTH_SECRET: "super-secret-value-1234567890",
  ALLOWED_EMAILS: "me@example.com",
  GOOGLE_CLIENT_ID: "google-id",
  GOOGLE_CLIENT_SECRET: "google-secret-xyz",
  GITHUB_APP_CLIENT_ID: "github-id",
  GITHUB_APP_CLIENT_SECRET: "github-secret-xyz",
};

function catchError(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error("例外が投げられなかった");
}

describe("dbEnv", () => {
  test("正しい入力で databaseUrl を返す", () => {
    expect(
      dbEnv({ DATABASE_URL: "postgres://user:pass@host:5432/db" }),
    ).toEqual({ databaseUrl: "postgres://user:pass@host:5432/db" });
  });

  test("DATABASE_URL が無いと EnvError", () => {
    const error = catchError(() => dbEnv({}));
    expect(error).toBeInstanceOf(EnvError);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("DATABASE_URL");
  });

  test("URL でなければ EnvError で、値はメッセージに含まれない", () => {
    const error = catchError(() => dbEnv({ DATABASE_URL: "not a url secret" }));
    expect(error).toBeInstanceOf(EnvError);
    expect(error.message).toContain("DATABASE_URL");
    expect(error.message).not.toContain("not a url secret");
  });
});

describe("authEnv", () => {
  test("正しい入力で期待どおりの値を返す", () => {
    expect(authEnv(authSource)).toEqual({
      appUrl: "https://example.com",
      secret: "super-secret-value-1234567890",
      allowedEmails: ["me@example.com"],
      google: { clientId: "google-id", clientSecret: "google-secret-xyz" },
      github: { clientId: "github-id", clientSecret: "github-secret-xyz" },
    });
  });

  test("ALLOWED_EMAILS を分割・trim・小文字化し、空要素を捨てる", () => {
    const env = authEnv({
      ...authSource,
      ALLOWED_EMAILS: " A@x.com, ,b@Y.com ",
    });
    expect(env.allowedEmails).toEqual(["a@x.com", "b@y.com"]);
  });

  test("ALLOWED_EMAILS が 0 件なら EnvError", () => {
    const error = catchError(() =>
      authEnv({ ...authSource, ALLOWED_EMAILS: " , ," }),
    );
    expect(error).toBeInstanceOf(EnvError);
    expect(error.message).toContain("ALLOWED_EMAILS");
  });

  test("BETTER_AUTH_SECRET が 16 文字未満なら EnvError", () => {
    const error = catchError(() =>
      authEnv({ ...authSource, BETTER_AUTH_SECRET: "short" }),
    );
    expect(error).toBeInstanceOf(EnvError);
    expect(error.message).toContain("BETTER_AUTH_SECRET");
    expect(error.message).not.toContain("short");
  });

  test("欠けたキーをすべてメッセージに含め、他の値は含めない", () => {
    const { GOOGLE_CLIENT_ID, GITHUB_APP_CLIENT_SECRET, ...rest } = authSource;
    void GOOGLE_CLIENT_ID;
    void GITHUB_APP_CLIENT_SECRET;
    const error = catchError(() => authEnv(rest));
    expect(error).toBeInstanceOf(EnvError);
    expect(error.message).toContain("GOOGLE_CLIENT_ID");
    expect(error.message).toContain("GITHUB_APP_CLIENT_SECRET");
    expect(error.message).not.toContain("super-secret-value-1234567890");
    expect(error.message).not.toContain("google-secret-xyz");
    expect(error.message).not.toContain("me@example.com");
  });

  test("空文字は不可", () => {
    const error = catchError(() =>
      authEnv({ ...authSource, GOOGLE_CLIENT_ID: "" }),
    );
    expect(error).toBeInstanceOf(EnvError);
    expect(error.message).toContain("GOOGLE_CLIENT_ID");
  });
});

describe("githubEnv", () => {
  test("正しい入力で期待どおりの値を返し、\\n を改行に置き換える", () => {
    expect(
      githubEnv({
        GITHUB_APP_ID: "12345",
        GITHUB_APP_PRIVATE_KEY:
          "-----BEGIN KEY-----\\nabc\\ndef\\n-----END KEY-----",
        GITHUB_WEBHOOK_SECRET: "hook-secret",
      }),
    ).toEqual({
      appId: "12345",
      privateKey: "-----BEGIN KEY-----\nabc\ndef\n-----END KEY-----",
      webhookSecret: "hook-secret",
    });
  });

  test("キーが欠けていると EnvError で、秘密の値は含まれない", () => {
    const error = catchError(() =>
      githubEnv({ GITHUB_APP_ID: "12345", GITHUB_WEBHOOK_SECRET: "hook-secret-zzz" }),
    );
    expect(error).toBeInstanceOf(EnvError);
    expect(error.message).toContain("GITHUB_APP_PRIVATE_KEY");
    expect(error.message).not.toContain("hook-secret-zzz");
  });
});

describe("asanaEnv", () => {
  const asanaSource = {
    APP_URL: "https://example.com",
    ASANA_PAT: "asana-pat-secret",
    ASANA_WORKSPACE_GID: "111",
  };

  test("正しい入力で期待どおりの値を返す", () => {
    expect(asanaEnv({ ...asanaSource, ASANA_TEAM_GID: "222" })).toEqual({
      appUrl: "https://example.com",
      pat: "asana-pat-secret",
      workspaceGid: "111",
      teamGid: "222",
    });
  });

  test("ASANA_TEAM_GID が未設定か空なら teamGid は undefined", () => {
    expect(asanaEnv(asanaSource).teamGid).toBeUndefined();
    expect(asanaEnv({ ...asanaSource, ASANA_TEAM_GID: "" }).teamGid).toBeUndefined();
  });

  test("キーが欠けていると EnvError で、秘密の値は含まれない", () => {
    const error = catchError(() =>
      asanaEnv({ ASANA_PAT: "asana-pat-secret" }),
    );
    expect(error).toBeInstanceOf(EnvError);
    expect(error.message).toContain("APP_URL");
    expect(error.message).toContain("ASANA_WORKSPACE_GID");
    expect(error.message).not.toContain("asana-pat-secret");
  });
});

describe("cronEnv", () => {
  test("正しい入力で cronSecret を返す", () => {
    expect(cronEnv({ CRON_SECRET: "cron-secret-0123456789" })).toEqual({
      cronSecret: "cron-secret-0123456789",
    });
  });

  test("CRON_SECRET が無い・短いと EnvError", () => {
    expect(() => cronEnv({})).toThrow(EnvError);
    const error = catchError(() => cronEnv({ CRON_SECRET: "tooshort" }));
    expect(error).toBeInstanceOf(EnvError);
    expect(error.message).toContain("CRON_SECRET");
    expect(error.message).not.toContain("tooshort");
  });
});
