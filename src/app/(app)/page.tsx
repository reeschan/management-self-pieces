import { connection } from "next/server";

import { Dashboard } from "@/components/graph/dashboard";
import { loadGraph } from "@/lib/dashboard/load";

export default async function DashboardPage() {
  // DB を読むのでリクエスト時に動かす (layout は instant = false)
  await connection();
  const data = await loadGraph();
  return <Dashboard data={data} />;
}
