import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defaultSpec, specSchema } from "@qmt/shared";
import { renderScript } from "../apps/api/src/template.js";
import { validateScript } from "../apps/api/src/validation.js";
import { interpret } from "../apps/api/src/agent.js";

describe("strategy constraints", () => {
  it("rejects unsupported markets, impossible windows and unsafe risk limits", () => {
    for (const change of [
      { symbol: "688001.SH" },
      { symbol: "300001.SZ" },
      { symbol: "510300.SH" },
      { symbol: "600000.SH');exec('bad" },
      { fastWindow: 20, slowWindow: 5 },
      { maxPositionPct: 101 },
      { maxOrderValue: 0 },
      { execution: "unknown" },
    ]) {
      expect(specSchema.safeParse({ ...defaultSpec, ...change }).success).toBe(
        false,
      );
    }
  });
  it("does not silently ignore natural language in template mode", async () => {
    await expect(
      interpret({
        spec: defaultSpec,
        provider: "template",
        prompt: "请加上百分之五止损",
      }),
    ).rejects.toThrow("不解析文本");
  });
  it.each(["ma_cross", "momentum", "mean_reversion"] as const)(
    "validates %s and explicitly leaves broker acceptance pending",
    async (kind) => {
      const report = await validateScript(
        renderScript({ ...defaultSpec, kind }),
      );
      expect(report.passed).toBe(true);
      expect(report.checks.filter((c) => c.status === "pass")).toHaveLength(9);
      expect(report.checks.find((c) => c.id === "broker-runtime")?.status).toBe(
        "pending",
      );
      expect(report.codeHash).toMatch(/^[a-f0-9]{64}$/);
    },
  );
  it("fails closed for unsupported syntax, imports, missing guards and GBK-incompatible names", async () => {
    const base = renderScript(defaultSpec);
    for (const changed of [
      base + "\nimport os\n",
      base.replaceAll('getattr(C, "do_back_test", None) is not True', "False"),
      base + "\nx = (a := 3)\n",
      renderScript({ ...defaultSpec, name: "策略🚀" }),
    ]) {
      expect((await validateScript(changed)).passed).toBe(false);
    }
  });
  it("escapes strategy names as data", async () => {
    const code = renderScript({
      ...defaultSpec,
      name: "策略\"\nprint('injected')",
    });
    expect((await validateScript(code)).passed).toBe(true);
    expect(
      code.split("\n").some((line) => line.startsWith("print('injected")),
    ).toBe(false);
  });
  it.each(["ma_cross", "momentum", "mean_reversion"] as const)(
    "passes actual Python behavior cases for %s",
    (kind) => {
      const process = spawnSync(
        "python",
        [
          "-X",
          "utf8",
          "-I",
          fileURLToPath(new URL("./runtime_cases.py", import.meta.url)),
        ],
        {
          input: JSON.stringify({
            code: renderScript({ ...defaultSpec, kind, execution: "backtest" }),
          }),
          encoding: "utf8",
          timeout: 10000,
          windowsHide: true,
        },
      );
      expect(process.status, process.stderr || process.stdout).toBe(0);
      const result = JSON.parse(process.stdout);
      expect(result.tests).toBeGreaterThanOrEqual(14);
    },
  );
});
