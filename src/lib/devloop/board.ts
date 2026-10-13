import { and, eq } from "drizzle-orm";

import { externalRefs } from "@/db/schema";
import type { AppDb } from "@/db/types";
import type {
  TrackerComment,
  TrackerProvider,
  TrackerTask,
  TrackerTaskDetail,
} from "@/lib/tracker/types";

import {
  buildItemNotes,
  type ItemMeta,
  type ItemOrigin,
  type ItemType,
  nextItemId,
  originTag,
  parseItemNotes,
  typeTag,
} from "./item-meta";
import { findCachedItem, saveTaskCache } from "./task-cache";

// 看板 (Asana の 1 プロジェクト) の操作を 1 か所にまとめる。MCP のツールと画面の両方から使う。
// WIP や提案数の上限はここで強制する (エージェントがルールを破れないように)。
// 書き込みの後は、その Node の写し (task_cache) を読み直して最新に保つ。

const PROVIDER = "asana";

/** 持ち主が画面から答えたコメントに付ける印 */
const OWNER_MARK = "[from:owner]";

/**
 * アプリがアプリとして付けるコメント (commentItem・requestOwner) に付ける印。
 * アプリは持ち主の PAT で書き込むので作成者が持ち主になる。この印で持ち主の回答と見分ける。
 */
const APP_MARK = "[devloop]";

export const SECTIONS = [
  "Inbox",
  "Backlog",
  "Sprint",
  "In Progress",
  "Biz Review",
  "Done",
  "Owner 判断",
  "Rejected",
] as const;

export type Section = (typeof SECTIONS)[number];

const OWNER_SECTION: Section = "Owner 判断";

export const LIMITS = { inbox: 15, bizProposalsPerIteration: 3 } as const;

export const DEFAULT_SPRINT_LIMIT = 6;

export type BoardLimitCode = "inbox_full" | "biz_proposal_limit" | "sprint_full";

export class BoardLimitError extends Error {
  readonly code: BoardLimitCode;

  constructor(code: BoardLimitCode, message?: string) {
    super(message ?? code);
    this.name = "BoardLimitError";
    this.code = code;
  }
}

export type BoardErrorCode = "not_linked" | "not_found" | "node_mismatch";

export class BoardError extends Error {
  readonly code: BoardErrorCode;

  constructor(code: BoardErrorCode, message?: string) {
    super(message ?? code);
    this.name = "BoardError";
    this.code = code;
  }
}

export type OwnerComment = { text: string; createdAt: string };

export type BoardItem = {
  id: string;
  name: string;
  /** 列の名前。どの列にも属さないときは null */
  section: string | null;
  tags: string[];
  meta: ItemMeta | null;
  metaError: string | null;
  body: string;
  url: string | null;
  completed: boolean;
  /** Owner のコメント。「Owner 判断」の列の項目だけ読む。他の列は空配列 */
  ownerComments: OwnerComment[];
};

export type BoardColumn = { section: string; items: BoardItem[] };

export type Board = {
  projectId: string;
  /**
   * 既定は SECTIONS の順で、看板に無い名前の列 (Asana の既定の列など) は後ろに付ける。
   * sections を指定したときは、その列だけを指定の順で返す。
   */
  columns: BoardColumn[];
};

export type CreateItemInput = {
  section: Section;
  name: string;
  body: string;
  type: ItemType;
  origin: ItemOrigin;
  /** id が無ければ nextItemId で振る */
  meta?: Omit<ItemMeta, "id"> & { id?: string };
  sprintLimit?: number;
};

export type UpdateItemPatch = {
  /** 渡されたら、項目の Node と一致するかを確かめる */
  nodeId?: string;
  name?: string;
  body?: string;
  /** 丸ごと置き換える (前の meta のキーは残らない) */
  meta?: ItemMeta;
};

export type BoardServiceDeps = {
  db: AppDb;
  tracker: TrackerProvider;
  /** 持ち主の Asana のユーザー gid (ASANA_OWNER_GID) */
  ownerAssigneeId?: string;
  now?: () => Date;
};

export function isSection(name: string): name is Section {
  // 日本語を含むので完全一致で比べる
  return (SECTIONS as readonly string[]).includes(name);
}

