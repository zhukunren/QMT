import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

await mkdir(".runtime", { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:5174/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "官方文档", exact: true }).click();
  await expect(page.getByRole("heading", { name: "检索章节正文", exact: true })).toBeVisible();
  await expect(page.locator(".docs-banner")).toContainText("15 / 15");
  await page.getByLabel("文档关键词").fill("get_market_data_ex");
  await page.getByLabel("文档范围").selectOption("qmt-data-function");
  await page.getByRole("button", { name: "检索正文", exact: true }).click();
  const first = page.locator(".document-passage").first();
  await expect(first.locator("pre")).toContainText("dividend_type");
  await expect(first.locator("pre")).toContainText("subscribe=True");
  await expect(first.getByRole("link", { name: /在官网打开本章节/ })).toHaveAttribute("href", /data_function\.html#/);
  const more = first.getByRole("button", { name: /阅读同章节片段/ });
  if (await more.count()) {
    await more.first().click();
    await expect(more).toHaveCount(0);
  }
  await page.getByRole("heading", { name: "检索章节正文" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(".runtime/documents-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("文档范围").selectOption("qmt-trading-function");
  await page.getByLabel("文档关键词").fill("passorder");
  await page.getByRole("button", { name: "检索正文", exact: true }).click();
  await expect(page.locator(".document-passage").first().locator("summary")).toContainText("综合下单函数");
  await page.getByRole("heading", { name: "检索章节正文" }).scrollIntoViewIfNeeded();
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error("Mobile document reader overflows viewport");
  await page.screenshot({ path: resolve(".runtime/documents-mobile.png") });
  if (errors.length) throw new Error(JSON.stringify(errors));
} finally { await browser.close(); }

// Longest template source list: exercise its PDF, GBK export, and anchored evidence.
const request = async (path, options) => {
  const response = await fetch(`http://127.0.0.1:8000/api${path}`, options);
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response;
};
const spec = { name: "正文引用回测验证", kind: "ma_cross", symbol: "600000.SH", fastWindow: 5, slowWindow: 20, threshold: 0.03, maxPositionPct: 20, maxOrderValue: 10000, execution: "backtest" };
const plan = await (await request("/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "template", prompt: "", spec }) })).json();
let job = await (await request("/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: plan.id }) })).json();
for (let i = 0; i < 80 && !["completed", "failed"].includes(job.status); i++) {
  await new Promise(r => setTimeout(r, 100));
  job = await (await request(`/jobs/${job.id}`)).json();
}
if (job.status !== "completed") throw new Error(job.error || "Generation incomplete");
const artifact = await (await request(`/artifacts/${job.artifactId}`)).json();
if (!artifact.report.passed || !artifact.sources.every(s => s.excerpt && s.url.includes("#"))) throw new Error("Missing validated chapter references");
const pdf = await (await request(`/artifacts/${artifact.id}/report`)).arrayBuffer();
await writeFile(".runtime/documents-report.pdf", Buffer.from(pdf));
await writeFile(".runtime/documents-artifact.json", JSON.stringify(artifact, null, 2));
await request(`/artifacts/${artifact.id}/download`);
console.log(JSON.stringify({ passed: true, checks: ["desktop full-text search", "chapter anchors", "continuation reads", "mobile reader", "no overflow or browser errors", "backtest chapter evidence", "PDF and GBK downloads"], artifactId: artifact.id, citations: artifact.sources.length }));
