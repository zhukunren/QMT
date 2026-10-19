import { chromium, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
const executable =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browser = await chromium.launch({
  executablePath: executable,
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await mkdir(".runtime", { recursive: true });
await page.goto("http://127.0.0.1:5174/", { waitUntil: "networkidle" });

await page.screenshot({
  path: resolve(".runtime/desktop.png"),
  fullPage: true,
});
const primary = await page
  .getByRole("button", { name: "理解我的策略", exact: true })
  .boundingBox();
if (!primary || primary.y < 0 || primary.y + primary.height > 720)
  throw new Error("Primary creation action is outside the first viewport");
const draft = "600000.SH 的 5 日与 20 日双均线策略，仓位不超过 15%。";
await page.getByRole("textbox", { name: "策略想法", exact: true }).fill(draft);
await page.getByRole("button", { name: /高级设置/ }).click();
await page.getByLabel("仓位预算上限（%）", { exact: true }).fill("15");
await page.getByLabel("生成用途", { exact: true }).selectOption("backtest");
await page.getByRole("button", { name: "模板体验", exact: true }).click();
await expect(page.getByLabel("仓位预算上限（%）", { exact: true })).toHaveValue(
  "20",
);
await expect(page.getByLabel("生成用途", { exact: true })).toHaveValue(
  "signal",
);
await page.getByLabel("仓位预算上限（%）", { exact: true }).fill("25");
await page.getByRole("button", { name: "智能理解", exact: true }).click();
await expect(
  page.getByRole("textbox", { name: "策略想法", exact: true }),
).toHaveValue(draft);
await expect(page.getByLabel("仓位预算上限（%）", { exact: true })).toHaveValue(
  "15",
);
await expect(page.getByLabel("生成用途", { exact: true })).toHaveValue(
  "backtest",
);
await page.getByRole("button", { name: "模板体验", exact: true }).click();
await expect(page.getByLabel("仓位预算上限（%）", { exact: true })).toHaveValue(
  "25",
);
await page.getByRole("button", { name: "确认模板参数", exact: true }).click();
await page.getByRole("dialog").waitFor();
const review = page.getByRole("dialog");
await review.getByLabel("短均线周期（天）", { exact: true }).fill("25");
await review
  .getByRole("button", { name: "确认并生成脚本", exact: true })
  .click();
await expect(
  review.getByLabel("长均线周期（天）", { exact: true }),
).toHaveAttribute("aria-invalid", "true");
await review.getByLabel("短均线周期（天）", { exact: true }).fill("10");
await expect(
  review.getByText("10 日均线上穿 20 日均线时买入", { exact: true }),
).toBeVisible();

await page.screenshot({
  path: resolve(".runtime/confirm.png"),
  fullPage: true,
});
await page.getByRole("button", { name: "确认并生成脚本", exact: true }).click();
await page
  .getByRole("button", { name: "下载 Python 脚本", exact: true })
  .waitFor({ timeout: 20000 });
await expect(page.locator(".result-workspace")).toBeVisible();
await expect(page.locator(".composer")).toHaveCount(0);
await expect(page.locator(".template-section")).toHaveCount(0);
await page.getByRole("button", { name: "Python 脚本", exact: true }).click();
await expect(page.locator(".code-block")).toContainText("FAST = 10");

await page.getByRole("button", { name: "返回创建草稿", exact: true }).click();
await page.getByRole("button", { name: "智能理解", exact: true }).click();
await expect(
  page.getByRole("textbox", { name: "策略想法", exact: true }),
).toHaveValue(draft);
await page
  .getByRole("button", { name: /我的脚本/ })
  .first()
  .click();
await page
  .getByLabel("按策略类型筛选", { exact: true })
  .selectOption("mean_reversion");
for (const row of await page.getByRole("article").all()) {
  await expect(row).toContainText("均值回归");
}
await page
  .getByLabel("搜索脚本", { exact: true })
  .fill(`不存在的脚本-${crypto.randomUUID()}`);
await expect(page.getByRole("article")).toHaveCount(0);
await page.getByRole("button", { name: "清除全部筛选", exact: true }).click();
await page.getByLabel("按状态筛选", { exact: true }).selectOption("passed");
const sourceRow = page.getByRole("article").first();
await sourceRow.getByRole("button", { name: "重命名", exact: true }).click();
await page
  .getByRole("dialog")
  .getByLabel("脚本名称", { exact: true })
  .fill("双均线趋势策略 · 整理");
await page.getByRole("button", { name: "保存名称", exact: true }).click();
await expect(page.getByRole("dialog")).toHaveCount(0);
await expect(page.locator(".sidebar-recents")).toContainText("600000.SH");
await expect(page.getByRole("article").first()).toContainText(
  "双均线趋势策略 · 整理",
);
await page
  .getByRole("button", { name: /双均线趋势策略.*600000/ })
  .first()
  .click();
await expect(page.locator(".result-workspace")).toBeVisible();
await page.getByRole("button", { name: "校验报告", exact: true }).click();
await page.getByText("9 项静态规则通过", { exact: true }).waitFor();
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.getByRole("button", { name: "下载 Python 脚本", exact: true }).click(),
]);
await download.saveAs(resolve(".runtime/downloaded.py"));
const [reportDownload] = await Promise.all([
  page.waitForEvent("download"),
  page
    .getByRole("button", { name: "下载校验报告（PDF）", exact: true })
    .click(),
]);
if (!reportDownload.suggestedFilename().endsWith("_report.pdf"))
  throw new Error("Report must download as PDF");
await mkdir("output/pdf", { recursive: true });
await reportDownload.saveAs(resolve("output/pdf/qmt-validation-report.pdf"));
if (
  (await readFile("output/pdf/qmt-validation-report.pdf"))
    .subarray(0, 5)
    .toString() !== "%PDF-"
)
  throw new Error("Invalid PDF report download");
await page.screenshot({ path: resolve(".runtime/result.png"), fullPage: true });
await page
  .getByRole("button", { name: /我的脚本/ })
  .first()
  .click();
await page
  .getByRole("button", { name: /双均线趋势策略.*600000/ })
  .first()
  .click();
await page.getByRole("button", { name: "Python 脚本", exact: true }).waitFor();
await page.getByRole("button", { name: "复制为新策略", exact: true }).click();
await expect(page.getByLabel("仓位预算上限（%）", { exact: true })).toHaveValue(
  "25",
);
await expect(
  page.getByRole("button", { name: "模板体验", exact: true }),
).toHaveAttribute("aria-pressed", "true");
await page.getByRole("button", { name: "官方文档", exact: true }).click();
await expect(
  page.getByRole("heading", { name: "检索章节正文", exact: true }),
).toBeVisible();
if ((await page.locator(".docs-grid .source-card").count()) < 15)
  throw new Error("Missing official source catalog");
await page.getByRole("button", { name: "使用指南", exact: true }).click();
await page.getByText("导入 QMT，先做历史回测", { exact: true }).waitFor();
await expect(page.getByLabel("要导入的脚本", { exact: true })).toBeVisible();
await page
  .getByRole("button", { name: "这一步已完成，下一步", exact: true })
  .click();
await expect(
  page.getByRole("button", { name: "复制完整脚本", exact: true }),
).toBeVisible();
await page
  .getByRole("button", { name: "这一步已完成，下一步", exact: true })
  .click();
await expect(page.locator(".import-settings")).toContainText("日线（1d）");
await page.getByRole("button", { name: "重新查看步骤", exact: true }).click();

await page.getByRole("button", { name: "新建策略 NEW", exact: true }).click();
await page.getByRole("button", { name: "理解我的策略", exact: true }).click();
await page.getByRole("alert").waitFor();
await expect(
  page.getByRole("textbox", { name: "策略想法", exact: true }),
).toHaveAttribute("aria-invalid", "true");
await page
  .getByRole("textbox", { name: "策略想法", exact: true })
  .fill("5 日均线上穿 20 日均线买入，下穿卖出。");
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(".runtime/mobile.png"), fullPage: true });
const mobilePrimary = await page
  .getByRole("button", { name: "理解我的策略", exact: true })
  .boundingBox();
if (
  !mobilePrimary ||
  mobilePrimary.y < 0 ||
  mobilePrimary.y + mobilePrimary.height > 844
)
  throw new Error("Mobile creation action is outside the viewport");
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth > innerWidth,
);
await page.getByRole("button", { name: "打开导航", exact: true }).click();
await page.getByRole("button", { name: "使用指南", exact: true }).click();
await page.getByText("导入 QMT，先做历史回测", { exact: true }).waitFor();
await browser.close();
if (errors.length || overflow)
  throw new Error(JSON.stringify({ errors, overflow }));
console.log(
  JSON.stringify({
    passed: true,
    checks: [
      "desktop primary action visible at 1280x720",
      "independent drafts and parameters across modes",
      "dedicated result workspace",
      "saved strategy copying",
      "library filters and persistent renaming",
      "recent symbol and timestamp",
      "mobile primary action visible",
      "editable confirmation and field errors",
      "confirmed parameters used in generated code",
      "template generation",
      "static report",
      "GBK download",
      "Chinese PDF report download",
      "history reopen",
      "official docs",
      "guide",
      "empty input",
      "mobile navigation focus and close",
      "template preview and QMT import guide",
      "no horizontal overflow",
      "no browser errors",
    ],
  }),
);