function assertSection(name: string): asserts name is Section {
  if (!isSection(name)) throw new Error(`未知の列: ${name}`);
}

function toBoardItem(
  t: TrackerTaskDetail,
  ownerComments: OwnerComment[] = [],
): BoardItem {
  const parsed = parseItemNotes(t.notes);
  return {
    id: t.externalId,
    name: t.name,
    section: t.sectionName,
    tags: t.tags,
    meta: parsed.meta,
    metaError: parsed.error,
    body: parsed.body,
    url: t.url,
    completed: t.completed,
    ownerComments,
  };
}

function groupColumns(items: BoardItem[], sections?: Section[]): BoardColumn[] {
  if (sections !== undefined) {
    const wanted = [...new Set(sections)];
    return wanted.map((section) => ({
      section,
      items: items.filter((item) => item.section === section),
    }));
  }

  const columns = new Map<string, BoardItem[]>(SECTIONS.map((s) => [s, []]));
  const others = new Map<string, BoardItem[]>();
  for (const item of items) {
    const key = item.section ?? "";
    const list = columns.get(key) ?? others.get(key);
    if (list) {
      list.push(item);
    } else {
      others.set(key, [item]);
    }
  }
  return [...columns, ...others].map(([section, list]) => ({
    section,
    items: list,
  }));
}

function countInSection(
  tasks: TrackerTaskDetail[],
  section: Section,
  excludeId?: string,
): number {
  return tasks.filter(
    (t) => t.sectionName === section && t.externalId !== excludeId,
  ).length;
}

