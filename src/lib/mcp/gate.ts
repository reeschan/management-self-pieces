import type { AppDb } from "@/db/types";

import { recordAudit } from "./audit";
import { isIpAllowed } from "./ip-allowlist";
import { consumeRateLimit, windowStartOf } from "./rate-limit";
import { type Scope, verifyToken } from "./tokens";

export type GateContext = { db: AppDb; mode: "local" | "host"; clientIp: string | null; now: Date };
export type GateResult =
  | { ok: true; tokenId: string | null; scopes: Scope[] }
  | { ok: false; response: Response };

/** ローカルで許すホスト名。 */
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
/** ローカルで通したときの権限 (すべて)。 */
const LOCAL_SCOPES: Scope[] = ["read", "board", "loop"];
/** レート制限の窓の長さ (ミリ秒)。rate-limit.ts の窓 (UTC の正時ごと) に合わせる。 */
const WINDOW_MS = 60 * 60 * 1000;

type RejectReason =
  | "ip_not_allowed"
  | "invalid_token"
  | "rate_limited"
  | "bad_host"
  | "bad_origin";

/** 固定の本文で JSON の応答を作る。理由の区別は本文に出さない。 */
function jsonResponse(status: number, error: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** 弾いた理由を監査ログに残し、応答を返す。 */
async function reject(
  ctx: GateContext,
  reason: RejectReason,
  response: Response,
): Promise<GateResult> {
  await recordAudit(ctx.db, {
    mode: ctx.mode,
    tokenId: null,
    ip: ctx.clientIp,
    tool: null,
    argsSummary: null,
    outcome: "rejected",
    reason,
    durationMs: null,
    now: ctx.now,
  });
  return { ok: false, response };
}

/** `Authorization: Bearer <値>` から値を取り出す。形が違えば null。 */
function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (header === null) return null;
  const match = /^Bearer[ ]+(\S+)[ ]*$/i.exec(header);
  return match ? match[1] : null;
}

/**
 * Host ヘッダーの値からホスト名を取り出す (ポートは除く)。
 * `[::1]:3000` のような IPv6 の形も扱う。形が崩れていれば null。
 */
function hostnameFromHostHeader(value: string): string | null {
  const host = value.trim().toLowerCase();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end < 0) return null;
    const rest = host.slice(end + 1);
    if (rest !== "" && !/^:\d{1,5}$/.test(rest)) return null;
    return host.slice(1, end);
  }
  const match = /^([^:/?#@\s[\]]+)(?::\d{1,5})?$/.exec(host);
  return match ? match[1] : null;
}

/** Origin ヘッダーの値からホスト名を取り出す。URL として読めない・http(s) でなければ null。 */
function hostnameFromOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const hostname = url.hostname.toLowerCase();
  // URL は IPv6 のホスト名を角括弧付きで返すので外す
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function isLocalHostname(hostname: string | null): boolean {
  return hostname !== null && LOCAL_HOSTNAMES.has(hostname);
}

/** ホストでの判定。IP 許可リスト → トークン → 回数の上限 の順。弾いたらそこで止める。 */
async function gateHost(req: Request, ctx: GateContext): Promise<GateResult> {
  // 1. IP 許可リスト
  if (ctx.clientIp === null || !(await isIpAllowed(ctx.db, ctx.clientIp))) {
    return reject(ctx, "ip_not_allowed", jsonResponse(403, "forbidden"));
  }

  // 2. エージェント用トークン
  const raw = bearerToken(req);
  const token = raw === null ? null : await verifyToken(ctx.db, raw, ctx.now);
  if (token === null) {
    return reject(
      ctx,
      "invalid_token",
      jsonResponse(401, "unauthorized", { "WWW-Authenticate": "Bearer" }),
    );
  }

  // 3. 回数の上限
  const limit = await consumeRateLimit(ctx.db, { tokenId: token.id, kind: "all", now: ctx.now });
  if (!limit.allowed) {
    const windowEnd = windowStartOf(ctx.now).getTime() + WINDOW_MS;
    const retryAfter = Math.max(1, Math.ceil((windowEnd - ctx.now.getTime()) / 1000));
    return reject(
      ctx,
      "rate_limited",
      jsonResponse(429, "too many requests", { "Retry-After": String(retryAfter) }),
    );
  }

  return { ok: true, tokenId: token.id, scopes: token.scopes };
}

/** ローカルでの判定。トークンと IP は見ず、Host と Origin だけを確かめる。 */
async function gateLocal(req: Request, ctx: GateContext): Promise<GateResult> {
  // 1. Host (ブラウザ経由の DNS リバインディング対策)
  const host = req.headers.get("host");
  if (host === null || !isLocalHostname(hostnameFromHostHeader(host))) {
    return reject(ctx, "bad_host", jsonResponse(403, "forbidden"));
  }

  // 2. Origin (別のサイトから localhost を叩かれるのを防ぐ)
  const origin = req.headers.get("origin");
  if (origin !== null && !isLocalHostname(hostnameFromOrigin(origin))) {
    return reject(ctx, "bad_origin", jsonResponse(403, "forbidden"));
  }

  return { ok: true, tokenId: null, scopes: [...LOCAL_SCOPES] };
}

/**
 * MCP の口に来たリクエストを、ツールを動かす前に通してよいか決める。
 * 弾いたときは理由を監査ログに残し、固定の本文の応答を返す。
 */
export async function gateRequest(req: Request, ctx: GateContext): Promise<GateResult> {
  return ctx.mode === "host" ? gateHost(req, ctx) : gateLocal(req, ctx);
}
