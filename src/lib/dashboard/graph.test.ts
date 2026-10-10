import { describe, expect, it } from "vitest";

import { kindIds } from "@/lib/manifest/kinds";
import { kindColors, toGraphData } from "./graph";

const n = (id: string, kind = "app", status = "active") => ({
  id,
  kind,
  title: id,
  summary: "",
  status,
});

describe("toGraphData", () => {
  it("存在しない端点の link を捨てる", () => {
    const g = toGraphData(
      [n("a"), n("b")],
      [
        { fromId: "a", toId: "b", type: "uses" },
        { fromId: "a", toId: "zzz", type: "uses" },
        { fromId: "zzz", toId: "b", type: "uses" },
      ],
      {},
    );
    expect(g.links).toEqual([{ source: "a", target: "b", type: "uses" }]);
  });

  it("val は 1 + min(openTasks, 20) / 4", () => {
    const g = toGraphData([n("a"), n("b"), n("c")], [], { a: 4, b: 100 });
    expect(g.nodes.map((x) => x.val)).toEqual([2, 6, 1]);
    expect(g.nodes[1].openTasks).toBe(100);
  });

  it("archived は半透明", () => {
    const g = toGraphData([n("a", "app", "archived"), n("b")], [], {});
    expect(g.nodes[0].color).toBe(`${kindColors.app}66`);
    expect(g.nodes[1].color).toBe(kindColors.app);
  });

  it("未知の kind は other の色", () => {
    const g = toGraphData([n("a", "nope")], [], {});
    expect(g.nodes[0].color).toBe(kindColors.other);
  });

  it("kinds.ts の全 kind に色がある", () => {
    for (const id of kindIds) {
      expect(kindColors[id]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
