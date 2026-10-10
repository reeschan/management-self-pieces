import { nodeJsonSchema } from "@/lib/manifest/json-schema";

// cacheComponents が有効なため `export const dynamic = "force-static"` は使えない。
// 実行時のデータに触れない GET はビルド時に静的に事前生成される。
export function GET() {
  return Response.json(nodeJsonSchema());
}
