import { describe, expect, test } from "vitest";
import { AsanaError, createAsanaProvider } from "./asana";
import { buildProjectNotes, extractNodeId } from "./marker";

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

function provider(responder: Responder, teamGid?: string) {
  const f = fakeFetch(responder);
  const p = createAsanaProvider({
    pat: PAT,
    workspaceGid: "ws1",
    teamGid,
    fetch: f.fn,
  });
  return { p, calls: f.calls };
}

describe("marker", () => {
  test("buildProjectNotes → extractNodeId で id が戻る", () => {
    const notes = buildProjectNotes({
      id: "node-abc-1",
      title: "T",
      summary: "要約です",
    });
    expect(notes).toBe("要約です\n\npiece-node-id: node-abc-1");
    expect(extractNodeId(notes)).toBe("node-abc-1");
  });

  test("行頭・行末の空白を許す", () => {
    expect(extractNodeId("a\n  piece-node-id:   x-1  \nb")).toBe("x-1");
  });

  test("marker の無い notes や null / undefined で null", () => {
    expect(extractNodeId("ただの説明")).toBeNull();
    expect(extractNodeId("")).toBeNull();
    expect(extractNodeId(null)).toBeNull();
    expect(extractNodeId(undefined)).toBeNull();
    expect(extractNodeId("piece-node-id: UPPER")).toBeNull();
  });
});

