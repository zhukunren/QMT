import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { defaultSpec, type Plan, type Job, type Artifact } from "@qmt/shared";
import { createApp } from "../apps/api/src/app";
import { Store } from "../apps/api/src/store";
import { validateScript } from "../apps/api/src/validation";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup(validator?: typeof validateScript) {
  const store = new Store(":memory:");
  const app = await createApp({ store, validator });
  cleanups.push(async () => {
    await app.close();
    store.close();
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/plans",
    payload: { provider: "template", prompt: "", spec: defaultSpec },
  });
  expect(response.statusCode, response.body).toBe(200);
  return { app, store, plan: response.json<Plan>() };
}
async function finish(app: Awaited<ReturnType<typeof setup>>["app"], job: Job) {
  for (
    let i = 0;
    i < 50 && (job.status === "queued" || job.status === "running");
    i++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    job = (await app.inject(`/api/jobs/${job.id}`)).json<Job>();
  }
  return job;
}

describe("confirmed revisions and idempotent generation", () => {
  it("generates the edited rules and keeps the original plan immutable", async () => {
    const { app, store, plan } = await setup();
    const revisedResponse = await app.inject({
      method: "POST",
      url: `/api/plans/${plan.id}/revisions`,
      payload: { spec: { ...plan.spec, fastWindow: 10, maxPositionPct: 15 } },
    });
    expect(revisedResponse.statusCode, revisedResponse.body).toBe(200);
    const revised = revisedResponse.json<Plan>();
    expect(revised.id).not.toBe(plan.id);
    expect(revised.revisionOf).toBe(plan.id);
    expect(revised.summary).toContain("10 日均线");
    expect(store.get<Plan>("plan", plan.id)?.spec.fastWindow).toBe(5);
    const started = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: { planId: revised.id, requestId: randomUUID() },
    });
    const job = await finish(app, started.json<Job>());
    expect(job.status, job.error).toBe("completed");
    const output = store.get<Artifact>("artifact", job.artifactId!)!;
    expect(output.code).toContain("FAST = 10");
    expect(output.code).toContain("MAX_POSITION = 0.15");
    expect(output.summary).toBe(revised.summary);
  });
  it("rejects invalid edits and budget relaxation with field-specific errors", async () => {
    const { app, plan } = await setup();
    for (const [change, key] of [
      [{ maxPositionPct: 30 }, "maxPositionPct"],
      [{ fastWindow: 25 }, "slowWindow"],
      [{ symbol: "688001.SH" }, "symbol"],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: `/api/plans/${plan.id}/revisions`,
        payload: { spec: { ...plan.spec, ...change } },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().fields[key]).toBeTruthy();
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/plans/${plan.id}/revisions`,
          payload: { spec: defaultSpec, code: "untrusted" },
        })
      ).statusCode,
    ).toBe(400);
  });
  it("replays running and completed requests without creating duplicate artifacts", async () => {
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { app, store, plan } = await setup(async (code) => {
      await blocked;
      return validateScript(code);
    });
    const requestId = randomUUID();
    const payload = { planId: plan.id, requestId };
    const first = (
      await app.inject({ method: "POST", url: "/api/jobs", payload })
    ).json<Job>();
    const replay = (
      await app.inject({ method: "POST", url: "/api/jobs", payload })
    ).json<Job>();
    expect(replay.id).toBe(first.id);
    const conflict = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: { planId: randomUUID(), requestId },
    });
    expect(conflict.statusCode).toBe(409);
    release();
    expect((await finish(app, first)).status).toBe("completed");
    const completed = (
      await app.inject({ method: "POST", url: "/api/jobs", payload })
    ).json<Job>();
    expect(completed.id).toBe(first.id);
    expect(completed.status).toBe("completed");
    expect(store.list("artifact")).toHaveLength(1);
  });
  it("requires a new request ID to retry an explicitly failed job", async () => {
    let attempts = 0;
    const { app, store, plan } = await setup(async (code) => {
      if (++attempts === 1) throw new Error("临时校验失败");
      return validateScript(code);
    });
    const payload = { planId: plan.id, requestId: randomUUID() };
    const first = await finish(
      app,
      (
        await app.inject({ method: "POST", url: "/api/jobs", payload })
      ).json<Job>(),
    );
    expect(first.status).toBe("failed");
    const replay = (
      await app.inject({ method: "POST", url: "/api/jobs", payload })
    ).json<Job>();
    expect(replay.id).toBe(first.id);
    const retry = await finish(
      app,
      (
        await app.inject({
          method: "POST",
          url: "/api/jobs",
          payload: { ...payload, requestId: randomUUID() },
        })
      ).json<Job>(),
    );
    expect(retry.status, retry.error).toBe("completed");
    expect(retry.id).not.toBe(first.id);
    expect(store.list("artifact")).toHaveLength(1);
  });
  it("requires fresh confirmation for expired plans", async () => {
    const { app, store, plan } = await setup();
    store.save("plan", {
      ...plan,
      createdAt: new Date(Date.now() - 90000000).toISOString(),
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/jobs",
          payload: { planId: plan.id },
        })
      ).json().code,
    ).toBe("PLAN_EXPIRED");
    const reviewed = (
      await app.inject({
        method: "POST",
        url: `/api/plans/${plan.id}/revisions`,
        payload: { spec: plan.spec },
      })
    ).json<Plan>();
    expect(Date.now() - Date.parse(reviewed.createdAt)).toBeLessThan(5000);
    expect(reviewed.spec).toEqual(plan.spec);
  });
});
