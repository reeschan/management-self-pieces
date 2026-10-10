import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth/server";

// モジュールの読み込み時には getAuth() を呼ばない (環境変数なしで build を通すため)。
export async function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request);
}
