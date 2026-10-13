import { z } from "zod";
import { buildProjectNotes, extractNodeId } from "./marker";
import type {
  ExternalRef,
  NodeSummary,
  TaskInput,
  TrackerComment,
  TrackerProvider,
  TrackerSection,
  TrackerTask,
  TrackerTaskDetail,
} from "./types";

const BASE_URL = "https://app.asana.com/api/1.0";
const PAGE_LIMIT = "100";
const PROVIDER_ID = "asana";

export class AsanaError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AsanaError";
    this.status = status;
  }
}

export type AsanaProviderOptions = {
  pat: string;
  workspaceGid: string;
  teamGid?: string;
  fetch?: typeof fetch;
};

const nextPageSchema = z
  .object({ offset: z.string() })
  .nullable()
  .optional();

const projectSchema = z.object({
  gid: z.string(),
  notes: z.string().nullable().optional(),
  permalink_url: z.string().nullable().optional(),
});

const taskSchema = z.object({
  gid: z.string(),
  name: z.string(),
  completed: z.boolean(),
  due_on: z.string().nullable().optional(),
  permalink_url: z.string().nullable().optional(),
});

const sectionSchema = z.object({ gid: z.string(), name: z.string() });

const taskDetailSchema = taskSchema.extend({
  notes: z.string().nullable().optional(),
  tags: z
    .array(z.object({ name: z.string() }))
    .nullable()
    .optional(),
  memberships: z
    .array(
      z.object({
        project: z.object({ gid: z.string() }).nullable().optional(),
        section: sectionSchema.partial().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
  assignee: z.object({ gid: z.string() }).nullable().optional(),
});

const tagSchema = z.object({ gid: z.string(), name: z.string() });

const storySchema = z.object({
  gid: z.string(),
  text: z.string().nullable().optional(),
  created_by: z.object({ gid: z.string() }).nullable().optional(),
  created_at: z.string(),
  resource_subtype: z.string().nullable().optional(),
});

const emptySchema = z.unknown();

const TASK_DETAIL_FIELDS =
  "name,completed,due_on,permalink_url,notes,tags.name,memberships.section.name,memberships.project.gid,assignee.gid";

const STORY_FIELDS = "text,created_by.gid,created_at,resource_subtype";

const webhookSchema = z.object({ gid: z.string() });

function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), next_page: nextPageSchema });
}

function singleSchema<T extends z.ZodType>(item: T) {
  return z.object({ data: item });
}

type Project = z.infer<typeof projectSchema>;
type Task = z.infer<typeof taskSchema>;
type TaskDetail = z.infer<typeof taskDetailSchema>;
type Story = z.infer<typeof storySchema>;

function toExternalRef(p: Project): ExternalRef {
  return {
    provider: PROVIDER_ID,
    externalId: p.gid,
    url: p.permalink_url ?? null,
  };
}

function toTrackerTask(t: Task): TrackerTask {
  return {
    externalId: t.gid,
    name: t.name,
    completed: t.completed,
    dueOn: t.due_on ?? null,
    url: t.permalink_url ?? null,
  };
}

function toTrackerTaskDetail(
  t: TaskDetail,
  projectId?: string,
): TrackerTaskDetail {
  const memberships = t.memberships ?? [];
  // projectId が無いとき (getTask・updateTask) は最初の所属の列を使う
  const membership =
    projectId === undefined
      ? memberships[0]
      : memberships.find((m) => m.project?.gid === projectId);
  const section = membership?.section ?? null;
  return {
    ...toTrackerTask(t),
    notes: t.notes ?? "",
    tags: (t.tags ?? []).map((tag) => tag.name),
    sectionId: section?.gid ?? null,
    sectionName: section?.name ?? null,
    assigneeId: t.assignee?.gid ?? null,
  };
}

function toTrackerSection(s: z.infer<typeof sectionSchema>): TrackerSection {
  return { externalId: s.gid, name: s.name };
}

function toTrackerComment(s: Story): TrackerComment {
  return {
    externalId: s.gid,
    text: s.text ?? "",
    authorId: s.created_by?.gid ?? null,
    createdAt: s.created_at,
  };
}

