import { buildProjectNotes, extractNodeId } from "@/lib/tracker/marker";
import type {
  ExternalRef,
  TrackerComment,
  TrackerProvider,
  TrackerSection,
  TrackerTask,
  TrackerTaskDetail,
} from "@/lib/tracker/types";

type FakeTask = {
  projectId: string;
  name: string;
  notes: string;
  completed: boolean;
  dueOn: string | null;
  sectionId: string | null;
  assigneeId: string | null;
  /** タグの名前を保存する。gid は state.tags で管理する。 */
  tags: string[];
};

export type FakeTrackerState = {
  projects: Map<string, { name: string; notes: string }>;
  sections: Map<string, TrackerSection[]>;
  tasks: Map<string, FakeTask>;
  tags: Map<string, string>;
  comments: Map<string, TrackerComment[]>;
  /** 持ち主など、指定した作成者のコメントを直接追加する。 */
  addCommentAs(taskId: string, text: string, authorId: string | null): void;
};

export type FakeTracker = TrackerProvider & { state: FakeTrackerState };

/** テストごとに独立した、メモリ上の Asana を作る。 */
export function createFakeTracker(options?: { now?: () => Date }): FakeTracker {
  const now = options?.now ?? (() => new Date());
  let sequence = 0;
  const nextId = () => `fake-${++sequence}`;
  const state: FakeTrackerState = {
    projects: new Map(),
    sections: new Map(),
    tasks: new Map(),
    tags: new Map(),
    comments: new Map(),
    addCommentAs(taskId, text, authorId) {
      requireTask(taskId);
      const comment: TrackerComment = {
        externalId: nextId(),
        text,
        authorId,
        createdAt: now().toISOString(),
      };
      const comments = state.comments.get(taskId) ?? [];
      comments.push(comment);
      state.comments.set(taskId, comments);
    },
  };

  function requireProject(projectId: string) {
    if (!state.projects.has(projectId)) throw new Error("not found");
  }

  function requireTask(taskId: string): FakeTask {
    const task = state.tasks.get(taskId);
    if (!task) throw new Error("not found");
    return task;
  }

  function requireSection(projectId: string, sectionId: string) {
    const section = state.sections
      .get(projectId)
      ?.find((section) => section.externalId === sectionId);
    if (!section) throw new Error("not found");
    return section;
  }

  function projectRef(externalId: string): ExternalRef {
    return { provider: "asana", externalId, url: null };
  }

  function toTask(externalId: string, task: FakeTask): TrackerTask {
    return {
      externalId,
      name: task.name,
      completed: task.completed,
      dueOn: task.dueOn,
      url: null,
    };
  }

  function toDetail(externalId: string, task: FakeTask): TrackerTaskDetail {
    return {
      ...toTask(externalId, task),
      notes: task.notes,
      tags: [...task.tags],
      sectionId: task.sectionId,
      sectionName:
        task.sectionId === null
          ? null
          : requireSection(task.projectId, task.sectionId).name,
      assigneeId: task.assigneeId,
    };
  }

  return {
    id: "asana",
    state,

    async findProjectByNodeId(nodeId) {
      for (const [gid, project] of state.projects) {
        if (extractNodeId(project.notes) === nodeId) return projectRef(gid);
      }
      return null;
    },

    async createProject(node) {
      const gid = nextId();
      state.projects.set(gid, {
        name: node.title,
        notes: buildProjectNotes(node),
      });
      state.sections.set(gid, []);
      return projectRef(gid);
    },

    async listTasks(projectId) {
      requireProject(projectId);
      return [...state.tasks]
        .filter(([, task]) => task.projectId === projectId)
        .map(([gid, task]) => toTask(gid, task));
    },

    async createTask(projectId, input) {
      requireProject(projectId);
      if (input.sectionId !== undefined) {
        requireSection(projectId, input.sectionId);
      }
      const gid = nextId();
      const task: FakeTask = {
        projectId,
        name: input.name,
        notes: input.notes ?? "",
        completed: false,
        dueOn: input.dueOn ?? null,
        sectionId: input.sectionId ?? null,
        assigneeId: input.assigneeId ?? null,
        tags: [],
      };
      state.tasks.set(gid, task);
      state.comments.set(gid, []);
      return toTask(gid, task);
    },

    async createWebhook(projectId) {
      requireProject(projectId);
      return { webhookId: "fake-webhook" };
    },

    async listSections(projectId) {
      requireProject(projectId);
      return (state.sections.get(projectId) ?? []).map((section) => ({
        ...section,
      }));
    },

    async createSection(projectId, name) {
      requireProject(projectId);
      const section = { externalId: nextId(), name };
      const sections = state.sections.get(projectId) ?? [];
      sections.push(section);
      state.sections.set(projectId, sections);
      return { ...section };
    },

    async listTaskDetails(projectId) {
      requireProject(projectId);
      return [...state.tasks]
        .filter(([, task]) => task.projectId === projectId)
        .map(([gid, task]) => toDetail(gid, task));
    },

    async getTask(taskId) {
      return toDetail(taskId, requireTask(taskId));
    },

    async moveTask(taskId, sectionId) {
      const task = requireTask(taskId);
      requireSection(task.projectId, sectionId);
      task.sectionId = sectionId;
    },

    async updateTask(taskId, patch) {
      const task = requireTask(taskId);
      if (patch.name !== undefined) task.name = patch.name;
      if (patch.notes !== undefined) task.notes = patch.notes;
      if (patch.assigneeId !== undefined) task.assigneeId = patch.assigneeId;
      return toDetail(taskId, task);
    },

    async ensureTag(name) {
      const existing = state.tags.get(name);
      if (existing !== undefined) return existing;
      const gid = nextId();
      state.tags.set(name, gid);
      return gid;
    },

    async addTag(taskId, tagId) {
      const task = requireTask(taskId);
      const tag = [...state.tags].find(([, gid]) => gid === tagId);
      if (!tag) throw new Error("not found");
      if (!task.tags.includes(tag[0])) task.tags.push(tag[0]);
    },

    async addComment(taskId, text) {
      state.addCommentAs(taskId, text, null);
    },

    async listComments(taskId) {
      requireTask(taskId);
      return (state.comments.get(taskId) ?? []).map((comment) => ({
        ...comment,
      }));
    },
  };
}
