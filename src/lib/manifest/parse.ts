import { parse as parseYaml } from "yaml";
import type { z } from "zod";
import { kinds } from "./kinds";
import { NodeManifest } from "./schema";

export type ParseResult =
  | { ok: true; manifest: NodeManifest }
  | { ok: false; errors: string[] };

function formatIssues(
  issues: readonly z.core.$ZodIssue[],
  prefix: PropertyKey[] = [],
): string[] {
  return issues.map((issue) => {
    const path = [...prefix, ...issue.path];
    const where = path.length === 0 ? "(root)" : path.map(String).join(".");
    return `${where}: ${issue.message}`;
  });
}

export function parseManifest(yamlText: string): ParseResult {
  let data: unknown;
  try {
    data = parseYaml(yamlText);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, errors: [`(root): ${message}`] };
  }

  const base = NodeManifest.safeParse(data);
  if (!base.success) {
    return { ok: false, errors: formatIssues(base.error.issues) };
  }

  const manifest = base.data;
  const meta = kinds[manifest.kind].meta.safeParse(manifest.meta);
  if (!meta.success) {
    return { ok: false, errors: formatIssues(meta.error.issues, ["meta"]) };
  }

  return { ok: true, manifest: { ...manifest, meta: meta.data } };
}
