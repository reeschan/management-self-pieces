import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { nodes } from "@/db/schema";
import { getSession } from "@/lib/auth/server";
import { createRepoSource } from "@/lib/github/app";
import {
  assetKindOf,
  contentTypeOf,
  isAllowedAsset,
  isGithubSource,
} from "@/lib/nodes/asset";

function notFound() {
  return Response.json({ error: "not found" }, { status: 404 });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (session === null) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const path = new URL(req.url).searchParams.get("path");
  if (!path) return notFound();

  try {
    const [node] = await getDb()
      .select({
        detailPath: nodes.detailPath,
        diagrams: nodes.diagrams,
        sourceRepo: nodes.sourceRepo,
      })
      .from(nodes)
      .where(eq(nodes.id, id))
      .limit(1);
    if (!node) return notFound();
    // node.yaml に書かれた detail と diagrams のパス以外は読ませない
    if (!isAllowedAsset(node, path)) return notFound();
    if (!isGithubSource(node.sourceRepo)) return notFound();
    const kind = assetKindOf(path);
    if (kind === null) return notFound();

    const source = createRepoSource();
    const repo = await source.getRepo(node.sourceRepo);
    if (repo === null) return notFound();
    const file = await source.getRawFile(
      node.sourceRepo,
      path,
      repo.defaultBranch,
    );
    if (file === null) return notFound();

    const headers = new Headers({
      "Content-Type": contentTypeOf(kind),
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    });
    if (kind === "svg") {
      // SVG 内のスクリプトを動かさない
      headers.set(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      );
    }
    return new Response(file.bytes as BodyInit, { status: 200, headers });
  } catch (error) {
    console.error("[api:nodes:asset] failed to read asset", error);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
