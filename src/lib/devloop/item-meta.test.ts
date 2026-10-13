import { describe, expect, test } from "vitest";
import {
  ITEM_ORIGINS,
  ITEM_TYPES,
  ItemMetaSchema,
  buildItemNotes,
  nextItemId,
  originTag,
  parseItemNotes,
  typeTag,
  type ItemMeta,
} from "./item-meta";

describe("項目の種類と出どころ", () => {
  test("種類をそのままタグにする", () => {
    expect(ITEM_TYPES.map(typeTag)).toEqual([
      "story", "bug", "debt", "experiment", "chore",
    ]);
  });

  test("出どころに from: を付ける", () => {
    expect(ITEM_ORIGINS.map(originTag)).toEqual([
      "from:pm", "from:biz", "from:tl", "from:owner",
    ]);
  });
});

describe("項目の meta の読み書き", () => {
  const meta: ItemMeta = {
    id: "S-0042",
    value: 3,
    effort: 2,
    confidence: 0.8,
    hypothesis: "入力を減らすと\n登録が増える",
    measure: "登録件数: 週ごとに比較",
    iteration: 0,
    jev: { value: 4.5, effort: 2, confidence: 0.9 },
  };

  test.each(["", "本文", "  本文\n\n続き"])(
    "build → parse で本文 %j とすべての meta が戻る",
    (body) => {
      expect(parseItemNotes(buildItemNotes(body, meta))).toEqual({
        body, meta, error: null,
      });
    },
  );

  test("id だけの meta も読み書きできる", () => {
    expect(parseItemNotes(buildItemNotes("本文", { id: "B-0001" }))).toEqual({
      body: "本文", meta: { id: "B-0001" }, error: null,
    });
  });

  test.each(["", "本文", "本文  \n"])(
    "印がない本文 %j は末尾の空白だけを除く",
    (notes) => {
      expect(parseItemNotes(notes)).toEqual({
        body: notes.trimEnd(), meta: null, error: null,
      });
    },
  );

  test.each([
    ["<!-- devloop\nid: S-0001", "devloop マーカーが閉じていない (-->)"],
    ["<!-- devloop\nid: [秘密の入力\n-->", "マーカーの YAML が壊れている"],
    ["<!-- devloop\nid: S-0001\nvalue: 6\n-->", "マーカーの値が不正"],
    ["<!-- devloop\n-->", "マーカーの値が不正"],
  ])("不正な印 %j は meta を返さず理由を返す", (marker, error) => {
    expect(parseItemNotes(`本文\n\n${marker}`)).toEqual({
      body: "本文", meta: null, error,
    });
  });

  test("印の後に書かれた本文も残す", () => {
    expect(parseItemNotes("前\n\n<!-- devloop\nid: D-0001\n-->\n 後 \n"))
      .toEqual({ body: "前\n\n後", meta: { id: "D-0001" }, error: null });
  });

  test("印が複数あると最後だけを読む", () => {
    const first = "本文\n\n<!-- devloop\nid: S-0001\n-->";
    expect(parseItemNotes(`${first}\n\n<!-- devloop\nid: B-0002\n-->`))
      .toEqual({ body: first, meta: { id: "B-0002" }, error: null });
  });

  test("最後の印が不正でも前の meta に戻らない", () => {
    const first = "本文\n\n<!-- devloop\nid: S-0001\n-->";
    expect(parseItemNotes(`${first}\n\n<!-- devloop\nid: B-0002`))
      .toEqual({
        body: first, meta: null,
        error: "devloop マーカーが閉じていない (-->)",
      });
  });

  test.each([
    "<!-- devloop\nid: B-0002\n-->",
    "<!-- devloop\nid: [壊れた値\n-->",
    "<!-- devloop\nid: B-0002",
  ])("build は既存の印をすべて外して 1 つにする: %j", (last) => {
    const body = `前\n\n<!-- devloop\nid: S-0001\n-->\n\n後\n\n${last}`;
    const notes = buildItemNotes(body, meta);
    expect(notes.match(/<!-- devloop/g)).toHaveLength(1);
    expect(parseItemNotes(notes)).toEqual({ body: "前\n\n後", meta, error: null });
    expect(buildItemNotes(notes, meta)).toBe(notes);
  });

  test("仮説と測り方の --> をすべて置き換え、入力を変更しない", () => {
    const input: ItemMeta = {
      id: "E-0001",
      hypothesis: "前 --> 中 --> 後",
      measure: "件数 --> 比較",
    };
    const notes = buildItemNotes("本文", input);
    expect(notes.match(/-->/g)).toHaveLength(1);
    expect(parseItemNotes(notes)).toEqual({
      body: "本文",
      meta: {
        id: "E-0001", hypothesis: "前 -- > 中 -- > 後", measure: "件数 -- > 比較",
      },
      error: null,
    });
    expect(input.hypothesis).toBe("前 --> 中 --> 後");
    expect(input.measure).toBe("件数 --> 比較");
  });

  test("build でもスキーマ違反を拒否する", () => {
    expect(() => buildItemNotes("本文", { id: "不正な ID" }))
      .toThrow("マーカーの値が不正");
  });
});

describe("ItemMetaSchema", () => {
  test("各値の境界と任意の Jev 採点を受け付ける", () => {
    for (const confidence of [0, 1]) {
      expect(ItemMetaSchema.safeParse({
        id: "C-9999", value: 1, effort: 5, confidence,
        hypothesis: "あ".repeat(500), measure: "あ".repeat(200), iteration: 0,
        jev: { value: -1, effort: 1.5, confidence: 2 },
      }).success).toBe(true);
    }
  });

  test.each([
    { id: "X-0001" }, { id: "S-001" }, { id: "S-10000" },
    { value: 0 }, { value: 6 }, { value: 1.5 },
    { effort: 0 }, { effort: 6 }, { effort: 1.5 },
    { confidence: -0.1 }, { confidence: 1.1 },
    { hypothesis: "あ".repeat(501) }, { measure: "あ".repeat(201) },
    { iteration: -1 }, { iteration: 0.5 }, { jev: { value: "3" } },
  ])("スキーマ違反を拒否する: %#", (invalid) => {
    expect(ItemMetaSchema.safeParse({ id: "S-0001", ...invalid }).success).toBe(false);
  });

  test("未知のキーを捨てる", () => {
    expect(ItemMetaSchema.parse({
      id: "S-0001", unknown: true, jev: { value: 3, unknown: true },
    })).toEqual({ id: "S-0001", jev: { value: 3 } });
  });
});

describe("nextItemId", () => {
  test.each([
    ["story", "S"], ["bug", "B"], ["debt", "D"],
    ["experiment", "E"], ["chore", "C"],
  ] as const)("%s は %s の連番を振る", (type, prefix) => {
    expect(nextItemId(type, [])).toBe(`${prefix}-0001`);
    expect(nextItemId(type, [
      `${prefix}-0042`, `${prefix}-0001`, `${prefix}-0010`, `${prefix}-0042`,
    ])).toBe(`${prefix}-0043`);
    expect(nextItemId(type, [`${prefix}-9998`])).toBe(`${prefix}-9999`);
    expect(() => nextItemId(type, [`${prefix}-9999`]))
      .toThrow(`${prefix} の id が 9999 を超えた`);
  });

  test("別の種類と形式の違う ID は数えない", () => {
    expect(nextItemId("story", [
      "B-9999", "D-9999", "E-9999", "C-9999", "s-9999",
      "S-999", "S-10000", " S-9999", "S-9999余分", "S-0009", "S-0000",
    ])).toBe("S-0010");
  });
});
