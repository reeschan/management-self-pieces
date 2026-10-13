import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

// 看板の項目の meta は、notes の末尾の印に YAML で保存する。
const MARKER_START = "<!-- devloop";
const MARKER_END = "-->";

export const ItemMetaSchema = z.object({
  id: z.string().regex(/^[SBDEC]-\d{4}$/),
  value: z.number().int().min(1).max(5).optional(),
  effort: z.number().int().min(1).max(5).optional(),
  confidence: z.number().min(0).max(1).optional(),
  hypothesis: z.string().max(500).optional(),
  measure: z.string().max(200).optional(),
  iteration: z.number().int().min(0).optional(),
  jev: z
    .object({
      value: z.number().optional(),
      effort: z.number().optional(),
      confidence: z.number().optional(),
    })
    .optional(),
});

export type ItemMeta = z.infer<typeof ItemMetaSchema>;

export const ITEM_TYPES = ["story", "bug", "debt", "experiment", "chore"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const ITEM_ORIGINS = ["pm", "biz", "tl", "owner"] as const;
export type ItemOrigin = (typeof ITEM_ORIGINS)[number];

const TYPE_PREFIX: Record<ItemType, string> = {
  story: "S",
  bug: "B",
  debt: "D",
  experiment: "E",
  chore: "C",
};

export function typeTag(type: ItemType): string {
  return type;
}

export function originTag(origin: ItemOrigin): string {
  return `from:${origin}`;
}

export function parseItemNotes(notes: string): {
  body: string;
  meta: ItemMeta | null;
  error: string | null;
} {
  const start = notes.lastIndexOf(MARKER_START);
  if (start === -1) {
    return { body: notes.trimEnd(), meta: null, error: null };
  }

  const innerStart = start + MARKER_START.length;
  const end = notes.indexOf(MARKER_END, innerStart);
  if (end === -1) {
    return {
      body: notes.slice(0, start).trimEnd(),
      meta: null,
      error: "devloop マーカーが閉じていない (-->)",
    };
  }

  const before = notes.slice(0, start).trimEnd();
  const after = notes.slice(end + MARKER_END.length).trim();
  const body = [before, after].filter((part) => part !== "").join("\n\n");
  const inner = notes.slice(innerStart, end);

  let raw: unknown;
  try {
    raw = parseYaml(inner);
  } catch {
    // YAML の例外には入力の抜粋が含まれるため、理由だけを返す。
    return { body, meta: null, error: "マーカーの YAML が壊れている" };
  }

  const result = ItemMetaSchema.safeParse(raw);
  if (!result.success) {
    return { body, meta: null, error: "マーカーの値が不正" };
  }

  return { body, meta: result.data, error: null };
}

// parse は最後の印を 1 個だけ外すので、残っている間は繰り返す。
function stripAllMarkers(notes: string): string {
  let current = notes;
  while (current.includes(MARKER_START)) {
    current = parseItemNotes(current).body;
  }
  return current;
}

export function buildItemNotes(body: string, meta: ItemMeta): string {
  const cleanBody = stripAllMarkers(body);
  const result = ItemMetaSchema.safeParse(meta);
  if (!result.success) {
    throw new Error("マーカーの値が不正");
  }

  // 文字列に含まれる終了の印が、YAML の途中で印を閉じないようにする。
  const safe: ItemMeta = { ...result.data };
  if (safe.hypothesis !== undefined) {
    safe.hypothesis = safe.hypothesis.replaceAll(MARKER_END, "-- >");
  }
  if (safe.measure !== undefined) {
    safe.measure = safe.measure.replaceAll(MARKER_END, "-- >");
  }

  const yaml = stringifyYaml(safe).trimEnd();
  const marker = `${MARKER_START}\n${yaml}\n${MARKER_END}`;
  return cleanBody === "" ? marker : `${cleanBody}\n\n${marker}`;
}

export function nextItemId(type: ItemType, existingIds: string[]): string {
  const prefix = TYPE_PREFIX[type];
  const pattern = new RegExp(`^${prefix}-(\\d{4})$`);
  let max = 0;
  for (const id of existingIds) {
    const match = pattern.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }

  const next = max + 1;
  if (next > 9999) {
    throw new Error(`${prefix} の id が 9999 を超えた`);
  }
  return `${prefix}-${String(next).padStart(4, "0")}`;
}
