import { describe, expect, test } from "vitest";
import { createAsanaProvider } from "./asana";

const PAT = "secret-pat-1234567890";

type Call = { url: URL; method: string; headers: Headers; body: unknown };
type Responder = (call: Call) => { status?: number; json: unknown };

function fakeFetch(responder: Responder) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const { status = 200, json } = responder(call);
    return new Response(JSON.stringify(json), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { fn, calls };
}

function provider(responder: Responder) {
  const f = fakeFetch(responder);
  const p = createAsanaProvider({
    pat: PAT,
    workspaceGid: "ws1",
    fetch: f.fn,
  });
  return { p, calls: f.calls };
}

const TASK_DETAIL_FIELDS =
  "name,completed,due_on,permalink_url,notes,tags.name,memberships.section.name,memberships.project.gid,assignee.gid";

/** 2 つのプロジェクトに所属するタスクの応答 */
const detailJson = {
  gid: "t1",
  name: "A",
  completed: false,
  due_on: "2026-10-31",
  permalink_url: "https://app.asana.com/t1",
  notes: "本文",
  tags: [{ name: "devloop" }, { name: "blocked" }],
  memberships: [
    { project: { gid: "other" }, section: { gid: "sx", name: "別の列" } },
    { project: { gid: "proj1" }, section: { gid: "s2", name: "作業中" } },
  ],
  assignee: { gid: "u1" },
};