describe("asana provider", () => {
  test("findProjectByNodeId が 2 ページ目にあるプロジェクトを見つける", async () => {
    const { p, calls } = provider(({ url }) => {
      if (!url.searchParams.has("offset")) {
        return {
          json: {
            data: [
              { gid: "p1", name: "a", notes: "none", permalink_url: "u1" },
              {
                gid: "p2",
                name: "b",
                notes: "x\n\npiece-node-id: other",
                permalink_url: "u2",
              },
            ],
            next_page: { offset: "OFF2", path: "/x", uri: "https://x" },
          },
        };
      }
      return {
        json: {
          data: [
            {
              gid: "p3",
              name: "c",
              notes: "s\n\npiece-node-id: target-1",
              permalink_url: "https://app.asana.com/p3",
            },
          ],
          next_page: null,
        },
      };
    });
    const ref = await p.findProjectByNodeId("target-1");
    expect(ref).toEqual({
      provider: "asana",
      externalId: "p3",
      url: "https://app.asana.com/p3",
    });
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.method).toBe("GET");
      expect(c.url.pathname).toBe("/api/1.0/projects");
      expect(c.url.toString()).toContain("workspace=ws1");
    }
    expect(calls[1].url.toString()).toContain("offset=OFF2");
  });

  test("findProjectByNodeId が見つからなければ null", async () => {
    const { p } = provider(() => ({ json: { data: [], next_page: null } }));
    expect(await p.findProjectByNodeId("x")).toBeNull();
  });

  test("createProject の本文に marker が入り、teamGid が無ければ team は入らない", async () => {
    const { p, calls } = provider(() => ({
      json: { data: { gid: "np", permalink_url: null } },
    }));
    const ref = await p.createProject({
      id: "n-1",
      title: "Title",
      summary: "Sum",
    });
    expect(ref).toEqual({ provider: "asana", externalId: "np", url: null });
    const c = calls[0];
    expect(c.method).toBe("POST");
    expect(c.url.pathname).toBe("/api/1.0/projects");
    expect(c.url.searchParams.get("opt_fields")).toBe("permalink_url");
    expect(c.headers.get("Content-Type")).toBe("application/json");
    const data = (c.body as { data: Record<string, unknown> }).data;
    expect(data.name).toBe("Title");
    expect(data.workspace).toBe("ws1");
    expect(String(data.notes)).toContain("piece-node-id: n-1");
    expect(data).not.toHaveProperty("team");
  });

  test("createProject は teamGid を渡したときだけ team を付ける", async () => {
    const { p, calls } = provider(
      () => ({ json: { data: { gid: "np", permalink_url: "u" } } }),
      "team9",
    );
    await p.createProject({ id: "n-1", title: "T", summary: "S" });
    const data = (calls[0].body as { data: Record<string, unknown> }).data;
    expect(data.team).toBe("team9");
  });

  test("listTasks がページングして全件を返し、項目を写す", async () => {
    const { p, calls } = provider(({ url }) => {
      if (url.searchParams.get("offset") === "o2") {
        return {
          json: {
            data: [
              {
                gid: "t2",
                name: "B",
                completed: true,
                due_on: null,
                permalink_url: null,
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
              gid: "t1",
              name: "A",
              completed: false,
              due_on: "2026-10-31",
              permalink_url: "https://app.asana.com/t1",
            },
          ],
          next_page: { offset: "o2" },
        },
      };
    });
    const tasks = await p.listTasks("proj1");
    expect(tasks).toEqual([
      {
        externalId: "t1",
        name: "A",
        completed: false,
        dueOn: "2026-10-31",
        url: "https://app.asana.com/t1",
      },
      { externalId: "t2", name: "B", completed: true, dueOn: null, url: null },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url.pathname).toBe("/api/1.0/projects/proj1/tasks");
    expect(calls[0].url.searchParams.get("limit")).toBe("100");
    expect(calls[1].url.searchParams.get("offset")).toBe("o2");
  });

  test("createTask の本文の projects に projectId が入る", async () => {
    const { p, calls } = provider(() => ({
      json: {
        data: {
          gid: "t9",
          name: "New",
          completed: false,
          due_on: "2026-11-01",
          permalink_url: "u9",
        },
      },
    }));
    const t = await p.createTask("proj1", {
      name: "New",
      notes: "n",
      dueOn: "2026-11-01",
    });
    expect(t).toEqual({
      externalId: "t9",
      name: "New",
      completed: false,
      dueOn: "2026-11-01",
      url: "u9",
    });
    expect(calls[0].url.pathname).toBe("/api/1.0/tasks");
    expect(calls[0].body).toEqual({
      data: {
        name: "New",
        notes: "n",
        due_on: "2026-11-01",
        projects: ["proj1"],
      },
    });
  });

  test("createWebhook は data.gid を webhookId にする", async () => {
    const { p, calls } = provider(() => ({ json: { data: { gid: "wh1" } } }));
    expect(await p.createWebhook("proj1", "https://example.com/h")).toEqual({
      webhookId: "wh1",
    });
    expect(calls[0].url.pathname).toBe("/api/1.0/webhooks");
    expect(calls[0].body).toEqual({
      data: { resource: "proj1", target: "https://example.com/h" },
    });
  });

  test("401 で AsanaError (status 401) を投げ、メッセージに PAT を含まない", async () => {
    const { p } = provider(() => ({
      status: 401,
      json: { errors: [{ message: "Not Authorized" }] },
    }));
    const err = await p.listTasks("proj1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AsanaError);
    expect((err as AsanaError).status).toBe(401);
    expect((err as AsanaError).message).not.toContain(PAT);
  });

  test("すべてのリクエストに Authorization: Bearer <pat> が付く", async () => {
    const { p, calls } = provider(({ url, method }) => {
      if (method === "GET") return { json: { data: [], next_page: null } };
      if (url.pathname.endsWith("/webhooks")) {
        return { json: { data: { gid: "w" } } };
      }
      if (url.pathname.endsWith("/tasks")) {
        return { json: { data: { gid: "t", name: "x", completed: false } } };
      }
      return { json: { data: { gid: "p" } } };
    });
    await p.findProjectByNodeId("n");
    await p.createProject({ id: "n", title: "t", summary: "s" });
    await p.listTasks("p");
    await p.createTask("p", { name: "x" });
    await p.createWebhook("p", "https://e");
    expect(calls).toHaveLength(5);
    for (const c of calls) {
      expect(c.headers.get("Authorization")).toBe(`Bearer ${PAT}`);
      expect(c.headers.get("Accept")).toBe("application/json");
    }
  });
});
