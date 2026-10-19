import { chromium, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import iconv from "iconv-lite";

// Generates default-disabled source only; never opens QMT or places a broker order.
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
});
const errors = [];
try {
  await mkdir(".runtime", { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5174/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "模板体验", exact: true }).click();
  await page.getByLabel("生成用途", { exact: true }).selectOption("live");
  await page.getByRole("button", { name: "确认模板参数", exact: true }).click();
  const review = page.getByRole("dialog");
  await expect(
    review.getByRole("combobox", { name: "运行方式", exact: true }),
  ).toHaveValue("live");
  await expect(review.locator(".review-conventions")).toContainText(
    "实盘脚本默认关闭交易开关",
  );
  await review
    .getByRole("button", { name: "确认并生成脚本", exact: true })
    .click();
  await page
    .getByRole("button", { name: "下载 Python 脚本", exact: true })
    .waitFor({ timeout: 20000 });
  await expect(page.locator(".strategy-properties")).toContainText("实盘交易");
  await page.screenshot({
    path: resolve(".runtime/live-result.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Python 脚本", exact: true }).click();
  await expect(page.locator(".code-block")).toContainText(
    "LIVE_TRADING_ENABLED = False",
  );
  await expect(page.locator(".code-block")).toContainText("def order_callback");
  const [script] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "下载 Python 脚本", exact: true }).click(),
  ]);
  await script.saveAs(resolve(".runtime/live-generated.py"));
  const code = iconv.decode(
    await readFile(".runtime/live-generated.py"),
    "gbk",
  );
  if (
    !code.includes("LIVE_TRADING_ENABLED = False") ||
    !code.includes("def deal_callback")
  )
    throw Error("Invalid live source download");
  const [report] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "下载校验报告（PDF）", exact: true })
      .click(),
  ]);
  await report.saveAs(resolve(".runtime/live-generated-report.pdf"));
  if (
    (await readFile(".runtime/live-generated-report.pdf"))
      .subarray(0, 5)
      .toString() !== "%PDF-"
  )
    throw Error("Invalid PDF");
  await page.getByRole("button", { name: "文档依据", exact: true }).click();
  await expect(page.locator(".source-list")).toContainText("order_callback");
  await page.getByRole("button", { name: "开始导入指引", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "实盘脚本配置与验收", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".live-import-guide")).toContainText(
    "ACCOUNT_READY_STATUS",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Mobile guide overflow");
  await page.screenshot({
    path: resolve(".runtime/live-guide-mobile.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "官方文档", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "实盘官方文档专题" })
    .getByRole("button", { name: "委托状态", exact: true })
    .click();
  await expect(page.locator(".document-passages")).toContainText(
    "enum_EEntrustStatus",
  );
  if (errors.length) throw Error(JSON.stringify(errors));
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "live selection and review",
        "default-off live generation",
        "GBK download",
        "live PDF",
        "official live citations",
        "QMT local activation guide",
        "mobile layout",
        "official status-enum search",
        "no real broker connection",
      ],
    }),
  );
} finally {
  await browser.close();
}
