import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

// Creates and deletes only this script's unique test artifact; existing records are untouched.
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
});
let ownArtifactId;
let page;
try {
  await mkdir(".runtime", { recursive: true });
  page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5174/", { waitUntil: "networkidle" });
  const name = `删除功能验证-${Date.now()}`;
  await page.getByRole("button", { name: "模板体验", exact: true }).click();
  await page.getByRole("textbox", { name: "策略名称", exact: true }).fill(name);
  await page.getByRole("button", { name: "确认模板参数", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认并生成脚本", exact: true })
    .click();
  await page
    .getByRole("button", { name: "下载 Python 脚本", exact: true })
    .waitFor({ timeout: 20000 });
  const records = await (
    await page.request.get("http://127.0.0.1:5174/api/artifacts")
  ).json();
  const created = records.find((item) => item.spec.name === name);
  if (!created) throw Error("Own test artifact was not found");
  ownArtifactId = created.id;
  const endpoint = `http://127.0.0.1:5174/api/artifacts/${created.id}`;
  await page.evaluate(
    (id) =>
      localStorage.setItem(
        `qmt.import-guide.v1.${id}`,
        '{"version":1,"active":0,"completed":[]}',
      ),
    created.id,
  );
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: /我的脚本/ })
    .click();
  const row = page.getByRole("article", {
    name: `${name} · ${created.spec.symbol}`,
    exact: true,
  });
  await expect(
    row.getByRole("button", { name: "删除", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".runtime/delete-list.png",
    animations: "disabled",
  });
  await row.getByRole("button", { name: "删除", exact: true }).click();
  const dialog = page.getByRole("alertdialog", {
    name: "删除这份脚本？",
    exact: true,
  });
  await expect(dialog).toContainText(name);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "删除", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    row.getByRole("button", { name: "删除", exact: true }),
  ).toBeFocused();

  let deletes = 0;
  let releaseDelete;
  const hold = new Promise((resolve) => {
    releaseDelete = resolve;
  });
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    deletes++;
    if (deletes === 1)
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "删除未完成测试，请重试。" }),
      });
    await hold;
    return route.continue();
  });
  await row.getByRole("button", { name: "删除", exact: true }).click();
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("删除未完成测试");
  await expect(row).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".runtime/delete-confirm-mobile.png",
    animations: "disabled",
  });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Mobile delete dialog overflow");
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "正在删除…", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "取消", exact: true }),
  ).toBeDisabled();
  releaseDelete();
  await expect(dialog).toHaveCount(0);
  await expect(row).toHaveCount(0);
  if (deletes !== 2) throw Error("Duplicate delete submission");
  await page.unroute(endpoint);
  await expect(page.locator(".sidebar-recents")).not.toContainText(name);
  if (
    await page.evaluate(
      (id) => localStorage.getItem(`qmt.import-guide.v1.${id}`),
      created.id,
    )
  )
    throw Error("Guide progress remained after deletion");
  const remaining = await (
    await page.request.get("http://127.0.0.1:5174/api/artifacts")
  ).json();
  if (remaining.length)
    await expect(page.locator(".nav-count")).toHaveText(
      String(remaining.length),
    );
  else await expect(page.locator(".nav-count")).toHaveCount(0);
  for (const suffix of ["", "/download", "/report"])
    if ((await page.request.get(endpoint + suffix)).status() !== 404)
      throw Error("Deleted resource remained accessible");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: /我的脚本/ })
    .click();
  await expect(row).toHaveCount(0);
  if (errors.length) throw Error(JSON.stringify(errors));
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "own fixture only",
        "delete button",
        "cancel and Escape",
        "failure and retry",
        "pending submission lock",
        "mobile confirmation",
        "sidebar and count sync",
        "guide progress cleanup",
        "reload persistence",
        "deleted exports blocked",
      ],
    }),
  );
} finally {
  if (ownArtifactId && page)
    await page.request
      .delete(`http://127.0.0.1:5174/api/artifacts/${ownArtifactId}`)
      .catch(() => {});
  await browser.close();
}
