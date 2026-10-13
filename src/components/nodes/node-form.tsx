"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { createNode, deleteNode, updateNode } from "@/app/(app)/nodes/actions";
import { kinds, kindIds, type KindId } from "@/lib/manifest/kinds";
import type { NodeCreateInput } from "@/lib/nodes/input";

// Node の登録と編集で共用するフォーム。登録は createNode、編集は updateNode、削除は deleteNode を呼ぶ。

type Target = { id: string; title: string };
type Blocker = "asana" | "devloop";
type RelationType = NodeCreateInput["relations"][number]["type"];
type Status = NodeCreateInput["status"];

const statusOptions = ["idea", "active", "maintenance", "archived"] as const;
const relationTypeOptions = [
  "uses",
  "depends-on",
  "derived-from",
  "part-of",
  "related",
] as const;

const inputClass =
  "w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const buttonClass =
  "rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";
const dangerButtonClass =
  "rounded border border-red-600 bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50 dark:border-red-500 dark:bg-red-700 dark:hover:bg-red-600";
const hintClass = "text-sm text-zinc-500 dark:text-zinc-400";

// 消せない理由の文言。理由があるときは「archived にする」案内を添える
const blockerMessages: Record<Blocker, string> = {
  asana: "Asana との対応があるため消せません",
  devloop: "devloop の記録があるため消せません",
};

export type MetaRow = { key: string; value: string; original: unknown; touched: boolean };
type LinkRow = { name: string; url: string };
type DiagramRow = { path: string; title: string };
type RelationRow = { type: RelationType; to: string };

type Props = {
  initial: NodeCreateInput;
  mode: "create" | "edit";
  targets: Target[];
  deletionBlockers?: Blocker[];
};

/** meta の値を入力欄に出す文字列に直す */
function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return String(value);
}

/** meta の初期値から行を作る。original は、触っていない行を元の値のまま送るために持つ */
export function metaRowsFrom(meta: Record<string, unknown>): MetaRow[] {
  return Object.entries(meta).map(([key, value]) => ({
    key,
    value: asText(value),
    original: value,
    touched: false,
  }));
}

/**
 * meta の行を送る形に組み立てる。文字列でない値は、触っていない行なら元の値のまま送る。
 * 触った行と文字列の値は今までどおり文字列として送り、空の値は送らない。
 */
export function buildMeta(rows: MetaRow[]): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key === "") continue;
    if (!row.touched && typeof row.original !== "string" && row.original !== undefined) {
      meta[key] = row.original;
      continue;
    }
    const value = row.value.trim();
    if (value === "") continue;
    meta[key] = value;
  }
  return meta;
}

/** kind ごとの meta のキーと説明 (ラベルに使う) */
function metaFields(kind: KindId): { key: string; description: string | null }[] {
  return Object.entries(kinds[kind].meta.shape).map(([key, schema]) => ({
    key,
    description: (schema as { description?: string }).description ?? null,
  }));
}

