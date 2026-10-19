import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defaultSpec, type StrategySpec } from "@qmt/shared";
import { renderScript } from "../apps/api/src/template.js";
import { validateScript } from "../apps/api/src/validation.js";
import { templateSources } from "../apps/api/src/sources.js";
import { createApp } from "../apps/api/src/app.js";
import { Store } from "../apps/api/src/store.js";
import type { Plan, Job, Artifact } from "@qmt/shared";

describe("independent live template", () => {
  it("generates, revalidates and exports a disabled live artifact with official evidence through the API", async () => {
    const store = new Store(":memory:");
    const app = await createApp({ store, token: "" });
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/plans",
        payload: {
          provider: "template",
          prompt: "",
          spec: { ...defaultSpec, execution: "live" },
        },
      });
      expect(created.statusCode, created.body).toBe(200);
      const plan = created.json<Plan>();
      expect(plan.summary).toContain("实盘");
      expect(plan.assumptions.join(" ")).toContain("默认关闭");
      let job = (
        await app.inject({
          method: "POST",
          url: "/api/jobs",
          payload: { planId: plan.id },
        })
      ).json<Job>();
      for (
        let count = 0;
        count < 100 && ["queued", "running"].includes(job.status);
        count++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        job = (await app.inject(`/api/jobs/${job.id}`)).json<Job>();
      }
      expect(job.status, job.error).toBe("completed");
      const artifact = store.get<Artifact>("artifact", job.artifactId!)!;
      expect(artifact.spec.execution).toBe("live");
      expect(artifact.code).toContain("LIVE_TRADING_ENABLED = False");
      expect(
        artifact.sources.some((ref) => ref.section.includes("order_callback")),
      ).toBe(true);
      const downloaded = await app.inject(
        `/api/artifacts/${artifact.id}/download`,
      );
      expect(downloaded.statusCode, downloaded.body).toBe(200);
      const report = await app.inject(`/api/artifacts/${artifact.id}/report`);
      expect(report.statusCode, report.body.slice(0, 80)).toBe(200);
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
      expect(JSON.parse(parsed.stdout).text).toContain("实盘脚本");
    } finally {
      await app.close();
      store.close();
    }
  });
  it.each(["ma_cross", "momentum", "mean_reversion"] as const)(
    "validates and exercises %s without connecting to a broker",
    async (kind) => {
      const spec: StrategySpec = { ...defaultSpec, kind, execution: "live" };
      const code = renderScript(spec, templateSources(spec));
      const report = await validateScript(code);
      expect(report.passed, JSON.stringify(report.checks)).toBe(true);
      expect(
        report.checks.find((check) => check.id === "broker-runtime")?.status,
      ).toBe("pending");
      const result = spawnSync(
        "python",
        [
          "-X",
          "utf8",
          "-I",
          fileURLToPath(new URL("./live_runtime_cases.py", import.meta.url)),
        ],
        {
          input: JSON.stringify({ code }),
          encoding: "utf8",
          timeout: 15000,
          windowsHide: true,
        },
      );
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(JSON.parse(result.stdout).tests).toBeGreaterThanOrEqual(40);
    },
  );
  it("binds live-specific official evidence including cancellations, reports and status enums", () => {
    const refs = templateSources({ ...defaultSpec, execution: "live" });
    const sections = refs.map((ref) => ref.section).join("\n");
    for (const topic of [
      "passorder",
      "撤销委托",
      "order_callback",
      "deal_callback",
      "account_callback",
      "orderError_callback",
      "enum_EEntrustStatus",
      "get_full_tick",
      "get_trading_dates",
      "get_instrument_detail",
    ])
      expect(sections).toContain(topic);
    expect(
      refs.every((ref) => ref.excerpt && ref.contentHash && ref.snapshotId),
    ).toBe(true);
  });
  it("rejects tampering with the live gate, persistence, order price and appended arbitrary code", async () => {
    const code = renderScript({ ...defaultSpec, execution: "live" });
    for (const changed of [
      code.replace(
        "LIVE_TRADING_ENABLED = False",
        "LIVE_TRADING_ENABLED = True",
      ),
      code.replace("os.fsync(stream.fileno())", "pass"),
      code.replace("STRATEGY_NAME, 1, attempt", "STRATEGY_NAME, 2, attempt"),
      code + "\nimport os\nos.remove('example')\n",
    ])
      expect((await validateScript(changed)).passed).toBe(false);
  });
});
