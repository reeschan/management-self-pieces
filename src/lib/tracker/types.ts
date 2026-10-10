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

/** dueOn は YYYY-MM-DD */
export type TaskInput = { name: string; notes?: string; dueOn?: string };

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
}
