import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Check, ValidationReport } from "@qmt/shared";

export async function validateScript(code: string): Promise<ValidationReport> {
  const result = await new Promise<{ checks: Check[]; pythonVersion: string }>(
    (resolve, reject) => {
      const child = spawn(
        process.env.PYTHON_PATH || "python",
        [
          "-X",
          "utf8",
          "-I",
          fileURLToPath(new URL("../python/validate.py", import.meta.url)),
        ],
        { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
      );
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("Python 校验超时，禁止导出"));
      }, 10000);
      child.stdout.on("data", (d) => {
        out += String(d);
      });
      child.stderr.on("data", (d) => {
        err += String(d);
      });
      child.on("error", () => {
        clearTimeout(timer);
        reject(
          new Error("Python 校验器不可用，请配置 PYTHON_PATH（Python 3.9+）"),
        );
      });
      child.on("close", (status) => {
        clearTimeout(timer);
        if (status !== 0)
          return reject(new Error("Python 校验失败：" + err.slice(0, 300)));
        try {
          resolve(JSON.parse(out));
        } catch {
          reject(new Error("Python 校验器返回无效结果"));
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify({ code }));
    },
  );
  return {
    ...result,
    passed: result.checks.every((c) => c.status === "pass"),
    codeHash: createHash("sha256").update(code).digest("hex"),
    scope: code.includes('EXECUTION_MODE = "live"')
      ? "实盘模板已按固定规则静态检查，默认交易开关关闭；尚未完成东吴 QMT 版本、账户状态、模拟柜台及真实委托验收。"
      : "静态规则校验通过不代表实盘可用。尚未在东吴 QMT 客户端执行回测、撮合、费用或券商版本兼容测试。",
    checks: [
      ...result.checks,
      {
        id: "broker-runtime",
        name: "东吴 QMT 客户端验收",
        status: "pending",
        detail:
          "需在对应客户端完成历史回测、模拟柜台、账户状态、委托/成交/撤单回报、断线重启、交易成本及复权影响验收。",
      },
    ],
  };
}
