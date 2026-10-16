import { describe, expect, it, vi } from "vitest";

import { NodeServiceError } from "@/lib/nodes/service";

import { actionError } from "./action-result";

describe("actionError", () => {
  it("NodeServiceError の message をそのまま返す", () => {
    const error = new NodeServiceError("id_taken", "ID「x」は既に使われています");
    expect(actionError(error, "[test] 処理に失敗しました")).toEqual({
      ok: false,
      message: "ID「x」は既に使われています",
    });
  });

  it("それ以外の例外は「処理に失敗しました」を返し、console.error に出す", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("内部の詳細");
    expect(actionError(error, "[test] 処理に失敗しました")).toEqual({
      ok: false,
      message: "処理に失敗しました",
    });
    expect(spy).toHaveBeenCalledWith("[test] 処理に失敗しました", error);
    spy.mockRestore();
  });
});
