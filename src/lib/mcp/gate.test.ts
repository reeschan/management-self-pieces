import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { agentTokens, ipAllowlist, mcpAuditLog, mcpRateLimits } from "@/db/schema";
import { createTestDb } from "@/test/pglite";

import { type GateContext, type GateResult, gateRequest } from "./gate";
import { addAllowlistEntry } from "./ip-allowlist";
import { RATE_LIMITS, windowStartOf } from "./rate-limit";
import { issueToken, revokeToken } from "./tokens";

const now = new Date("2026-10-13T00:30:00.000Z");
const ALLOWED_IP = "203.0.113.10";

function makeRequest(headers: Record<string, string>): Request {
  return new Request("https://app.example/api/mcp", { method: "POST", headers });
}

/** 弾かれた結果から応答を取り出す。通っていたらテストを失敗させる。 */
function rejectedResponse(result: GateResult): Response {
  if (result.ok) throw new Error("弾かれるはずが通った");
  return result.response;
}

describe("gateRequest", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  beforeEach(async () => {
    await testDb.db.delete(mcpAuditLog);
    await testDb.db.delete(mcpRateLimits);
    await testDb.db.delete(agentTokens);
    await testDb.db.delete(ipAllowlist);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  function hostCtx(clientIp: string | null): GateContext {
    return { db: testDb.db, mode: "host", clientIp, now };
  }

  function localCtx(): GateContext {
    return { db: testDb.db, mode: "local", clientIp: "127.0.0.1", now };
  }

  async function auditRows() {
    return testDb.db.select().from(mcpAuditLog);
  }

  /** 監査ログに rejected の行が 1 行だけあり、reason が一致することを確かめる。 */
  async function expectOneRejected(reason: string, mode: "local" | "host", ip: string | null) {
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      mode,
      tokenId: null,
      ip,
      tool: null,
      argsSummary: null,
      outcome: "rejected",
      reason,
      durationMs: null,
    });
    expect(rows[0].createdAt).toEqual(now);
  }

  async function expectForbidden(result: GateResult) {
    const response = rejectedResponse(result);
    expect(response.status).toBe(403);
    expect(await response.text()).toBe('{"error":"forbidden"}');
  }

  async function issue(scopes: ("read" | "board" | "loop")[] = ["read", "board"]) {
    return issueToken(testDb.db, { name: "agent", scopes, expiresAt: null, now });
  }

  describe("ホスト", () => {
    it("許可リストが空なら 403 で、トークンの確認と回数の記録に進まない", async () => {
      const token = await issue();
      const result = await gateRequest(
        makeRequest({ Authorization: `Bearer ${token.raw}` }),
        hostCtx(ALLOWED_IP),
      );
      await expectForbidden(result);
      await expectOneRejected("ip_not_allowed", "host", ALLOWED_IP);
      // 弾いた時点で止まる
      const [row] = await testDb.db.select().from(agentTokens);
      expect(row.lastUsedAt).toBeNull();
      expect(await testDb.db.select().from(mcpRateLimits)).toHaveLength(0);
    });

    it("許可リスト外の IP なら 403", async () => {
      await addAllowlistEntry(testDb.db, { cidr: "198.51.100.0/24", label: "社内" });
      const token = await issue();
      const result = await gateRequest(
        makeRequest({ Authorization: `Bearer ${token.raw}` }),
        hostCtx(ALLOWED_IP),
      );
      await expectForbidden(result);
      await expectOneRejected("ip_not_allowed", "host", ALLOWED_IP);
    });

    it("clientIp が null なら 403", async () => {
      await addAllowlistEntry(testDb.db, { cidr: "0.0.0.0/8", label: "全部" });
      const token = await issue();
      const result = await gateRequest(
        makeRequest({ Authorization: `Bearer ${token.raw}` }),
        hostCtx(null),
      );
      await expectForbidden(result);
      await expectOneRejected("ip_not_allowed", "host", null);
    });

    describe("許可された IP", () => {
      beforeEach(async () => {
        await addAllowlistEntry(testDb.db, { cidr: "203.0.113.0/24", label: "社内" });
      });

      async function expectUnauthorized(headers: Record<string, string>) {
        const result = await gateRequest(makeRequest(headers), hostCtx(ALLOWED_IP));
        const response = rejectedResponse(result);
        expect(response.status).toBe(401);
        expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
        expect(await response.text()).toBe('{"error":"unauthorized"}');
        await expectOneRejected("invalid_token", "host", ALLOWED_IP);
        // 弾いた時点で止まり、回数は記録しない
        expect(await testDb.db.select().from(mcpRateLimits)).toHaveLength(0);
      }

      it("トークン無しなら 401", async () => {
        await expectUnauthorized({});
      });

      it("Bearer の形でなければ 401", async () => {
        const token = await issue();
        await expectUnauthorized({ Authorization: `Basic ${token.raw}` });
      });

      it("不正なトークンなら 401", async () => {
        await issue();
        await expectUnauthorized({ Authorization: "Bearer msp_not-a-real-token" });
      });

      it("失効済みのトークンなら 401", async () => {
        const token = await issue();
        await revokeToken(testDb.db, token.id, now);
        await expectUnauthorized({ Authorization: `Bearer ${token.raw}` });
      });

      it("期限切れのトークンなら 401", async () => {
        const token = await issueToken(testDb.db, {
          name: "agent",
          scopes: ["read"],
          expiresAt: now,
          now: new Date("2026-10-12T00:00:00.000Z"),
        });
        await expectUnauthorized({ Authorization: `Bearer ${token.raw}` });
      });

      it("正しいトークンなら通り、scopes はトークンのものと一致する", async () => {
        const token = await issue(["read", "loop"]);
        const result = await gateRequest(
          makeRequest({ Authorization: `Bearer ${token.raw}` }),
          hostCtx(ALLOWED_IP),
        );
        expect(result).toEqual({ ok: true, tokenId: token.id, scopes: ["read", "loop"] });
        expect(await auditRows()).toHaveLength(0);
        expect(await testDb.db.select().from(mcpRateLimits)).toMatchObject([
          { tokenId: token.id, kind: "all", count: 1 },
        ]);
      });

      it("回数の上限を超えたら 429 で、Retry-After は今の窓が終わるまでの秒数", async () => {
        const token = await issue();
        // 上限まで使い切った状態を作る
        await testDb.db.insert(mcpRateLimits).values({
          tokenId: token.id,
          kind: "all",
          windowStart: windowStartOf(now),
          count: RATE_LIMITS.all,
        });
        const result = await gateRequest(
          makeRequest({ Authorization: `Bearer ${token.raw}` }),
          hostCtx(ALLOWED_IP),
        );
        const response = rejectedResponse(result);
        expect(response.status).toBe(429);
        expect(response.headers.get("Retry-After")).toBe("1800");
        expect(await response.text()).toBe('{"error":"too many requests"}');
        await expectOneRejected("rate_limited", "host", ALLOWED_IP);
      });

      it("上限ちょうどの回までは通る", async () => {
        const token = await issue();
        await testDb.db.insert(mcpRateLimits).values({
          tokenId: token.id,
          kind: "all",
          windowStart: windowStartOf(now),
          count: RATE_LIMITS.all - 1,
        });
        const result = await gateRequest(
          makeRequest({ Authorization: `Bearer ${token.raw}` }),
          hostCtx(ALLOWED_IP),
        );
        expect(result.ok).toBe(true);
      });
    });
  });

  describe("ローカル", () => {
    it("トークン無しで通り、scopes は 3 つ全部", async () => {
      const result = await gateRequest(makeRequest({ Host: "localhost:3000" }), localCtx());
      expect(result).toEqual({ ok: true, tokenId: null, scopes: ["read", "board", "loop"] });
      expect(await auditRows()).toHaveLength(0);
    });

    it.each(["localhost", "127.0.0.1:3000", "[::1]:3000", "[::1]", "LOCALHOST:3000"])(
      "Host: %s なら通る",
      async (host) => {
        const result = await gateRequest(makeRequest({ Host: host }), localCtx());
        expect(result.ok).toBe(true);
      },
    );

    it.each(["evil.example", "evil.example:3000", "localhost.evil.example", "localhost@evil.example", "[::2]:3000"])(
      "Host: %s なら 403",
      async (host) => {
        const result = await gateRequest(makeRequest({ Host: host }), localCtx());
        await expectForbidden(result);
        await expectOneRejected("bad_host", "local", "127.0.0.1");
      },
    );

    it("Host が無ければ 403", async () => {
      const result = await gateRequest(makeRequest({}), localCtx());
      await expectForbidden(result);
      await expectOneRejected("bad_host", "local", "127.0.0.1");
    });

    it.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"])(
      "Origin: %s なら通る",
      async (origin) => {
        const result = await gateRequest(
          makeRequest({ Host: "localhost:3000", Origin: origin }),
          localCtx(),
        );
        expect(result.ok).toBe(true);
      },
    );

    it.each(["https://evil.example", "null", "not a url", "http://localhost.evil.example"])(
      "Origin: %s なら 403",
      async (origin) => {
        const result = await gateRequest(
          makeRequest({ Host: "localhost:3000", Origin: origin }),
          localCtx(),
        );
        await expectForbidden(result);
        await expectOneRejected("bad_origin", "local", "127.0.0.1");
      },
    );
  });
});
