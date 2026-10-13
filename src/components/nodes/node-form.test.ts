import { describe, expect, it } from "vitest";

import { buildMeta, metaRowsFrom } from "./node-form";

describe("buildMeta", () => {
  // 差し戻しの再現: 何も変えずに編集を保存したとき、meta が保存前と完全に同じになる
  it("触っていない行の文字列でない値を元の値のまま返す", () => {
    const meta = {
      url: "https://example.com",
      stars: 5,
      flags: ["a"],
      extra: { a: 1 },
    };
    expect(buildMeta(metaRowsFrom(meta))).toEqual(meta);
  });

  it("null・真偽・数値も元の値のまま返す", () => {
    const meta = { empty: null, enabled: false, ratio: 0.5 };
    expect(buildMeta(metaRowsFrom(meta))).toEqual(meta);
  });

  it("触った行は文字列として送り、空の値は送らない", () => {
    const rows = metaRowsFrom({ stars: 5, note: " " });
    rows[0].value = "6";
    rows[0].touched = true;
    expect(buildMeta(rows)).toEqual({ stars: "6" });
  });
});
