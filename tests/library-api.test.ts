import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import iconv from "iconv-lite";
import {
  artifactFilename,
  defaultSpec,
  explainSpec,
  type Artifact,
  type ArtifactSummary,
  type ValidationReport,
  type Plan,
  type Job,
} from "@qmt/shared";
import { createApp } from "../apps/api/src/app";
import { Store } from "../apps/api/src/store";
import { renderScript } from "../apps/api/src/template";
import { validateScript } from "../apps/api/src/validation";

const code = renderScript(defaultSpec);
let report: ValidationReport;
beforeAll(async () => {
  report = await validateScript(code);
});
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup(token?: string) {
  const store = new Store(":memory:");
  const app = await createApp({ store, token });
  const item: Artifact = {
    id: randomUUID(),
    createdAt: "2026-10-19T10:00:00Z",
    provider: "template",
    prompt: "",
    spec: { ...defaultSpec },
    summary: explainSpec(defaultSpec),
    assumptions: [],
    sources: [],
    code,
    report,
  };
  store.save("artifact", item);
  cleanups.push(async () => {
    await app.close();
    store.close();
  });
  return { store, app, item };
}
describe("script metadata management", () => {
  it("deletes only the selected script and blocks its details, downloads, report and rename", async () => {
    const { app, item, store } = await setup();
    const other = { ...item, id: randomUUID(), displayName: "保留的脚本" };
    store.save("artifact", other);
    const removed = await app.inject({
      method: "DELETE",
      url: `/api/artifacts/${item.id}`,
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json()).toEqual({ id: item.id, deleted: true });
    expect(store.get("artifact", item.id)).toBeUndefined();
    expect(
      (await app.inject("/api/artifacts"))
        .json<ArtifactSummary[]>()
        .map((entry) => entry.id),
    ).toEqual([other.id]);
    for (const suffix of ["", "/download", "/report"])
      expect(
        (await app.inject(`/api/artifacts/${item.id}${suffix}`)).statusCode,
      ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/artifacts/${item.id}/rename`,
          payload: { name: "已删除的脚本" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject(`/api/artifacts/${other.id}`)).json<Artifact>().code,
    ).toBe(item.code);
    expect(
      (await app.inject({ method: "DELETE", url: `/api/artifacts/${item.id}` }))
        .statusCode,
    ).toBe(404);
  });
  it("requires the configured token for deletion and supports DELETE preflight", async () => {
    const { app, item, store } = await setup("delete-token");
    expect(
      (await app.inject({ method: "DELETE", url: `/api/artifacts/${item.id}` }))
        .statusCode,
    ).toBe(401);
    expect(store.get("artifact", item.id)).toBeDefined();
    const headers = { authorization: "Bearer delete-token" };
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/api/artifacts/not-a-uuid",
          headers,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/artifacts/${randomUUID()}`,
          headers,
        })
      ).statusCode,
    ).toBe(404);
    const preflight = await app.inject({
      method: "OPTIONS",
      url: `/api/artifacts/${item.id}`,
      headers: {
        origin: "http://127.0.0.1:5174",
        "access-control-request-method": "DELETE",
      },
    });
    expect(String(preflight.headers["access-control-allow-methods"])).toContain(
      "DELETE",
    );
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/artifacts/${item.id}`,
          headers,
        })
      ).statusCode,
    ).toBe(200);
  });
  it("keeps generation history without replaying a deleted artifact", async () => {
    const { app, item, store } = await setup();
    const plan: Plan = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      provider: "template",
      prompt: "",
      spec: { ...defaultSpec },
      summary: "原始确认",
      assumptions: [],
    };
    const job: Job = {
      id: randomUUID(),
      planId: plan.id,
      requestId: randomUUID(),
      status: "completed",
      stage: 4,
      artifactId: item.id,
      events: [{ at: plan.createdAt, message: "已生成" }],
    };
    store.save("plan", plan);
    store.save("job", job);
    await app.inject({ method: "DELETE", url: `/api/artifacts/${item.id}` });
    const replay = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: { planId: plan.id, requestId: job.requestId },
    });
    expect(replay.statusCode).toBe(410);
    expect(replay.json().code).toBe("ARTIFACT_DELETED");
    expect((await app.inject(`/api/jobs/${job.id}`)).statusCode).toBe(410);
    expect(store.get("plan", plan.id)).toEqual(plan);
    expect(store.get("job", job.id)).toEqual(job);
    expect(store.list("artifact")).toHaveLength(0);
  });
  it("rolls back deletion if its audit entry cannot be written", async () => {
    const { app, item, store } = await setup();
    const audit = store.audit;
    store.audit = () => {
      throw new Error("simulated audit write failure");
    };
    expect(
      (await app.inject({ method: "DELETE", url: `/api/artifacts/${item.id}` }))
        .statusCode,
    ).toBe(500);
    expect(store.get("artifact", item.id)).toEqual(item);
    store.audit = audit;
    expect(
      (await app.inject({ method: "DELETE", url: `/api/artifacts/${item.id}` }))
        .statusCode,
    ).toBe(200);
  });
  it("persists a renamed label without changing generated code or its checksum", async () => {
    const { app, item } = await setup();
    const rename = await app.inject({
      method: "POST",
      url: `/api/artifacts/${item.id}/rename`,
      payload: { name: "  浦发双均线研究  " },
    });
    expect(rename.statusCode, rename.body).toBe(200);
    const result = rename.json<ArtifactSummary>();
    expect(result.displayName).toBe("浦发双均线研究");
    expect(result).not.toHaveProperty("code");
    const saved = (
      await app.inject(`/api/artifacts/${item.id}`)
    ).json<Artifact>();
    expect(saved.displayName).toBe(result.displayName);
    expect(saved.createdAt).toBe(item.createdAt);
    expect(saved.spec).toEqual(item.spec);
    expect(saved.code).toBe(item.code);
    expect(saved.report).toEqual(item.report);
    expect(
      (await app.inject("/api/artifacts")).json<ArtifactSummary>()[0]
        .displayName,
    ).toBe(result.displayName);
    const file = await app.inject(`/api/artifacts/${item.id}/download`);
    expect(file.statusCode).toBe(200);
    const encoded = String(file.headers["content-disposition"]).split(
      "filename*=UTF-8''",
    )[1];
    expect(decodeURIComponent(encoded)).toBe(artifactFilename(saved));
    expect(iconv.decode(file.rawPayload, "gbk")).toBe(item.code);
    const pdf = await app.inject(`/api/artifacts/${item.id}/report`);
    expect(pdf.statusCode).toBe(200);
    expect(
      decodeURIComponent(
        String(pdf.headers["content-disposition"]).split(
          "filename*=UTF-8''",
        )[1],
      ),
    ).toBe(artifactFilename(saved, true));
  });
  it("rejects invalid names and unexpected content", async () => {
    const { app, item } = await setup();
    for (const name of [" ", "单", "名".repeat(61), "策略\n注入"]) {
      const response = await app.inject({
        method: "POST",
        url: `/api/artifacts/${item.id}/rename`,
        payload: { name },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().fields.name).toBeTruthy();
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/artifacts/${item.id}/rename`,
          payload: { name: "测试策略", code: "changed" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await app.inject(`/api/artifacts/${item.id}`)).json<Artifact>()
        .displayName,
    ).toBeUndefined();
  });
  it("protects metadata writes with the configured token and handles missing records", async () => {
    const { app, item } = await setup("rename-token");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/artifacts/${item.id}/rename`,
          payload: { name: "新名称" },
        })
      ).statusCode,
    ).toBe(401);
    const headers = { authorization: "Bearer rename-token" };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/artifacts/${randomUUID()}/rename`,
          headers,
          payload: { name: "新名称" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/artifacts/${item.id}/rename`,
          headers,
          payload: { name: "新名称" },
        })
      ).statusCode,
    ).toBe(200);
  });
  it("keeps failed integrity checks blocked after a rename", async () => {
    const { app, item, store } = await setup();
    store.save("artifact", {
      ...item,
      code: item.code + "\nimport os\n",
      report: { ...report, passed: false },
    });
    const renamed = await app.inject({
      method: "POST",
      url: `/api/artifacts/${item.id}/rename`,
      payload: { name: "整理后的记录" },
    });
    expect(renamed.json<ArtifactSummary>().report.passed).toBe(false);
    expect(
      (await app.inject(`/api/artifacts/${item.id}/download`)).statusCode,
    ).toBe(409);
  });
});
