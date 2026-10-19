import { afterEach, describe, expect, it, vi } from "vitest";
import iconv from "iconv-lite";
import { defaultSpec } from "@qmt/shared";
import { readVerifiedScript } from "../apps/web/src/api";
import {
  advanceImport,
  importProgressKey,
  readImportProgress,
  templateDescription,
  templatePreview,
  templateSpec,
} from "../apps/web/src/onboarding";

afterEach(() => vi.unstubAllGlobals());
describe("template discovery and QMT import progress", () => {
  it("changes the template while keeping the chosen stock, budgets and execution mode", () => {
    const base = {
      ...defaultSpec,
      symbol: "000001.SZ",
      maxPositionPct: 12,
      maxOrderValue: 5000,
      execution: "backtest" as const,
      fastWindow: 8,
      slowWindow: 40,
    };
    const selected = templateSpec(base, "momentum");
    expect(selected).toMatchObject({
      symbol: "000001.SZ",
      maxPositionPct: 12,
      maxOrderValue: 5000,
      execution: "backtest",
      kind: "momentum",
      name: "动量突破策略",
      slowWindow: 20,
      threshold: 0.03,
    });
    expect(base.slowWindow).toBe(40);
  });
  it("preserves edited periods and custom names when selecting the same template", () => {
    const base = {
      ...defaultSpec,
      fastWindow: 10,
      slowWindow: 30,
      name: "我的观察规则",
    };
    expect(templateSpec(base, "ma_cross")).toEqual(base);
    expect(templateSpec(base, "mean_reversion").name).toBe(base.name);
  });
  it("fills the description with the same rules and limits shown in the preview", () => {
    const spec = templateSpec(
      {
        ...defaultSpec,
        symbol: "000001.SZ",
        maxPositionPct: 10,
        maxOrderValue: 3000,
      },
      "mean_reversion",
    );
    const preview = templatePreview(spec, spec.kind)!;
    const description = templateDescription(spec);
    expect(description).toContain(preview.buy);
    expect(description).toContain(preview.sell);
    expect(description).toContain("000001.SZ");
    expect(description).toContain("10%");
    expect(description).toContain("3,000 元");
    expect(
      templatePreview({ ...spec, maxPositionPct: NaN }, spec.kind),
    ).toBeNull();
  });
  it("ignores malformed or obsolete saved progress", () => {
    for (const value of [
      null,
      "not-json",
      JSON.stringify({ version: 0, active: 1, completed: [] }),
      JSON.stringify({ version: 1, active: 4, completed: [] }),
      JSON.stringify({ version: 1, active: -1, completed: [] }),
    ]) {
      expect(readImportProgress(value)).toEqual({
        version: 1,
        active: 0,
        completed: [],
      });
    }
  });
  it("only restores known steps and avoids duplicate completion marks", () => {
    const value = readImportProgress(
      JSON.stringify({
        version: 1,
        active: 1,
        completed: ["download", "unknown", "download", null],
      }),
    );
    expect(value.completed).toEqual(["download"]);
    const next = advanceImport(value);
    expect(next).toEqual({
      version: 1,
      active: 2,
      completed: ["download", "editor"],
    });
    let progress = readImportProgress(null);
    for (let i = 0; i < 6; i++) progress = advanceImport(progress);
    expect(progress.active).toBe(3);
    expect(progress.completed).toEqual([
      "download",
      "editor",
      "backtest",
      "review",
    ]);
    expect(importProgressKey("first-script")).not.toBe(
      importProgressKey("second-script"),
    );
  });
  it("reads the checked GBK export for copying instead of unverified saved source", async () => {
    const source = "#coding:gbk\n# 中文买卖提示\ndef init(C):\n    pass\n";
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(iconv.encode(source, "gbk")));
    vi.stubGlobal("fetch", fetch);
    expect(await readVerifiedScript("test-script")).toBe(source);
    expect(fetch).toHaveBeenCalledWith(
      "/api/artifacts/test-script/download",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
  it("keeps integrity failures blocked and reports unreadable source clearly", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "脚本完整性检查失败" }), {
            status: 409,
          }),
        )
        .mockResolvedValueOnce(new Response(new Uint8Array([0x81]))),
    );
    await expect(readVerifiedScript("changed-script")).rejects.toMatchObject({
      status: 409,
      message: "脚本完整性检查失败",
    });
    await expect(readVerifiedScript("bad-encoding")).rejects.toMatchObject({
      code: "SOURCE_READ_FAILED",
    });
  });
});