export function NodeForm({ initial, mode, targets, deletionBlockers = [] }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [id, setId] = useState(initial.id);
  const [kind, setKind] = useState<KindId>(initial.kind);
  const [title, setTitle] = useState(initial.title);
  const [summary, setSummary] = useState(initial.summary);
  const [status, setStatus] = useState<Status>(initial.status);
  const [tagsText, setTagsText] = useState(initial.tags.join(", "));
  const [links, setLinks] = useState<LinkRow[]>(() =>
    Object.entries(initial.links).map(([name, url]) => ({ name, url })),
  );
  const [detailPath, setDetailPath] = useState(initial.detailPath ?? "");
  const [diagrams, setDiagrams] = useState<DiagramRow[]>(() =>
    initial.diagrams.map((diagram) => ({ path: diagram.path, title: diagram.title ?? "" })),
  );
  const [relations, setRelations] = useState<RelationRow[]>(() =>
    initial.relations.map((relation) => ({ type: relation.type, to: relation.to })),
  );
  const [metaRows, setMetaRows] = useState<MetaRow[]>(() => metaRowsFrom(initial.meta));

  const hasRepo = initial.repo !== null;
  const fields = metaFields(kind);
  const knownKeys = new Set(fields.map((field) => field.key));
  const extraMetaRows = metaRows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !knownKeys.has(row.key));
  const selectableTargets = targets.filter((target) => target.id !== id);

  /** 決まった meta の欄の値を読む */
  function metaValue(key: string): string {
    return metaRows.find((row) => row.key === key)?.value ?? "";
  }

  /** 決まった meta の欄の値を書く (無ければ行を足す) */
  function setMetaValue(key: string, value: string) {
    setMetaRows((rows) => {
      const index = rows.findIndex((row) => row.key === key);
      if (index === -1) {
        return [...rows, { key, value, original: undefined, touched: true }];
      }
      return rows.map((row, i) => (i === index ? { ...row, value, touched: true } : row));
    });
  }

  /** 空の値は送らずに、フォームの値を Node の入力の形に組み立てる */
  function buildFields() {
    const tags = tagsText
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag !== "");

    const linksValue: Record<string, string> = {};
    for (const row of links) {
      const name = row.name.trim();
      const url = row.url.trim();
      if (name === "" || url === "") continue;
      linksValue[name] = url;
    }

    const meta = buildMeta(metaRows);

    const diagramValues = diagrams
      .map((row) => ({ path: row.path.trim(), title: row.title.trim() }))
      .filter((row) => row.path !== "")
      .map((row) => (row.title === "" ? { path: row.path } : { path: row.path, title: row.title }));

    const relationValues = relations
      .filter((row) => row.to !== "")
      .map((row) => ({ type: row.type, to: row.to }));

    return {
      kind,
      title,
      summary,
      status,
      tags,
      links: linksValue,
      meta,
      detailPath: hasRepo && detailPath.trim() !== "" ? detailPath.trim() : null,
      diagrams: hasRepo ? diagramValues : [],
      relations: relationValues,
    };
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const value = buildFields();
        if (mode === "create") {
          await createNode({ ...value, id, repo: initial.repo });
        } else {
          await updateNode(initial.id, value);
        }
        router.push("/nodes");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "失敗しました");
      }
    });
  }

  function removeNode() {
    if (pending) return;
    if (!window.confirm("この Node に向いた関係も消えます。削除しますか？")) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteNode(initial.id);
        router.push("/nodes");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "失敗しました");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {error !== null && (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <fieldset
        disabled={pending}
        className="space-y-4 rounded border border-zinc-200 p-4 disabled:opacity-60 dark:border-zinc-800"
      >
        <legend className="px-1 text-sm font-medium">基本</legend>
        {mode === "create" ? (
          <label className="block space-y-1 text-sm">
            <span>ID (英小文字・数字・ハイフン。登録のあとは変えられません)</span>
            <input
              required
              maxLength={63}
              pattern="[a-z0-9][a-z0-9-]*"
              value={id}
              onChange={(event) => setId(event.target.value)}
              className={`${inputClass} font-mono`}
            />
          </label>
        ) : (
          <p className="text-sm">
            ID: <span className="font-mono">{initial.id}</span> (変えられません)
          </p>
        )}
        <div className="space-y-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">リポジトリ</span>
          <p>{initial.repo?.fullName ?? "なし"}</p>
        </div>
        <label className="block space-y-1 text-sm">
          <span>種類</span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as KindId)}
            className={inputClass}
          >
            {kindIds.map((value) => (
              <option key={value} value={value}>
                {kinds[value].label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>タイトル</span>
          <input
            required
            maxLength={100}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>概要</span>
          <textarea
            maxLength={200}
            rows={3}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>状態</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as Status)}
            className={inputClass}
          >
            {statusOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>タグ (カンマ区切り)</span>
          <input
            value={tagsText}
            onChange={(event) => setTagsText(event.target.value)}
            className={inputClass}
          />
        </label>
      </fieldset>

      <fieldset
        disabled={pending}
        className="space-y-4 rounded border border-zinc-200 p-4 disabled:opacity-60 dark:border-zinc-800"
      >
        <legend className="px-1 text-sm font-medium">リンク</legend>
        <p className={hintClass}>
          名前と URL の組で並べます (例: repo と https://github.com/...)。
        </p>
        {links.map((row, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <input
              aria-label="リンクの名前"
              placeholder="名前"
              value={row.name}
              onChange={(event) => {
                const value = event.target.value;
                setLinks((rows) => rows.map((r, i) => (i === index ? { ...r, name: value } : r)));
              }}
              className={inputClass}
            />
            <input
              aria-label="リンクの URL"
              type="url"
              placeholder="https://..."
              value={row.url}
              onChange={(event) => {
                const value = event.target.value;
                setLinks((rows) => rows.map((r, i) => (i === index ? { ...r, url: value } : r)));
              }}
              className={inputClass}
            />
            <button
              type="button"
              className={buttonClass}
              onClick={() => setLinks((rows) => rows.filter((_, i) => i !== index))}
            >
              消す
            </button>
          </div>
        ))}
        <button
          type="button"
          className={buttonClass}
          onClick={() => setLinks((rows) => [...rows, { name: "", url: "" }])}
        >
          リンクを足す
        </button>
      </fieldset>

      {hasRepo && (
        <fieldset
          disabled={pending}
          className="space-y-4 rounded border border-zinc-200 p-4 disabled:opacity-60 dark:border-zinc-800"
        >
          <legend className="px-1 text-sm font-medium">詳細と図</legend>
          <label className="block space-y-1 text-sm">
            <span>詳細のパス (リポジトリ内の相対パス)</span>
            <input
              placeholder="例: README.md"
              value={detailPath}
              onChange={(event) => setDetailPath(event.target.value)}
              className={inputClass}
            />
          </label>
          <div className="space-y-2">
            <p className={hintClass}>図 (パスとタイトル)</p>
            {diagrams.map((row, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
                <input
                  aria-label="図のパス"
                  placeholder="例: docs/architecture.d2"
                  value={row.path}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDiagrams((rows) =>
                      rows.map((r, i) => (i === index ? { ...r, path: value } : r)),
                    );
                  }}
                  className={inputClass}
                />
                <input
                  aria-label="図のタイトル"
                  placeholder="タイトル (省略できます)"
                  value={row.title}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDiagrams((rows) =>
                      rows.map((r, i) => (i === index ? { ...r, title: value } : r)),
                    );
                  }}
                  className={inputClass}
                />
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => setDiagrams((rows) => rows.filter((_, i) => i !== index))}
                >
                  消す
                </button>
              </div>
            ))}
            <button
              type="button"
              className={buttonClass}
              onClick={() => setDiagrams((rows) => [...rows, { path: "", title: "" }])}
            >
              図を足す
            </button>
          </div>
        </fieldset>
      )}

      <fieldset
        disabled={pending}
        className="space-y-4 rounded border border-zinc-200 p-4 disabled:opacity-60 dark:border-zinc-800"
      >
        <legend className="px-1 text-sm font-medium">関係</legend>
        <p className={hintClass}>この Node から出る関係です。自分自身は選べません。</p>
        {relations.map((row, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <select
              aria-label="関係の種類"
              value={row.type}
              onChange={(event) => {
                const value = event.target.value as RelationType;
                setRelations((rows) =>
                  rows.map((r, i) => (i === index ? { ...r, type: value } : r)),
                );
              }}
              className={inputClass}
            >
              {relationTypeOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <select
              aria-label="関係の先の Node"
              value={row.to}
              onChange={(event) => {
                const value = event.target.value;
                setRelations((rows) => rows.map((r, i) => (i === index ? { ...r, to: value } : r)));
              }}
              className={inputClass}
            >
              <option value="">(選択してください)</option>
              {row.to !== "" && !selectableTargets.some((target) => target.id === row.to) && (
                <option value={row.to}>{row.to} (選択肢にありません)</option>
              )}
              {selectableTargets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.id} — {target.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={buttonClass}
              onClick={() => setRelations((rows) => rows.filter((_, i) => i !== index))}
            >
              消す
            </button>
          </div>
        ))}
        <button
          type="button"
          className={buttonClass}
          onClick={() =>
            setRelations((rows) => [...rows, { type: relationTypeOptions[0], to: "" }])
          }
        >
          関係を足す
        </button>
      </fieldset>

      <fieldset
        disabled={pending}
        className="space-y-4 rounded border border-zinc-200 p-4 disabled:opacity-60 dark:border-zinc-800"
      >
        <legend className="px-1 text-sm font-medium">meta ({kinds[kind].label})</legend>
        <p className={hintClass}>種類ごとの欄です。決まった欄に無いキーは下の行で足せます。</p>
        {fields.map((field) => (
          <label key={field.key} className="block space-y-1 text-sm">
            <span>
              {field.key}
              {field.description !== null ? ` (${field.description})` : ""}
            </span>
            <input
              value={metaValue(field.key)}
              onChange={(event) => setMetaValue(field.key, event.target.value)}
              className={inputClass}
            />
          </label>
        ))}
        {extraMetaRows.map(({ row, index }) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <input
              aria-label="meta のキー"
              placeholder="キー"
              value={row.key}
              onChange={(event) => {
                const value = event.target.value;
                setMetaRows((rows) =>
                  rows.map((r, i) => (i === index ? { ...r, key: value, touched: true } : r)),
                );
              }}
              className={inputClass}
            />
            <input
              aria-label="meta の値"
              placeholder="値"
              value={row.value}
              onChange={(event) => {
                const value = event.target.value;
                setMetaRows((rows) =>
                  rows.map((r, i) => (i === index ? { ...r, value, touched: true } : r)),
                );
              }}
              className={inputClass}
            />
            <button
              type="button"
              className={buttonClass}
              onClick={() => setMetaRows((rows) => rows.filter((_, i) => i !== index))}
            >
              消す
            </button>
          </div>
        ))}
        <button
          type="button"
          className={buttonClass}
          onClick={() =>
            setMetaRows((rows) => [...rows, { key: "", value: "", original: undefined, touched: false }])
          }
        >
          項目を足す
        </button>
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {pending ? "処理中..." : mode === "create" ? "登録する" : "保存する"}
        </button>
        <Link href="/nodes" className={buttonClass}>
          一覧に戻る
        </Link>
      </div>

      {mode === "edit" && (
        <fieldset
          disabled={pending}
          className="space-y-3 rounded border border-red-300 p-4 disabled:opacity-60 dark:border-red-900"
        >
          <legend className="px-1 text-sm font-medium">削除</legend>
          {deletionBlockers.length > 0 ? (
            <>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {deletionBlockers.map((blocker) => (
                  <li key={blocker}>{blockerMessages[blocker]}</li>
                ))}
              </ul>
              <p className={hintClass}>消す代わりに、状態を archived にすると一覧から外せます。</p>
            </>
          ) : (
            <p className={hintClass}>この Node を消します。この Node に向いた関係も消えます。</p>
          )}
          <button
            type="button"
            disabled={pending || deletionBlockers.length > 0}
            onClick={removeNode}
            className={dangerButtonClass}
          >
            削除
          </button>
        </fieldset>
      )}
    </form>
  );
}
