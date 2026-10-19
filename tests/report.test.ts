import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defaultSpec, type Artifact } from "@qmt/shared";
import { renderScript } from "../apps/api/src/template.js";
import { renderReportPdf } from "../apps/api/src/report.js";
import { sources } from "../apps/api/src/sources.js";

it("paginates long Chinese assumptions, preserves literal markup, and distinguishes failed checks from pending acceptance", async () => {
  const spec = { ...defaultSpec, name: '<b>中文</b>与符号 & "策略"' };
  const code = renderScript(spec);
  const artifact: Artifact = {
    id: crypto.randomUUID(),
    createdAt: "2026-10-19T08:00:00.000Z",
    provider: "template",
    prompt: "",
    spec,
    code,
    summary: "用于验证长内容、中文与特殊字符的 PDF 测试样例。",
    assumptions: Array.from(
      { length: 10 },
      (_, i) =>
        `约定${i + 1}：` +
        "请核对历史行情、回测费用和客户端版本，确保完整阅读策略适用条件。".repeat(
          12,
        ),
    ),
    sources,
    report: {
      passed: false,
      pythonVersion: "3.12.5",
      codeHash: createHash("sha256").update(code).digest("hex"),
      scope: "未通过静态校验，客户端仍待验收。",
      checks: [
        {
          id: "syntax",
          name: "语法检查",
          status: "fail",
          detail: "这是未通过结果的排版测试。",
        },
        {
          id: "broker-runtime",
          name: "东吴 QMT 客户端验收",
          status: "pending",
          detail: "需在实际客户端验收。",
        },
      ],
    },
  };
  const pdf = await renderReportPdf(artifact);
  const parsed = spawnSync(
    "python",
    [
      "-X",
      "utf8",
      "-I",
      fileURLToPath(new URL("./pdf_inspect.py", import.meta.url)),
    ],
    { input: pdf, encoding: "utf8", timeout: 10000, windowsHide: true },
  );
  expect(parsed.status, parsed.stderr).toBe(0);
  const result = JSON.parse(parsed.stdout) as { text: string; pages: number };
  expect(result.pages).toBeGreaterThan(2);
  expect(result.text).toContain(spec.name);
  expect(result.text).toContain("静态规则校验未通过");
  expect(result.text).toContain("约定10");
  expect(result.text).toContain("待验收");
  expect(result.text).toContain("2026-10-19 16:00:00");
  expect(result.text).toContain(
    "https://knowledge.thinktrader.net/docs/python/variable_convention.html",
  );
});