export function createAsanaProvider(
  opts: AsanaProviderOptions,
): TrackerProvider {
  const doFetch = opts.fetch ?? fetch;
  // タグの名前 → gid。キャッシュはこの provider のインスタンスの中だけ
  const tagIds = new Map<string, string>();

  async function request<T>(
    method: "GET" | "POST" | "PUT",
    path: string,
    query: Record<string, string>,
    schema: z.ZodType<T>,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = new URL(BASE_URL + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${opts.pat}`,
      Accept: "application/json",
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify({ data: body });
    }

    const res = await doFetch(url.toString(), init);
    if (!res.ok) {
      // PAT を含めないよう、メッセージは method / path / status だけにする
      throw new AsanaError(
        res.status,
        `Asana API ${method} ${path} が失敗しました (status ${res.status})`,
      );
    }
    const json: unknown = await res.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new AsanaError(
        res.status,
        `Asana API ${method} ${path} の応答の形が想定と違います`,
      );
    }
    return parsed.data;
  }

  async function* paginate<T extends z.ZodType>(
    path: string,
    query: Record<string, string>,
    item: T,
  ): AsyncGenerator<z.infer<T>> {
    const schema = pageSchema(item);
    let offset: string | undefined;
    do {
      const q = offset ? { ...query, offset } : query;
      const page = await request("GET", path, q, schema);
      for (const d of page.data) yield d as z.infer<T>;
      offset = page.next_page?.offset;
    } while (offset);
  }

  return {
    id: PROVIDER_ID,

    async findProjectByNodeId(nodeId) {
      const query = {
        workspace: opts.workspaceGid,
        opt_fields: "name,notes,permalink_url",
        limit: PAGE_LIMIT,
      };
      for await (const p of paginate("/projects", query, projectSchema)) {
        if (extractNodeId(p.notes) === nodeId) return toExternalRef(p);
      }
      return null;
    },

    async createProject(node: NodeSummary) {
      const body: Record<string, unknown> = {
        name: node.title,
        notes: buildProjectNotes(node),
        workspace: opts.workspaceGid,
      };
      if (opts.teamGid) body.team = opts.teamGid;
      const res = await request(
        "POST",
        "/projects",
        { opt_fields: "permalink_url" },
        singleSchema(projectSchema),
        body,
      );
      return toExternalRef(res.data);
    },

    async listTasks(projectId) {
      const query = {
        opt_fields: "name,completed,due_on,permalink_url",
        limit: PAGE_LIMIT,
      };
      const tasks: TrackerTask[] = [];
      const path = `/projects/${encodeURIComponent(projectId)}/tasks`;
      for await (const t of paginate(path, query, taskSchema)) {
        tasks.push(toTrackerTask(t));
      }
      return tasks;
    },

    async createTask(projectId, input: TaskInput) {
      const body: Record<string, unknown> = {
        name: input.name,
        projects: [projectId],
      };
      if (input.notes !== undefined) body.notes = input.notes;
      if (input.dueOn !== undefined) body.due_on = input.dueOn;
      if (input.assigneeId !== undefined) body.assignee = input.assigneeId;
      if (input.sectionId !== undefined) {
        body.memberships = [{ project: projectId, section: input.sectionId }];
      }
      const res = await request(
        "POST",
        "/tasks",
        { opt_fields: "name,completed,due_on,permalink_url" },
        singleSchema(taskSchema),
        body,
      );
      return toTrackerTask(res.data);
    },

    async createWebhook(projectId, targetUrl) {
      const res = await request(
        "POST",
        "/webhooks",
        {},
        singleSchema(webhookSchema),
        { resource: projectId, target: targetUrl },
      );
      return { webhookId: res.data.gid };
    },

    async listSections(projectId) {
      const path = `/projects/${encodeURIComponent(projectId)}/sections`;
      const query = { opt_fields: "name", limit: PAGE_LIMIT };
      const sections: TrackerSection[] = [];
      for await (const s of paginate(path, query, sectionSchema)) {
        sections.push(toTrackerSection(s));
      }
      return sections;
    },

    async createSection(projectId, name) {
      const res = await request(
        "POST",
        `/projects/${encodeURIComponent(projectId)}/sections`,
        { opt_fields: "name" },
        singleSchema(sectionSchema),
        { name },
      );
      return toTrackerSection(res.data);
    },

    async listTaskDetails(projectId) {
      const query = {
        project: projectId,
        opt_fields: TASK_DETAIL_FIELDS,
        limit: PAGE_LIMIT,
      };
      const tasks: TrackerTaskDetail[] = [];
      for await (const t of paginate("/tasks", query, taskDetailSchema)) {
        tasks.push(toTrackerTaskDetail(t, projectId));
      }
      return tasks;
    },

    async getTask(taskId) {
      const res = await request(
        "GET",
        `/tasks/${encodeURIComponent(taskId)}`,
        { opt_fields: TASK_DETAIL_FIELDS },
        singleSchema(taskDetailSchema),
      );
      return toTrackerTaskDetail(res.data);
    },

    async moveTask(taskId, sectionId) {
      await request(
        "POST",
        `/sections/${encodeURIComponent(sectionId)}/addTask`,
        {},
        emptySchema,
        { task: taskId },
      );
    },

    async updateTask(taskId, patch) {
      const body: Record<string, unknown> = {};
      if (patch.name !== undefined) body.name = patch.name;
      if (patch.notes !== undefined) body.notes = patch.notes;
      if (patch.assigneeId !== undefined) body.assignee = patch.assigneeId;
      const res = await request(
        "PUT",
        `/tasks/${encodeURIComponent(taskId)}`,
        { opt_fields: TASK_DETAIL_FIELDS },
        singleSchema(taskDetailSchema),
        body,
      );
      return toTrackerTaskDetail(res.data);
    },

    async ensureTag(name) {
      const cached = tagIds.get(name);
      if (cached !== undefined) return cached;
      const ws = encodeURIComponent(opts.workspaceGid);
      const query = { opt_fields: "name", limit: PAGE_LIMIT };
      const path = `/workspaces/${ws}/tags`;
      for await (const t of paginate(path, query, tagSchema)) {
        if (t.name === name) {
          tagIds.set(name, t.gid);
          return t.gid;
        }
      }
      const res = await request(
        "POST",
        path,
        { opt_fields: "name" },
        singleSchema(tagSchema),
        { name },
      );
      tagIds.set(name, res.data.gid);
      return res.data.gid;
    },

    async addTag(taskId, tagId) {
      await request(
        "POST",
        `/tasks/${encodeURIComponent(taskId)}/addTag`,
        {},
        emptySchema,
        { tag: tagId },
      );
    },

    async addComment(taskId, text) {
      await request(
        "POST",
        `/tasks/${encodeURIComponent(taskId)}/stories`,
        {},
        emptySchema,
        { text },
      );
    },

    async listComments(taskId) {
      const path = `/tasks/${encodeURIComponent(taskId)}/stories`;
      const query = { opt_fields: STORY_FIELDS, limit: PAGE_LIMIT };
      const comments: TrackerComment[] = [];
      for await (const s of paginate(path, query, storySchema)) {
        // 変更履歴などのストーリーは捨て、人が書いたコメントだけを返す
        if (s.resource_subtype === "comment_added") {
          comments.push(toTrackerComment(s));
        }
      }
      return comments;
    },
  };
}
