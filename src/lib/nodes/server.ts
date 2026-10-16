import { getDb } from "@/db/client";
import { createRepoSource } from "@/lib/github/app";

import { createNodeService } from "./service";

/** サーバー側で Node のサービスを作る。DB と GitHub の口はここでつなぐ */
export function getNodeService() {
  return createNodeService({
    db: getDb(),
    source: createRepoSource,
    now: () => new Date(),
  });
}
