import { getSession } from "@/lib/auth/server";
import { loadNodeDetail } from "@/lib/nodes/detail";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (session === null) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    const detail = await loadNodeDetail(id);
    if (detail === null) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    return Response.json(detail);
  } catch (error) {
    console.error("[api:nodes] failed to load node detail", error);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
