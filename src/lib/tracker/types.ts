export type ExternalRef = {
  provider: string;
  externalId: string;
  url: string | null;
};

export type TrackerTask = {
  externalId: string;
  name: string;
  completed: boolean;
  dueOn: string | null;
  url: string | null;
};

/** 看板の列 (Asana のセクション) */
export type TrackerSection = { externalId: string; name: string };

/** 看板で使う、notes・タグ・列・担当者まで含めたタスク */
export type TrackerTaskDetail = TrackerTask & {
  notes: string;
  /** タグの名前 */
  tags: string[];
  sectionId: string | null;
  sectionName: string | null;
  assigneeId: string | null;
};

/** タスクのコメント。createdAt は ISO 8601 */
export type TrackerComment = {
  externalId: string;
  text: string;
  authorId: string | null;
  createdAt: string;
};

/** dueOn は YYYY-MM-DD */
export type TaskInput = {
  name: string;
  notes?: string;
  dueOn?: string;
  assigneeId?: string;
  /** 作成時に入れる列 */
  sectionId?: string;
};

export type NodeSummary = { id: string; title: string; summary: string };

export interface TrackerProvider {
  /** 例: "asana" */
  readonly id: string;
  findProjectByNodeId(nodeId: string): Promise<ExternalRef | null>;
  createProject(node: NodeSummary): Promise<ExternalRef>;
  listTasks(projectId: string): Promise<TrackerTask[]>;
  createTask(projectId: string, input: TaskInput): Promise<TrackerTask>;
  createWebhook(
    projectId: string,
    targetUrl: string,
  ): Promise<{ webhookId: string }>;
  listSections(projectId: string): Promise<TrackerSection[]>;
  createSection(projectId: string, name: string): Promise<TrackerSection>;
  listTaskDetails(projectId: string): Promise<TrackerTaskDetail[]>;
  getTask(taskId: string): Promise<TrackerTaskDetail>;
  moveTask(taskId: string, sectionId: string): Promise<void>;
  updateTask(
    taskId: string,
    patch: { name?: string; notes?: string; assigneeId?: string | null },
  ): Promise<TrackerTaskDetail>;
  /** 名前のタグが無ければ作り、タグの gid を返す */
  ensureTag(name: string): Promise<string>;
  addTag(taskId: string, tagId: string): Promise<void>;
  addComment(taskId: string, text: string): Promise<void>;
  /** コメント (ストーリーのうち comment_added) だけを Asana が返す順で返す */
  listComments(taskId: string): Promise<TrackerComment[]>;
}
