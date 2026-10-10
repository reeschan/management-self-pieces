import { z } from "zod";
import { buildProjectNotes, extractNodeId } from "./marker";
import type {
  ExternalRef,
  NodeSummary,
  TaskInput,
  TrackerProvider,
  TrackerTask,
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

const webhookSchema = z.object({ gid: z.string() });

function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), next_page: nextPageSchema });
}

function singleSchema<T extends z.ZodType>(item: T) {
  return z.object({ data: item });
}

type Project = z.infer<typeof projectSchema>;
type Task = z.infer<typeof taskSchema>;

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

export function createAsanaProvider(
  opts: AsanaProviderOptions,
): TrackerProvider {
  const doFetch = opts.fetch ?? fetch;

  async function request<T>(
    method: "GET" | "POST",
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
  };
}
