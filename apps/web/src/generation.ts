import type { Artifact, Job } from "@qmt/shared";
import { api, ApiError } from "./api";

// A retry resumes a known job; an uncertain POST reuses the same request ID.
export async function runGeneration({
  planId,
  requestId,
  existingJob,
  onJob,
  cancelled = () => false,
  transport = api,
  wait = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  timeoutMs = 45000,
}: {
  planId: string;
  requestId: string;
  existingJob?: Job;
  onJob: (job: Job) => void;
  cancelled?: () => boolean;
  transport?: typeof api;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
}): Promise<Artifact> {
  const ensureActive = () => {
    if (cancelled()) throw new ApiError("已停止查询。", 0, "ABORTED");
  };
  ensureActive();
  let current =
    existingJob ||
    (await transport<Job>("/jobs", {
      method: "POST",
      body: JSON.stringify({ planId, requestId }),
    }));
  ensureActive();
  onJob(current);
  const deadline = now() + timeoutMs;
  while (current.status === "queued" || current.status === "running") {
    ensureActive();
    if (now() >= deadline)
      throw new ApiError(
        "等待结果的时间较长，任务可能仍在后台继续。您可以继续查询原任务。",
        0,
        "POLL_TIMEOUT",
      );
    await wait(600);
    ensureActive();
    current = await transport<Job>(`/jobs/${current.id}`);
    ensureActive();
    onJob(current);
  }
  if (current.status === "failed")
    throw new ApiError(current.error || "生成失败，请重试。", 0, "JOB_FAILED");
  if (!current.artifactId)
    throw new ApiError(
      "任务已结束，但暂时无法读取脚本记录，请继续查询。",
      0,
      "INVALID_RESPONSE",
    );
  const artifact = await transport<Artifact>(
    `/artifacts/${current.artifactId}`,
  );
  ensureActive();
  return artifact;
}