export function createBoardService(deps: BoardServiceDeps) {
  const { db, tracker, ownerAssigneeId } = deps;
  const now = deps.now ?? (() => new Date());

  function isOwnerComment(comment: TrackerComment): boolean {
    // アプリが付けたコメントは、作成者が持ち主でも Owner のコメントとみなさない
    if (comment.text.trim().startsWith(APP_MARK)) return false;
    if (ownerAssigneeId !== undefined && comment.authorId === ownerAssigneeId) {
      return true;
    }
    return comment.text.startsWith(OWNER_MARK);
  }

  async function findProjectId(nodeId: string): Promise<string | null> {
    const rows = await db
      .select({ externalId: externalRefs.externalId })
      .from(externalRefs)
      .where(
        and(eq(externalRefs.nodeId, nodeId), eq(externalRefs.provider, PROVIDER)),
      )
      .limit(1);
    return rows[0]?.externalId ?? null;
  }

  async function requireProjectId(nodeId: string): Promise<string> {
    const projectId = await findProjectId(nodeId);
    if (!projectId) {
      throw new BoardError("not_linked", "この Node は Asana につながっていない");
    }
    return projectId;
  }

  /** Asana から読み直して写しを入れ直し、読んだ内容を返す */
  async function refreshCache(
    nodeId: string,
    projectId: string,
  ): Promise<TrackerTaskDetail[]> {
    const details = await tracker.listTaskDetails(projectId);
    await saveTaskCache(db, { nodeId, projectId, details, now: now() });
    return details;
  }

  async function ensureSectionMap(
    projectId: string,
  ): Promise<{ map: Map<Section, string>; created: Section[] }> {
    const existing = await tracker.listSections(projectId);
    const map = new Map<Section, string>();
    for (const s of existing) {
      if (isSection(s.name) && !map.has(s.name)) map.set(s.name, s.externalId);
    }
    const created: Section[] = [];
    for (const name of SECTIONS) {
      if (map.has(name)) continue;
      const section = await tracker.createSection(projectId, name);
      map.set(name, section.externalId);
      created.push(name);
    }
    return { map, created };
  }

  async function sectionGid(projectId: string, section: Section): Promise<string> {
    const gid = (await ensureSectionMap(projectId)).map.get(section);
    if (gid === undefined) throw new Error(`列 ${section} が見つからない`);
    return gid;
  }

  /** 足りない列 (セクション) を作る。作った列の名前を返す */
  async function ensureSections(
    nodeId: string,
  ): Promise<{ projectId: string; created: Section[] }> {
    const projectId = await requireProjectId(nodeId);
    const { created } = await ensureSectionMap(projectId);
    return { projectId, created };
  }

  /**
   * 項目が属する Node を写しから引く。写しに無く nodeId が渡されていれば、
   * その Node の写しを読み直してもう一度引く。
   */
  async function resolveItemNode(itemId: string, nodeId?: string): Promise<string> {
    let cached = await findCachedItem(db, itemId);
    if (cached === null && nodeId !== undefined) {
      const projectId = await requireProjectId(nodeId);
      await refreshCache(nodeId, projectId);
      cached = await findCachedItem(db, itemId);
    }
    if (cached === null) {
      throw new BoardError("not_found", "項目が見つからない");
    }
    if (nodeId !== undefined && cached.nodeId !== nodeId) {
      throw new BoardError("node_mismatch", "項目はこの Node に属していない");
    }
    return cached.nodeId;
  }

  async function getBoard(
    nodeId: string,
    opts?: { sections?: Section[] },
  ): Promise<Board> {
    const projectId = await requireProjectId(nodeId);
    const details = await refreshCache(nodeId, projectId);
    const sections = opts?.sections;

    const visible =
      sections === undefined
        ? details
        : details.filter(
            (t) =>
              t.sectionName !== null &&
              (sections as readonly string[]).includes(t.sectionName),
          );

    // API の呼び出しを増やしすぎないよう、コメントは「Owner 判断」の項目だけ読む
    const items = await Promise.all(
      visible.map(async (t) => {
        if (t.sectionName !== OWNER_SECTION) return toBoardItem(t);
        const comments = await tracker.listComments(t.externalId);
        return toBoardItem(
          t,
          comments
            .filter(isOwnerComment)
            .map((c) => ({ text: c.text, createdAt: c.createdAt })),
        );
      }),
    );

    return { projectId, columns: groupColumns(items, sections) };
  }

  async function createItem(nodeId: string, input: CreateItemInput): Promise<BoardItem> {
    assertSection(input.section);
    const projectId = await requireProjectId(nodeId);
    const details = await tracker.listTaskDetails(projectId);

    if (
      input.origin !== "owner" &&
      countInSection(details, "Inbox") >= LIMITS.inbox
    ) {
      throw new BoardLimitError(
        "inbox_full",
        `Inbox が ${LIMITS.inbox} 件に達しているので、owner 以外は項目を作れない`,
      );
    }

    if (input.origin === "biz") {
      const iteration = input.meta?.iteration;
      const bizTag = originTag("biz");
      const count = details.filter(
        (t) =>
          t.tags.includes(bizTag) &&
          parseItemNotes(t.notes).meta?.iteration === iteration,
      ).length;
      if (count >= LIMITS.bizProposalsPerIteration) {
        throw new BoardLimitError(
          "biz_proposal_limit",
          `Biz の提案はイテレーション ${iteration ?? "(未指定)"} で ${LIMITS.bizProposalsPerIteration} 件まで`,
        );
      }
    }

    if (input.section === "Sprint") {
      const limit = input.sprintLimit ?? DEFAULT_SPRINT_LIMIT;
      if (countInSection(details, "Sprint") >= limit) {
        throw new BoardLimitError("sprint_full", `Sprint は ${limit} 件まで`);
      }
    }

    const existingIds = details.flatMap((t) => {
      const id = parseItemNotes(t.notes).meta?.id;
      return id === undefined ? [] : [id];
    });
    const meta: ItemMeta = {
      ...input.meta,
      id: input.meta?.id ?? nextItemId(input.type, existingIds),
    };
    const notes = buildItemNotes(input.body, meta);

    const sectionId = await sectionGid(projectId, input.section);
    const task: TrackerTask = await tracker.createTask(projectId, {
      name: input.name,
      notes,
      sectionId,
    });

    for (const name of [typeTag(input.type), originTag(input.origin)]) {
      const tagId = await tracker.ensureTag(name);
      await tracker.addTag(task.externalId, tagId);
    }

    const refreshed = await refreshCache(nodeId, projectId);
    const created = refreshed.find((t) => t.externalId === task.externalId);
    return toBoardItem(created ?? (await tracker.getTask(task.externalId)));
  }

  async function moveItem(
    nodeId: string,
    itemId: string,
    section: Section,
    opts?: { sprintLimit?: number },
  ): Promise<void> {
    assertSection(section);
    const projectId = await requireProjectId(nodeId);
    await resolveItemNode(itemId, nodeId);

    if (section === "Sprint") {
      const limit = opts?.sprintLimit ?? DEFAULT_SPRINT_LIMIT;
      const details = await tracker.listTaskDetails(projectId);
      // すでに Sprint にある項目を動かすときは数に入れない
      if (countInSection(details, "Sprint", itemId) >= limit) {
        throw new BoardLimitError("sprint_full", `Sprint は ${limit} 件まで`);
      }
    }

    // Done に移しても完了にはしない (完了は人が Asana で付けてもよい)
    await tracker.moveTask(itemId, await sectionGid(projectId, section));
    await refreshCache(nodeId, projectId);
  }

  /**
   * 名前・本文・meta を変える。meta は丸ごと置き換える。
   * 返す項目の ownerComments は空配列 (コメントは getBoard で読む)。
   */
  async function updateItem(itemId: string, patch: UpdateItemPatch): Promise<BoardItem> {
    const nodeId = await resolveItemNode(itemId, patch.nodeId);
    const projectId = await requireProjectId(nodeId);

    let notes: string | undefined;
    if (patch.body !== undefined || patch.meta !== undefined) {
      // 変えない側 (本文か meta) は今の notes から取る
      const current = parseItemNotes((await tracker.getTask(itemId)).notes);
      const body = patch.body ?? current.body;
      const meta = patch.meta ?? current.meta;
      // meta は buildItemNotes が検証する (不正なら例外)
      notes = meta === null ? body : buildItemNotes(body, meta);
    }

    const updated = await tracker.updateTask(itemId, { name: patch.name, notes });
    await refreshCache(nodeId, projectId);
    return toBoardItem(updated);
  }

  /**
   * アプリとしてコメントする。本文の先頭に `[devloop] ` を付けるので、
   * 本文が `[from:owner]` で始まっていても Owner のコメントにはならない。
   */
  async function commentItem(
    itemId: string,
    text: string,
    opts?: { nodeId?: string },
  ): Promise<void> {
    const nodeId = await resolveItemNode(itemId, opts?.nodeId);
    const projectId = await requireProjectId(nodeId);
    await tracker.addComment(itemId, `${APP_MARK} ${text.trimStart()}`);
    await refreshCache(nodeId, projectId);
  }

  async function requestOwner(
    nodeId: string,
    input: { title: string; reason: string; itemId?: string },
  ): Promise<{ task: TrackerTask; movedItemId: string | null }> {
    const projectId = await requireProjectId(nodeId);
    // 元の項目は、起票の前にこの Node のものかを確かめる
    if (input.itemId !== undefined) await resolveItemNode(input.itemId, nodeId);
    const sectionId = await sectionGid(projectId, OWNER_SECTION);

    const task = await tracker.createTask(projectId, {
      name: input.title,
      notes:
        input.itemId !== undefined
          ? `${input.reason}\n\n対象の項目: ${input.itemId}`
          : input.reason,
      sectionId,
      ...(ownerAssigneeId !== undefined ? { assigneeId: ownerAssigneeId } : {}),
    });

    if (input.itemId === undefined) {
      await refreshCache(nodeId, projectId);
      return { task, movedItemId: null };
    }

    await tracker.moveTask(input.itemId, sectionId);
    await tracker.addComment(
      input.itemId,
      `${APP_MARK} Owner 判断を依頼しました: ${input.title}${task.url ? ` (${task.url})` : ` (${task.externalId})`}`,
    );
    await refreshCache(nodeId, projectId);
    return { task, movedItemId: input.itemId };
  }

  /** 持ち主の答えを、`[from:owner]` の印を付けてコメントする (画面の受け箱が使う) */
  async function answerOwner(nodeId: string, itemId: string, text: string): Promise<void> {
    const projectId = await requireProjectId(nodeId);
    await resolveItemNode(itemId, nodeId);
    await tracker.addComment(itemId, `${OWNER_MARK} ${text}`);
    await refreshCache(nodeId, projectId);
  }

  return {
    ensureSections,
    getBoard,
    createItem,
    moveItem,
    updateItem,
    commentItem,
    requestOwner,
    answerOwner,
    resolveItemNode,
  };
}

export type BoardService = ReturnType<typeof createBoardService>;
