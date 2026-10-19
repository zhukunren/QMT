import { defaultSpec, type Plan } from "@qmt/shared";
const response = await fetch("http://127.0.0.1:8000/api/plans", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  signal: AbortSignal.timeout(135000),
  body: JSON.stringify({
    provider: "codex",
    prompt:
      "对 600000.SH 使用 5 日与 20 日均线，金叉买入，死叉卖出。仓位不超过 20%，单笔买入不超过 1 万元。",
    spec: defaultSpec,
  }),
});
const result = (await response.json()) as Plan | { error: string };
if (!response.ok) {
  console.error(JSON.stringify({ status: response.status, ...result }));
  process.exitCode = 1;
} else {
  const plan = result as Plan;
  if (!plan.retrieval?.queries.length || (plan.sources?.filter(s => s.citationKind === "ai").length || 0) < 2)
    throw new Error("Codex did not perform full-text retrieval with verified chapter citations");
  console.log(
    JSON.stringify({
      status: response.status,
      spec: plan.spec,
      summary: plan.summary,
      hasThreadId: Boolean(plan.threadId),
      queries: plan.retrieval.queries,
      citationCount: plan.sources?.filter(s => s.citationKind === "ai").length,
      chapters: plan.sources?.filter(s => s.citationKind === "ai").map(s => s.section),
    }),
  );
  const started = await fetch("http://127.0.0.1:8000/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planId: plan.id }),
  });
  let job = (await started.json()) as {
    id: string;
    status: string;
    artifactId?: string;
    error?: string;
  };
  for (
    let i = 0;
    i < 60 && (job.status === "queued" || job.status === "running");
    i++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    job = (await (
      await fetch(`http://127.0.0.1:8000/api/jobs/${job.id}`)
    ).json()) as typeof job;
  }
  if (job.status !== "completed")
    throw new Error(job.error || "Codex artifact generation did not finish");
  const download = await fetch(
    `http://127.0.0.1:8000/api/artifacts/${job.artifactId}/download`,
  );
  if (!download.ok)
    throw new Error("Codex artifact download validation failed");
  console.log(
    JSON.stringify({
      codexWorkflow: "passed",
      artifactId: job.artifactId,
      scriptBytes: (await download.arrayBuffer()).byteLength,
    }),
  );
  if (process.argv.includes("--full")) {
    const rejected = await fetch("http://127.0.0.1:8000/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(135000),
      body: JSON.stringify({
        provider: "codex",
        prompt:
          "我想对 600000.SH 做网格交易，价格每下跌 1% 买入，涨 1% 卖出，并设置 5% 止损。请生成实盘脚本。",
        spec: defaultSpec,
      }),
    });
    if (rejected.status !== 422)
      throw new Error("Unsupported strategy was not rejected");
    console.log(
      JSON.stringify({
        unsupportedStrategy: "rejected",
        ...((await rejected.json()) as object),
      }),
    );
  }
}
