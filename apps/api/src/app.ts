import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import iconv from "iconv-lite";
import { z } from "zod";
import {
  generateSchema,
  specSchema,
  specErrors,
  explainSpec,
  artifactFilename,
  scriptNameSchema,
  type Artifact,
  type Plan,
  type Job,
} from "@qmt/shared";
import {
  sources,
  documentStatus,
  getPassage,
  searchDocuments,
  templateSources,
  mergeSources,
} from "./sources.js";
import { interpret, assumptionsFor } from "./agent.js";
import { renderScript } from "./template.js";
import { validateScript } from "./validation.js";
import { Store } from "./store.js";
import { renderReportPdf } from "./report.js";

type Options = {
  store: Store;
  logger?: boolean;
  interpreter?: typeof interpret;
  validator?: typeof validateScript;
  token?: string;
};
function downloadDisposition(item: Artifact, report = false) {
  const fallback = `qmt_${item.id.slice(0, 8)}${report ? "_report.pdf" : ".py"}`;
  const encoded = encodeURIComponent(artifactFilename(item, report)).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
export async function createApp({
  store,
  logger = false,
  interpreter = interpret,
  validator = validateScript,
  token = process.env.API_TOKEN,
}: Options) {
  const app = Fastify({ logger, bodyLimit: 24000, requestTimeout: 140000 });
  await app.register(helmet);
  const allowed = (
    process.env.WEB_ORIGINS || "http://127.0.0.1:5174,http://localhost:5174"
  ).split(",");
  await app.register(cors, {
    origin: allowed,
    methods: ["GET", "POST", "DELETE"],
    credentials: false,
  });
  await app.register(rateLimit, { max: 180, timeWindow: "1 minute" });
  let activePlans = 0;
  let activeJobs = 0;
  let activeReports = 0;
  const pythonAvailable =
    spawnSync(process.env.PYTHON_PATH || "python", ["--version"], {
      timeout: 3000,
      windowsHide: true,
    }).status === 0;
  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/api/health" || req.method === "OPTIONS" || !token) return;
    const received = req.headers.authorization?.replace(/^Bearer /, "") || "";
    if (
      Buffer.byteLength(received) !== Buffer.byteLength(token) ||
      !timingSafeEqual(Buffer.from(received), Buffer.from(token))
    ) {
      return reply
        .code(401)
        .send({ error: "请在连接设置中填写管理员提供的访问令牌。" });
    }
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: "请检查标记的输入项。",
        code: "INVALID_INPUT",
        fields: Object.fromEntries(
          error.issues.map((i) => [i.path.at(-1), i.message]),
        ),
      });
    req.log.error({ err: error }, "Request failed");
    const status = (error as { statusCode?: number }).statusCode || 500;
    return reply.code(status).send({
      error:
        status === 429
          ? "请求过于频繁，请稍后重试。"
          : status < 500
            ? "请求无效，请检查输入。"
            : "服务暂时不可用，请稍后重试或联系管理员。",
    });
  });
  app.get("/api/health", async () => ({
    status: "ok",
    version: "0.1.0",
    codexEnabled: process.env.ENABLE_CODEX !== "false",
    credentialsPresent: Boolean(
      process.env.CODEX_API_KEY ||
      process.env.OPENAI_API_KEY ||
      existsSync(
        join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json"),
      ),
    ),
    model: process.env.CODEX_MODEL || "沿用服务端 Codex 配置",
    pythonAvailable,
    authRequired: Boolean(token),
  }));
  app.get("/api/sources", async () => sources);
  app.get("/api/documents/status", async () => documentStatus);
  app.get("/api/documents/search", async (req) => {
    const { q, limit, pageId } = z
      .object({
        q: z.string().trim().min(2).max(300),
        limit: z.coerce.number().int().min(1).max(12).default(6),
        pageId: z.string().max(80).optional(),
      })
      .strict()
      .parse(req.query);
    return { ...documentStatus, passages: searchDocuments(q, limit, pageId) };
  });
  app.get("/api/documents/chunks/:id", async (req, reply) => {
    const { id } = z
      .object({
        id: z
          .string()
          .regex(/^qmt-[a-z-]+:\d+:\d+$/)
          .max(140),
      })
      .parse(req.params);
    return (
      getPassage(id) ||
      reply.code(404).send({ error: "未找到该文档正文片段。" })
    );
  });
  app.get("/api/artifacts", async () =>
    store.list<Artifact>("artifact").map(({ code, ...rest }) => rest),
  );
  const ids = z.object({ id: z.string().uuid() });
  app.get("/api/artifacts/:id", async (req, reply) => {
    const { id } = ids.parse(req.params);
    const item = store.get<Artifact>("artifact", id);
    return item || reply.code(404).send({ error: "未找到该脚本" });
  });
  app.delete("/api/artifacts/:id", async (req, reply) => {
    const { id } = ids.parse(req.params);
    if (!store.deleteArtifact(id))
      return reply
        .code(404)
        .send({
          error: "脚本已不存在，请刷新列表。",
          code: "ARTIFACT_MISSING",
        });
    return { id, deleted: true };
  });
  app.post("/api/artifacts/:id/rename", async (req, reply) => {
    const { id } = ids.parse(req.params);
    const { name } = z
      .object({ name: scriptNameSchema })
      .strict()
      .parse(req.body);
    const item = store.get<Artifact>("artifact", id);
    if (!item)
      return reply
        .code(404)
        .send({ error: "未找到该脚本，请刷新列表后重试。" });
    const updated: Artifact = {
      ...item,
      displayName: name,
      renamedAt: new Date().toISOString(),
    };
    store.save("artifact", updated);
    store.audit("artifact.renamed", id);
    const { code, ...summary } = updated;
    return summary;
  });
  app.post(
    "/api/plans",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const input = generateSchema.parse(req.body);
      if (input.provider === "codex" && input.prompt.length < 5)
        return reply
          .code(400)
          .send({ error: "请用一句话描述您希望何时买入、何时卖出。" });
      if (activePlans >= 2)
        return reply
          .code(429)
          .send({ error: "当前有其他需求正在处理，请稍后重试。" });
      activePlans++;
      try {
        const result = await interpreter(input);
        const plan: Plan = {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          provider: input.provider,
          prompt: input.prompt,
          ...result,
          sources: mergeSources(
            templateSources(result.spec),
            result.sources || [],
          ),
          riskLimits: {
            maxPositionPct: input.spec.maxPositionPct,
            maxOrderValue: input.spec.maxOrderValue,
          },
        };
        store.save("plan", plan);
        store.audit("plan.created", plan.id);
        return plan;
      } catch (error) {
        req.log.warn({ err: error }, "Strategy interpretation rejected");
        const msg = error instanceof Error ? error.message : "";
        const known =
          /^[\u4e00-\u9fff]/.test(msg) ||
          msg.startsWith("Codex ") ||
          msg.startsWith("Agent ");
        return reply.code(422).send({
          error:
            known && msg.length < 1600
              ? msg.replace(/\b(?:Codex|OpenAI)\b/gi, "智能服务")
              : "智能理解暂不可用，请联系管理员检查服务配置，或选择模板体验。",
        });
      } finally {
        activePlans--;
      }
    },
  );
  app.post("/api/plans/:id/revisions", async (req, reply) => {
    const { id } = ids.parse(req.params);
    const original = store.get<Plan>("plan", id);
    if (!original)
      return reply.code(404).send({
        error: "原策略已不存在，请返回描述页重新理解需求。",
        code: "PLAN_MISSING",
      });
    const { spec } = z.object({ spec: specSchema }).strict().parse(req.body);
    const riskLimits = original.riskLimits || {
      maxPositionPct: original.spec.maxPositionPct,
      maxOrderValue: original.spec.maxOrderValue,
    };
    const fields = specErrors(spec, riskLimits);
    if (Object.keys(fields).length)
      return reply.code(400).send({
        error: "修改后的预算超过创建时的上限。",
        code: "INVALID_INPUT",
        fields,
      });
    const changes = (Object.keys(spec) as (keyof typeof spec)[]).filter(
      (key) => spec[key] !== original.spec[key],
    );
    const revised: Plan = {
      ...original,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      revisionOf: original.id,
      riskLimits,
      editedFields: [
        ...new Set([...(original.editedFields || []), ...changes]),
      ],
      spec,
      summary: explainSpec(spec),
      sources: changes.length ? templateSources(spec) : original.sources,
      retrieval: changes.length ? undefined : original.retrieval,
      assumptions: changes.length
        ? [
            "本次规则由您在确认页修改并确认，以当前参数和买卖条件为准。",
            ...assumptionsFor(spec),
          ]
        : original.assumptions,
    };
    store.save("plan", revised);
    store.audit("plan.revised", revised.id);
    return revised;
  });
  app.post("/api/jobs", async (req, reply) => {
    const { planId, requestId } = z
      .object({
        planId: z.string().uuid(),
        requestId: z.string().uuid().optional(),
      })
      .strict()
      .parse(req.body);
    if (requestId) {
      const existing = store.jobForRequest(requestId);
      if (existing) {
        if (existing.planId !== planId)
          return reply.code(409).send({
            error: "这次请求已关联其他策略，请重新确认。",
            code: "REQUEST_CONFLICT",
          });
        if (
          existing.status === "completed" &&
          existing.artifactId &&
          !store.get<Artifact>("artifact", existing.artifactId)
        )
          return reply
            .code(410)
            .send({
              error: "生成的脚本已删除，请重新确认后生成新脚本。",
              code: "ARTIFACT_DELETED",
            });
        return reply.code(202).send(existing);
      }
    }
    const plan = store.get<Plan>("plan", planId);
    if (!plan)
      return reply.code(404).send({
        error: "策略确认已失效，请重新描述需求。",
        code: "PLAN_MISSING",
      });
    if (Date.now() - Date.parse(plan.createdAt) > 86400000)
      return reply.code(409).send({
        error: "策略确认已过期，请重新核对规则后生成。",
        code: "PLAN_EXPIRED",
      });
    specSchema.parse(plan.spec);
    if (activeJobs >= 2)
      return reply.code(429).send({ error: "生成服务繁忙，请稍后重试。" });
    const job: Job = {
      id: randomUUID(),
      planId,
      requestId,
      status: "queued",
      stage: 0,
      events: [
        { at: new Date().toISOString(), message: "策略已确认，准备生成" },
      ],
    };
    store.save("job", job);
    activeJobs++;
    void (async () => {
      const step = (stage: number, message: string) => {
        job.status = "running";
        job.stage = stage;
        job.events.push({ at: new Date().toISOString(), message });
        store.save("job", job);
      };
      try {
        step(1, "正在根据已确认的规则生成 Python 脚本");
        const evidence = plan.sources?.length
          ? plan.sources
          : templateSources(plan.spec);
        const code = renderScript(plan.spec, evidence);
        step(2, "正在检查 Python 语法、数据边界与风险规则");
        const report = await validator(code);
        step(3, "检查已完成，正在保存脚本与校验报告");
        const artifact: Artifact = {
          ...plan,
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          code,
          report,
          sources: evidence,
        };
        store.save("artifact", artifact);
        store.audit("artifact.created", artifact.id);
        job.status = "completed";
        job.stage = 4;
        job.artifactId = artifact.id;
        job.events.push({
          at: new Date().toISOString(),
          message: report.passed
            ? "静态校验通过，待 QMT 客户端验收"
            : "校验未通过，已阻止下载",
        });
      } catch (error) {
        job.status = "failed";
        job.error = error instanceof Error ? error.message : "生成失败，请重试";
      } finally {
        store.save("job", job);
        activeJobs--;
      }
    })();
    return reply.code(202).send(job);
  });
  app.get("/api/jobs/:id", async (req, reply) => {
    const { id } = ids.parse(req.params);
    const job = store.get<Job>("job", id);
    if (
      job?.status === "completed" &&
      job.artifactId &&
      !store.get<Artifact>("artifact", job.artifactId)
    )
      return reply
        .code(410)
        .send({
          error: "生成的脚本已删除，请重新确认后生成新脚本。",
          code: "ARTIFACT_DELETED",
        });
    return job || reply.code(404).send({ error: "任务不存在" });
  });
  app.get("/api/artifacts/:id/download", async (req, reply) => {
    const { id } = ids.parse(req.params);
    const item = store.get<Artifact>("artifact", id);
    if (!item) return reply.code(404).send({ error: "脚本不存在" });
    // Recheck saved content to fail closed if a stored artifact has changed.
    const report = await validateScript(item.code);
    if (!report.passed || report.codeHash !== item.report.codeHash)
      return reply
        .code(409)
        .send({ error: "脚本校验或完整性检查失败，已阻止导出。" });
    store.audit("artifact.downloaded", id);
    return reply
      .header("Content-Disposition", downloadDisposition(item))
      .type("application/octet-stream")
      .send(iconv.encode(item.code, "gbk"));
  });
  app.get(
    "/api/artifacts/:id/report",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { id } = ids.parse(req.params);
      const item = store.get<Artifact>("artifact", id);
      if (!item) return reply.code(404).send({ error: "报告不存在" });
      if (
        createHash("sha256").update(item.code).digest("hex") !==
        item.report.codeHash
      )
        return reply
          .code(409)
          .send({ error: "脚本完整性检查失败，无法导出对应校验报告。" });
      if (activeReports >= 2)
        return reply
          .code(429)
          .send({ error: "PDF 报告生成服务繁忙，请稍后重试。" });
      activeReports++;
      try {
        const pdf = await renderReportPdf(item);
        store.audit("report.downloaded", id);
        return reply
          .header("Content-Disposition", downloadDisposition(item, true))
          .header("Cache-Control", "no-store")
          .type("application/pdf")
          .send(pdf);
      } finally {
        activeReports--;
      }
    },
  );
  return app;
}
