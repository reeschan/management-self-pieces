"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getAllowedSession } from "@/lib/auth/server";
import { NodeId } from "@/lib/manifest/schema";
import {
  createTaskForNode,
  linkNodeToAsana,
  refreshTasks,
} from "@/lib/tracker/service";
import type { ExternalRef, TaskInput, TrackerTask } from "@/lib/tracker/types";

const taskInputSchema: z.ZodType<TaskInput> = z.object({
  name: z.string().min(1).max(200),
  notes: z.string().optional(),
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** Node に Asana プロジェクトをつなぐ (無ければ作る) */
export async function linkAsanaProject(nodeId: string): Promise<ExternalRef> {
  if (!(await getAllowedSession())) throw new Error("unauthorized");
  const id = NodeId.parse(nodeId);
  const ref = await linkNodeToAsana(id);
  revalidatePath("/");
  return ref;
}

/** Node のプロジェクトにタスクを作る */
export async function createTask(
  nodeId: string,
  input: TaskInput,
): Promise<TrackerTask> {
  if (!(await getAllowedSession())) throw new Error("unauthorized");
  const id = NodeId.parse(nodeId);
  const data = taskInputSchema.parse(input);
  const task = await createTaskForNode(id, data);
  revalidatePath("/");
  return task;
}

/** Node のタスクを Asana から取り直す */
export async function refreshNodeTasks(nodeId: string): Promise<number> {
  if (!(await getAllowedSession())) throw new Error("unauthorized");
  const id = NodeId.parse(nodeId);
  const count = await refreshTasks(id);
  revalidatePath("/");
  return count;
}