describe("asana provider (看板の操作)", () => {
  test("listSections がページングして全列を返す", async () => {
    const { p, calls } = provider(({ url }) => {
      if (url.searchParams.get("offset") === "o2") {
        return {
          json: { data: [{ gid: "s2", name: "作業中" }], next_page: null },
        };
      }
      return {
        json: {
          data: [{ gid: "s1", name: "未着手" }],
          next_page: { offset: "o2" },
        },
      };
    });
    expect(await p.listSections("proj1")).toEqual([
      { externalId: "s1", name: "未着手" },
      { externalId: "s2", name: "作業中" },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url.pathname).toBe("/api/1.0/projects/proj1/sections");
    expect(calls[0].url.searchParams.get("opt_fields")).toBe("name");
    expect(calls[0].url.searchParams.get("limit")).toBe("100");
    expect(calls[0].body).toBeUndefined();
    expect(calls[1].url.searchParams.get("offset")).toBe("o2");
  });

  test("createSection が POST /projects/{gid}/sections に name を送る", async () => {
    const { p, calls } = provider(() => ({
      json: { data: { gid: "s9", name: "レビュー" } },
    }));
    expect(await p.createSection("proj1", "レビュー")).toEqual({
      externalId: "s9",
      name: "レビュー",
    });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.pathname).toBe("/api/1.0/projects/proj1/sections");
    expect(calls[0].body).toEqual({ data: { name: "レビュー" } });
  });

  test("listTaskDetails が project で絞り、その project の列を写す", async () => {
    const { p, calls } = provider(() => ({
      json: {
        data: [
          detailJson,
          { gid: "t2", name: "B", completed: true, memberships: null },
        ],
        next_page: null,
      },
    }));
    expect(await p.listTaskDetails("proj1")).toEqual([
      {
        externalId: "t1",
        name: "A",
        completed: false,
        dueOn: "2026-10-31",
        url: "https://app.asana.com/t1",
        notes: "本文",
        tags: ["devloop", "blocked"],
        sectionId: "s2",
        sectionName: "作業中",
        assigneeId: "u1",
      },
      {
        externalId: "t2",
        name: "B",
        completed: true,
        dueOn: null,
        url: null,
        notes: "",
        tags: [],
        sectionId: null,
        sectionName: null,
        assigneeId: null,
      },
    ]);
    const c = calls[0];
    expect(c.method).toBe("GET");
    expect(c.url.pathname).toBe("/api/1.0/tasks");
    expect(c.url.searchParams.get("project")).toBe("proj1");
    expect(c.url.searchParams.get("opt_fields")).toBe(TASK_DETAIL_FIELDS);
  });

  test("getTask が GET /tasks/{gid} を同じ opt_fields で呼び、最初の所属の列を使う", async () => {
    const { p, calls } = provider(() => ({ json: { data: detailJson } }));
    const t = await p.getTask("t1");
    expect(t).toMatchObject({
      externalId: "t1",
      notes: "本文",
      tags: ["devloop", "blocked"],
      sectionId: "sx",
      sectionName: "別の列",
      assigneeId: "u1",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url.pathname).toBe("/api/1.0/tasks/t1");
    expect(calls[0].url.searchParams.get("opt_fields")).toBe(
      TASK_DETAIL_FIELDS,
    );
    expect(calls[0].body).toBeUndefined();
  });

  test("moveTask が POST /sections/{gid}/addTask に task を送る", async () => {
    const { p, calls } = provider(() => ({ json: { data: {} } }));
    await expect(p.moveTask("t1", "s2")).resolves.toBeUndefined();
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.pathname).toBe("/api/1.0/sections/s2/addTask");
    expect(calls[0].body).toEqual({ data: { task: "t1" } });
  });

  test("updateTask が PUT /tasks/{gid} に渡した項目だけを送る (assignee の null も送る)", async () => {
    const { p, calls } = provider(() => ({
      json: { data: { ...detailJson, name: "新しい名前", assignee: null } },
    }));
    const t = await p.updateTask("t1", {
      name: "新しい名前",
      assigneeId: null,
    });
    expect(t).toMatchObject({
      externalId: "t1",
      name: "新しい名前",
      assigneeId: null,
    });
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url.pathname).toBe("/api/1.0/tasks/t1");
    expect(calls[0].url.searchParams.get("opt_fields")).toBe(
      TASK_DETAIL_FIELDS,
    );
    expect(calls[0].body).toEqual({
      data: { name: "新しい名前", assignee: null },
    });
  });

  test("ensureTag が既存のタグを探し、無ければ作り、2 回目はキャッシュを使う", async () => {
    const { p, calls } = provider(({ method }) => {
      if (method === "GET") {
        return {
          json: {
            data: [{ gid: "tag1", name: "devloop" }],
            next_page: null,
          },
        };
      }
      return { json: { data: { gid: "tag2", name: "blocked" } } };
    });
    expect(await p.ensureTag("devloop")).toBe("tag1");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url.pathname).toBe("/api/1.0/workspaces/ws1/tags");

    expect(await p.ensureTag("blocked")).toBe("tag2");
    expect(calls).toHaveLength(3);
    expect(calls[2].method).toBe("POST");
    expect(calls[2].url.pathname).toBe("/api/1.0/workspaces/ws1/tags");
    expect(calls[2].body).toEqual({ data: { name: "blocked" } });

    expect(await p.ensureTag("devloop")).toBe("tag1");
    expect(await p.ensureTag("blocked")).toBe("tag2");
    expect(calls).toHaveLength(3);
  });

  test("ensureTag のキャッシュは provider のインスタンスをまたがない", async () => {
    const responder: Responder = () => ({
      json: { data: [{ gid: "tag1", name: "devloop" }], next_page: null },
    });
    const a = provider(responder);
    const b = provider(responder);
    await a.p.ensureTag("devloop");
    await b.p.ensureTag("devloop");
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(1);
  });

  test("addTag が POST /tasks/{gid}/addTag に tag を送る", async () => {
    const { p, calls } = provider(() => ({ json: { data: {} } }));
    await expect(p.addTag("t1", "tag1")).resolves.toBeUndefined();
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.pathname).toBe("/api/1.0/tasks/t1/addTag");
    expect(calls[0].body).toEqual({ data: { tag: "tag1" } });
  });

  test("addComment が POST /tasks/{gid}/stories に text を送る", async () => {
    const { p, calls } = provider(() => ({
      json: { data: { gid: "st1" } },
    }));
    await expect(p.addComment("t1", "進めます")).resolves.toBeUndefined();
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.pathname).toBe("/api/1.0/tasks/t1/stories");
    expect(calls[0].body).toEqual({ data: { text: "進めます" } });
  });

  test("listComments が comment_added のストーリーだけを返す", async () => {
    const { p, calls } = provider(({ url }) => {
      if (url.searchParams.get("offset") === "o2") {
        return {
          json: {
            data: [
              {
                gid: "st3",
                text: "2 つ目",
                created_by: null,
                created_at: "2026-10-12T01:00:00.000Z",
                resource_subtype: "comment_added",
              },
            ],
            next_page: null,
          },
        };
      }
      return {
        json: {
          data: [
            {
              gid: "st1",
              text: "1 つ目",
              created_by: { gid: "u1" },
              created_at: "2026-10-11T00:00:00.000Z",
              resource_subtype: "comment_added",
            },
            {
              gid: "st2",
              text: "列を移動しました",
              created_by: { gid: "u1" },
              created_at: "2026-10-11T00:30:00.000Z",
              resource_subtype: "section_changed",
            },
            {
              gid: "st4",
              text: "タグを追加しました",
              created_by: { gid: "u2" },
              created_at: "2026-10-11T00:40:00.000Z",
              resource_subtype: "added_to_tag",
            },
          ],
          next_page: { offset: "o2" },
        },
      };
    });
    expect(await p.listComments("t1")).toEqual([
      {
        externalId: "st1",
        text: "1 つ目",
        authorId: "u1",
        createdAt: "2026-10-11T00:00:00.000Z",
      },
      {
        externalId: "st3",
        text: "2 つ目",
        authorId: null,
        createdAt: "2026-10-12T01:00:00.000Z",
      },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url.pathname).toBe("/api/1.0/tasks/t1/stories");
    expect(calls[0].url.searchParams.get("opt_fields")).toBe(
      "text,created_by.gid,created_at,resource_subtype",
    );
    expect(calls[1].url.searchParams.get("offset")).toBe("o2");
  });

  test("createTask が assigneeId と sectionId (memberships) を送る", async () => {
    const { p, calls } = provider(() => ({
      json: { data: { gid: "t9", name: "New", completed: false } },
    }));
    const t = await p.createTask("proj1", {
      name: "New",
      assigneeId: "u1",
      sectionId: "s1",
    });
    expect(t).toEqual({
      externalId: "t9",
      name: "New",
      completed: false,
      dueOn: null,
      url: null,
    });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.pathname).toBe("/api/1.0/tasks");
    expect(calls[0].body).toEqual({
      data: {
        name: "New",
        projects: ["proj1"],
        assignee: "u1",
        memberships: [{ project: "proj1", section: "s1" }],
      },
    });
  });

  test("足した操作のリクエストすべてに Authorization: Bearer <pat> が付く", async () => {
    const { p, calls } = provider(({ method, url }) => {
      if (method === "GET" && url.pathname === "/api/1.0/tasks/t1") {
        return { json: { data: detailJson } };
      }
      if (method === "GET") return { json: { data: [], next_page: null } };
      if (method === "PUT") return { json: { data: detailJson } };
      return { json: { data: { gid: "g", name: "n" } } };
    });
    await p.listSections("proj1");
    await p.createSection("proj1", "n");
    await p.listTaskDetails("proj1");
    await p.getTask("t1");
    await p.moveTask("t1", "s1");
    await p.updateTask("t1", { notes: "x" });
    await p.ensureTag("n");
    await p.addTag("t1", "g");
    await p.addComment("t1", "c");
    await p.listComments("t1");
    expect(calls).toHaveLength(11);
    for (const c of calls) {
      expect(c.headers.get("Authorization")).toBe(`Bearer ${PAT}`);
    }
  });
});
