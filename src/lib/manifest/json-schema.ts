import { z } from "zod";
import { NodeManifest } from "./schema";

export const NODE_JSON_SCHEMA_ID = "/schema/node.json";

export function nodeJsonSchema() {
  return {
    ...z.toJSONSchema(NodeManifest, { io: "input" }),
    $id: NODE_JSON_SCHEMA_ID,
    title: "node.yaml",
  };
}
