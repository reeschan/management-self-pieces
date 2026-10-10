import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { parseManifest } from "@/lib/manifest/parse";

const dir = path.join(process.cwd(), "fixtures");
const files = readdirSync(dir).filter((name) => name.endsWith(".yaml"));

describe("fixtures", () => {
  test("サンプルが 1 件以上ある", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files)("%s は parseManifest を通り、id がファイル名と一致する", (name) => {
    const result = parseManifest(readFileSync(path.join(dir, name), "utf8"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.id).toBe(name.replace(/\.yaml$/, ""));
  });
});
