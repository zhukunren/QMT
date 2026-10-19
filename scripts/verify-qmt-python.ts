import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { defaultSpec } from "@qmt/shared";
import { renderScript } from "../apps/api/src/template.js";

// Uses only the installed interpreter's standard library and a local fake broker.
// -I -S prevents loading client site packages or sitecustomize; no QMT API is imported.
const python = process.argv[process.argv.indexOf("--python") + 1];
if (!process.argv.includes("--python") || !python)
  throw new Error(
    "Usage: npx tsx scripts/verify-qmt-python.ts --python <absolute python.exe path>",
  );
const version = spawnSync(python, ["-I", "-S", "--version"], {
  encoding: "utf8",
  windowsHide: true,
});
if (version.status !== 0)
  throw new Error(version.stderr || "Cannot start interpreter");
const checks = [];
for (const execution of ["backtest", "live"] as const) {
  for (const kind of ["ma_cross", "momentum", "mean_reversion"] as const) {
    const script = resolve(
      "tests",
      execution === "live" ? "live_runtime_cases.py" : "runtime_cases.py",
    );
    const result = spawnSync(
      python,
      [
        "-I",
        "-S",
        "-c",
        'import sys, io, runpy; sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8"); runpy.run_path(sys.argv[1], run_name="__main__")',
        script,
      ],
      {
        input: JSON.stringify({
          code: renderScript({ ...defaultSpec, kind, execution }),
        }),
        encoding: "utf8",
        timeout: 15000,
        windowsHide: true,
      },
    );
    if (result.status !== 0)
      throw new Error(
        `${execution}/${kind}: ${result.stderr || result.stdout}`,
      );
    checks.push({
      execution,
      kind,
      assertions: JSON.parse(result.stdout).tests,
    });
  }
}
console.log(
  JSON.stringify(
    {
      passed: true,
      python: version.stdout.trim() || version.stderr.trim(),
      noBrokerConnection: true,
      checks,
    },
    null,
    2,
  ),
);
