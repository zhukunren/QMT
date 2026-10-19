import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Artifact } from "@qmt/shared";

export function renderReportPdf(artifact: Artifact): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.PYTHON_PATH || "python",
      [
        "-X",
        "utf8",
        "-I",
        fileURLToPath(new URL("../python/report_pdf.py", import.meta.url)),
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("PDF 报告生成超时，请稍后重试。"));
    }, 20000);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) {
        child.kill();
        reject(new Error("PDF 报告超出大小限制。"));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("PDF 生成器不可用，请检查 Python 配置。"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const pdf = Buffer.concat(chunks);
      if (code !== 0 || pdf.subarray(0, 5).toString() !== "%PDF-")
        return reject(
          new Error(
            "PDF 报告生成失败，请检查 Python ReportLab 依赖及内置字体。",
          ),
        );
      resolve(pdf);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(
      JSON.stringify({
        ...artifact,
        code: undefined,
        reportGeneratedAt: new Date().toISOString(),
      }),
    );
  });
}
