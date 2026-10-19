import { describe, it, expect, vi, afterEach } from "vitest";
import {
  defaultSpec,
  specErrors,
  strategyRules,
  type Artifact,
  type Job,
} from "@qmt/shared";
import { api, ApiError } from "../apps/web/src/api";
import { runGeneration } from "../apps/web/src/generation";

afterEach(() => vi.unstubAllGlobals());
const queued: Job = { id: "job-1", status: "running", stage: 2, events: [] };
const completed: Job = {
  ...queued,
  status: "completed",
  stage: 4,
  artifactId: "artifact-1",
};
const artifact = { id: "artifact-1", spec: defaultSpec } as Artifact;

describe("rule editing and task recovery", () => {
  it("shows useful field errors and respects original budget limits", () => {
    expect(
      specErrors({ ...defaultSpec, fastWindow: 25, slowWindow: 20 }).slowWindow,
    ).toContain("长周期");
    expect(
      specErrors({ ...defaultSpec, symbol: "688001.SH" }).symbol,
    ).toContain("主板");
    expect(
      specErrors({ ...defaultSpec, maxPositionPct: 30 }, defaultSpec)
        .maxPositionPct,
    ).toContain("20%");
    expect(
      specErrors({ ...defaultSpec, maxOrderValue: NaN }).maxOrderValue,
    ).toContain("单笔预算");
    expect(
      specErrors({ ...defaultSpec, kind: "momentum", slowWindow: 3 }),
    ).toEqual({});
  });
  it("updates both rule summaries with the edited template parameters", () => {
    expect(strategyRules({ ...defaultSpec, fastWindow: 10 }).buy).toContain(
      "10 日均线",
    );
    expect(
      strategyRules({ ...defaultSpec, kind: "momentum", threshold: 0.042 })
        .sell,
    ).toContain("4.2%");
    expect(
      strategyRules({ ...defaultSpec, kind: "mean_reversion", slowWindow: 30 })
        .sell,
    ).toContain("30 日均价");
  });
  it("resumes a known task without posting a new job", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(completed)
      .mockResolvedValueOnce(artifact) as unknown as typeof api;
    const updates = vi.fn();
    expect(
      await runGeneration({
        planId: "plan",
        requestId: "request",
        existingJob: queued,
        onJob: updates,
        transport,
        wait: async () => {},
      }),
    ).toBe(artifact);
    expect(transport).toHaveBeenNthCalledWith(1, "/jobs/job-1");
    expect(updates).toHaveBeenLastCalledWith(completed);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("retains the latest known job when polling disconnects", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(queued)
      .mockRejectedValueOnce(
        new ApiError("offline", 0, "NETWORK_ERROR"),
      ) as unknown as typeof api;
    const updates = vi.fn();
    await expect(
      runGeneration({
        planId: "plan",
        requestId: "stable-request",
        onJob: updates,
        transport,
        wait: async () => {},
      }),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(updates).toHaveBeenLastCalledWith(queued);
    expect(transport).toHaveBeenNthCalledWith(1, "/jobs", {
      method: "POST",
      body: JSON.stringify({ planId: "plan", requestId: "stable-request" }),
    });
  });
  it("reuses a request ID after a lost creation response", async () => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("timeout", 0, "TIMEOUT"))
      .mockResolvedValueOnce(completed)
      .mockResolvedValueOnce(artifact) as unknown as typeof api;
    const options = {
      planId: "plan",
      requestId: "stable-request",
      onJob: vi.fn(),
      transport,
    };
    await expect(runGeneration(options)).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    expect(await runGeneration(options)).toBe(artifact);
    expect(vi.mocked(transport).mock.calls[0]).toEqual(
      vi.mocked(transport).mock.calls[1],
    );
  });
  it("retries fetching a completed artifact without regenerating it", async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(artifact) as unknown as typeof api;
    await runGeneration({
      planId: "plan",
      requestId: "request",
      existingJob: completed,
      onJob: vi.fn(),
      transport,
    });
    expect(transport).toHaveBeenCalledExactlyOnceWith("/artifacts/artifact-1");
  });
  it("distinguishes a failed job from a wait timeout", async () => {
    await expect(
      runGeneration({
        planId: "plan",
        requestId: "request",
        existingJob: { ...queued, status: "failed", error: "校验器不可用" },
        onJob: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: "JOB_FAILED", message: "校验器不可用" });
    let clock = 0;
    const transport = vi
      .fn()
      .mockResolvedValue(queued) as unknown as typeof api;
    await expect(
      runGeneration({
        planId: "plan",
        requestId: "request",
        existingJob: queued,
        onJob: vi.fn(),
        transport,
        now: () => clock,
        timeoutMs: 1000,
        wait: async () => {
          clock += 600;
        },
      }),
    ).rejects.toMatchObject({ code: "POLL_TIMEOUT" });
  });
  it("normalizes connection errors and carries server field errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: "请检查输入",
              code: "INVALID_INPUT",
              fields: { slowWindow: "长周期必须大于短周期" },
            }),
            { status: 400 },
          ),
        ),
    );
    await expect(api("/health")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
    await expect(
      api("/plans/test/revisions", { method: "POST" }),
    ).rejects.toMatchObject({
      status: 400,
      fields: { slowWindow: "长周期必须大于短周期" },
    });
  });
});
