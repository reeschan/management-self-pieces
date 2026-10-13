import { getDb } from "@/db/client";
import { getAllowedSession } from "@/lib/auth/server";
import { createControlService } from "@/lib/devloop/control";
import { loadDevloopView } from "@/lib/devloop/view";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getAllowedSession();
  if (session === null) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    const db = getDb();
    const view = await loadDevloopView(db, id, {
      control: createControlService({ db }),
    });
    if (view === null) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    return Response.json(view);
  } catch (error) {
    console.error("[api:nodes:devloop] failed to load devloop view", error);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
