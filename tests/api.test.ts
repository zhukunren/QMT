import { describe, it, expect, afterEach } from "vitest";
import { defaultSpec, type Artifact, type Plan, type Job } from "@qmt/shared";
import { createApp } from "../apps/api/src/app.js";
import { Store } from "../apps/api/src/store.js";
import { explainSpec } from "../apps/api/src/agent.js";
import iconv from "iconv-lite";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup(token?: string) {
  const store = new Store(":memory:");
  const app = await createApp({ store, token });
  cleanups.push(async () => {
    await app.close();
    store.close();
  });
  return { app, store };
}
describe("HTTP workflow and boundaries", () => {
  it("serves authenticated full-text search and chunk reads with bounded inputs", async () => {
    const { app } = await setup("docs-token");
    expect((await app.inject("/api/documents/status")).statusCode).toBe(401);
    expect((await app.inject("/api/documents/search?q=passorder")).statusCode).toBe(401);
    const headers = { authorization: "Bearer docs-token" };
    const status = await app.inject({ url: "/api/documents/status", headers });
    expect(status.json().indexedPages).toBe(15);
    const search = await app.inject({ url: "/api/documents/search?q=get_market_data_ex&pageId=qmt-data-function&limit=2", headers });
    expect(search.statusCode).toBe(200);
    const passage = search.json().passages[0];
    expect(passage.text).toContain("dividend_type");
    expect(passage.url).toContain("#");
    const chunk = await app.inject({ url: `/api/documents/chunks/${encodeURIComponent(passage.id)}`, headers });
    expect(chunk.json()).toEqual(passage);
    expect((await app.inject({ url: "/api/documents/chunks/qmt-missing:0:0", headers })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/documents/search?q=a&limit=99", headers })).statusCode).toBe(400);
  });
  it("rebinds template references when confirmation changes execution mode", async () => {
    const { app } = await setup();
    const plan = (await app.inject({ method: "POST", url: "/api/plans", payload: { provider: "template", prompt: "", spec: { ...defaultSpec, execution: "backtest" } } })).json<Plan>();
    expect(plan.sources?.some(s => s.section.includes("综合下单函数"))).toBe(true);
    const revised = await app.inject({ method: "POST", url: `/api/plans/${plan.id}/revisions`, payload: { spec: defaultSpec } });
    expect(revised.statusCode).toBe(200);
    expect(revised.json<Plan>().sources?.some(s => s.section.includes("综合下单函数"))).toBe(false);
    expect(revised.json<Plan>().sources?.every(s => s.citationKind === "template")).toBe(true);
  });
  it("requires configured token and does not expose credentials", async () => {
    const { app } = await setup("test-token");
    expect((await app.inject("/api/artifacts")).statusCode).toBe(401);
    const response = await app.inject("/api/health");
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("test-token");
    expect(
      (
        await app.inject({
          url: "/api/artifacts",
          headers: { authorization: "Bearer test-token" },
        })
      ).statusCode,
    ).toBe(200);
  });
  it("rejects invalid symbols and spec tampering", async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: "POST",
      url: "/api/plans",
      payload: {
        provider: "template",
        prompt: "",
        spec: { ...defaultSpec, symbol: "688001.SH" },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/jobs",
          payload: { planId: "../../outside", code: "malicious" },
        })
      ).statusCode,
    ).toBe(400);
  });
  it("completes confirmation, generation, persistence, report, GBK download and tamper detection", async () => {
    const { app, store } = await setup();
    const response = await app.inject({
      method: "POST",
      url: "/api/plans",
      payload: { provider: "template", prompt: "", spec: defaultSpec },
    });
    expect(response.statusCode, response.body).toBe(200);
    const plan = response.json<Plan>();
    const started = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: { planId: plan.id },
    });
    expect(started.statusCode).toBe(202);
    let job = started.json<Job>();
    for (
      let i = 0;
      i < 50 && (job.status === "queued" || job.status === "running");
      i++
    ) {
      await new Promise((r) => setTimeout(r, 40));
      job = (await app.inject(`/api/jobs/${job.id}`)).json<Job>();
    }
    expect(job.status, job.error).toBe("completed");
    const artifact = (
      await app.inject(`/api/artifacts/${job.artifactId}`)
    ).json<Artifact>();
    expect(artifact.report.passed).toBe(true);
    const library = await app.inject("/api/artifacts");
    expect(library.json()).toHaveLength(1);
    expect(library.json()[0].code).toBeUndefined();
    const file = await app.inject(`/api/artifacts/${artifact.id}/download`);
    expect(file.statusCode).toBe(200);
    expect(iconv.decode(file.rawPayload, "gbk")).toBe(artifact.code);
    expect(iconv.decode(file.rawPayload, "gbk")).toContain("仅计算信号");
    const report = await app.inject(`/api/artifacts/${artifact.id}/report`);
    expect(report.statusCode).toBe(200);
    expect(report.headers["content-type"]).toContain("application/pdf");
    expect(report.headers["content-disposition"]).toContain("_report.pdf");
    expect(report.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    const parsed = spawnSync(
      "python",
      [
        "-X",
        "utf8",
        "-I",
        fileURLToPath(new URL("./pdf_inspect.py", import.meta.url)),
      ],
      {
        input: report.rawPayload,
        encoding: "utf8",
        timeout: 10000,
        windowsHide: true,
      },
    );
    expect(parsed.status, parsed.stderr).toBe(0);
    const pdf = JSON.parse(parsed.stdout) as {
      text: string;
      pages: number;
      embeddedFonts: string[];
    };
    expect(pdf.text).toContain("脚本校验报告");
    expect(pdf.text).toContain("双均线趋势策略");
    expect(pdf.text).toContain("东吴 QMT 客户端验收");
    expect(pdf.text).toContain("待验收");
    expect(pdf.text).toContain(artifact.report.codeHash);
    expect(pdf.text).toContain(
      "https://knowledge.thinktrader.net/docs/python/data_function.html",
    );
    expect(plan.sources?.every(s => s.chunkId && s.excerpt && s.url.includes("#"))).toBe(true);
    expect(artifact.sources).toEqual(plan.sources);
    expect(artifact.code).toContain(plan.sources![0]!.url);
    expect(pdf.text).toContain("原文摘录");
    expect(pdf.text).toContain(plan.sources![0]!.snapshotId);
    expect(pdf.embeddedFonts.length).toBeGreaterThan(0);
    store.save("artifact", {
      ...artifact,
      code: artifact.code + "\n# changed\n",
    });
    expect(
      (await app.inject(`/api/artifacts/${artifact.id}/download`)).statusCode,
    ).toBe(409);
    expect(
      (await app.inject(`/api/artifacts/${artifact.id}/report`)).statusCode,
    ).toBe(409);
  });
  it("keeps a single canonical plan even when user requests a changed code", async () => {
    const { app, store } = await setup();
    const plan: Plan = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      provider: "template",
      prompt: "",
      spec: defaultSpec,
      summary: explainSpec(defaultSpec),
      assumptions: [],
    };
    store.save("plan", plan);
    const result = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: { planId: plan.id, spec: { execution: "live" } },
    });
    expect(result.statusCode).toBe(400);
  });
  it("does not fallback from failed Codex interpretation to a template", async () => {
    const store = new Store(":memory:");
    const app = await createApp({
      store,
      interpreter: async () => {
        throw new Error("Codex 无法确认这条策略");
      },
    });
    cleanups.push(async () => {
      await app.close();
      store.close();
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/plans",
      payload: {
        provider: "codex",
        prompt: "请为我生成一个策略",
        spec: defaultSpec,
      },
    });
    expect(response.statusCode).toBe(422);
    expect(store.list("plan")).toHaveLength(0);
  });
});
