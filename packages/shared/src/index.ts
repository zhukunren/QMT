import { z } from "zod";

export const strategyKinds = [
  "ma_cross",
  "momentum",
  "mean_reversion",
] as const;
export const specSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "策略名称至少填写 2 个字")
      .max(60, "策略名称不能超过 60 个字"),
    kind: z.enum(strategyKinds),
    symbol: z
      .string()
      .regex(
        /^(60[0135]\d{3}\.SH|000\d{3}\.SZ|001\d{3}\.SZ|002\d{3}\.SZ)$/,
        "首版仅支持沪深主板普通 A 股，例如 600000.SH、000001.SZ",
      ),
    fastWindow: z
      .number({ invalid_type_error: "请填写短均线周期" })
      .int("周期须为整数")
      .min(2, "短均线周期至少为 2 天")
      .max(120, "短均线周期不能超过 120 天"),
    slowWindow: z
      .number({ invalid_type_error: "请填写观察周期" })
      .int("周期须为整数")
      .min(3, "观察周期至少为 3 天")
      .max(250, "观察周期不能超过 250 天"),
    threshold: z
      .number({ invalid_type_error: "请填写触发阈值" })
      .min(0.001, "触发阈值至少为 0.1%")
      .max(0.3, "触发阈值不能超过 30%"),
    maxPositionPct: z
      .number({ invalid_type_error: "请填写仓位预算" })
      .min(1, "仓位预算至少为 1%")
      .max(100, "仓位预算不能超过 100%"),
    maxOrderValue: z
      .number({ invalid_type_error: "请填写单笔预算" })
      .min(1000, "单笔预算至少为 1,000 元")
      .max(1000000, "单笔预算不能超过 1,000,000 元"),
    execution: z.enum(["signal", "backtest", "live"]),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === "ma_cross" && v.fastWindow >= v.slowWindow)
      ctx.addIssue({
        code: "custom",
        path: ["slowWindow"],
        message: "长周期必须大于短周期",
      });
  });
export type StrategySpec = z.infer<typeof specSchema>;
export const executionLabels: Record<StrategySpec["execution"], string> = {
  signal: "仅查看策略信号",
  backtest: "历史回测（虚拟下单）",
  live: "实盘交易（QMT 本地启用）",
};
export type SpecErrors = Partial<Record<keyof StrategySpec, string>>;
export type RiskLimits = Pick<StrategySpec, "maxPositionPct" | "maxOrderValue">;
export function specErrors(
  spec: StrategySpec,
  limits?: RiskLimits,
): SpecErrors {
  const result = specSchema.safeParse(spec);
  const errors: SpecErrors = {};
  if (!result.success)
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof StrategySpec;
      errors[key] ??= issue.message;
    }
  if (limits && spec.maxPositionPct > limits.maxPositionPct)
    errors.maxPositionPct = `不能超过创建时设置的 ${limits.maxPositionPct}% 上限；如需提高，请返回描述页调整`;
  if (limits && spec.maxOrderValue > limits.maxOrderValue)
    errors.maxOrderValue = `不能超过创建时设置的 ${limits.maxOrderValue.toLocaleString("zh-CN")} 元上限；如需提高，请返回描述页调整`;
  return errors;
}
export function strategyRules(s: StrategySpec) {
  const percent = Number((s.threshold * 100).toFixed(8));
  if (s.kind === "ma_cross")
    return {
      buy: `${s.fastWindow} 日均线上穿 ${s.slowWindow} 日均线时买入`,
      sell: `${s.fastWindow} 日均线下穿 ${s.slowWindow} 日均线时卖出`,
    };
  if (s.kind === "momentum")
    return {
      buy: `过去 ${s.slowWindow} 日涨幅超过 ${percent}% 时买入`,
      sell: `过去 ${s.slowWindow} 日跌幅超过 ${percent}% 时卖出`,
    };
  return {
    buy: `价格低于 ${s.slowWindow} 日均价 ${percent}% 时买入`,
    sell: `价格回到 ${s.slowWindow} 日均价时卖出`,
  };
}
export function explainSpec(s: StrategySpec) {
  const rules = strategyRules(s);
  return `针对 ${s.symbol}，${rules.buy}，${rules.sell}。只在无持仓时买入；仓位预算不超过总资产 ${s.maxPositionPct}%，单笔预算不超过 ${s.maxOrderValue.toLocaleString("zh-CN")} 元。使用前一交易日数据，在下一根日线上产生信号。${s.execution === "live" ? "实盘买卖均受单笔限额约束，卖出可能跨日完成；脚本默认关闭交易开关，须在 QMT 本地配置并启用。" : ""}`;
}
export const defaultSpec: StrategySpec = {
  name: "双均线趋势策略",
  kind: "ma_cross",
  symbol: "600000.SH",
  fastWindow: 5,
  slowWindow: 20,
  threshold: 0.03,
  maxPositionPct: 20,
  maxOrderValue: 10000,
  execution: "signal",
};
export const generateSchema = z
  .object({
    prompt: z.string().trim().max(4000),
    provider: z.enum(["template", "codex"]),
    spec: specSchema,
  })
  .strict();
export type GenerateInput = z.infer<typeof generateSchema>;
export type Plan = {
  id: string;
  createdAt: string;
  provider: "template" | "codex";
  prompt: string;
  spec: StrategySpec;
  summary: string;
  assumptions: string[];
  threadId?: string;
  riskLimits?: RiskLimits;
  revisionOf?: string;
  editedFields?: (keyof StrategySpec)[];
  sources?: Source[];
  retrieval?: RetrievalTrace;
};
export type Check = {
  id: string;
  name: string;
  status: "pass" | "fail" | "pending";
  detail: string;
};
export type ValidationReport = {
  passed: boolean;
  checks: Check[];
  scope: string;
  pythonVersion: string;
  codeHash: string;
};
export type Source = {
  id: string;
  title: string;
  url: string;
  section: string;
  reviewedAt: string;
  summary: string;
  chunkId?: string;
  excerpt?: string;
  contentHash?: string;
  snapshotId?: string;
  citationKind?: "ai" | "template";
};
export type RetrievalTrace = {
  snapshotId: string;
  fetchedAt: string;
  queries: string[];
  retrievedChunkIds: string[];
};
export type DocumentPassage = {
  id: string;
  pageId: string;
  title: string;
  heading: string;
  url: string;
  text: string;
  contentHash: string;
  snapshotId: string;
  fetchedAt: string;
  relatedChunkIds?: string[];
};
export type DocumentStatus = {
  snapshotId: string;
  fetchedAt: string;
  scope: string;
  discoveredPages: number;
  indexedPages: number;
  sectionCount: number;
  chunkCount: number;
  characters: number;
};
export type Artifact = {
  id: string;
  displayName?: string;
  renamedAt?: string;
  createdAt: string;
  provider: "template" | "codex";
  prompt: string;
  spec: StrategySpec;
  code: string;
  report: ValidationReport;
  sources: Source[];
  summary: string;
  assumptions: string[];
  threadId?: string;
  retrieval?: RetrievalTrace;
};
export type ArtifactSummary = Omit<Artifact, "code">;
export const scriptNameSchema = z
  .string()
  .trim()
  .min(2, "名称至少填写 2 个字")
  .max(60, "名称不能超过 60 个字")
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/.test(value),
    "名称不能包含换行或控制字符",
  );
export function artifactName(item: Pick<Artifact, "displayName" | "spec">) {
  return item.displayName || item.spec.name;
}
export function artifactFilename(
  item: Pick<Artifact, "id" | "displayName" | "spec">,
  report = false,
) {
  const name =
    artifactName(item)
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_")
      .replace(/[. ]+$/g, "")
      .slice(0, 60) || "策略";
  return `qmt_${name}_${item.id.slice(0, 8)}${report ? "_report.pdf" : ".py"}`;
}
export type Job = {
  id: string;
  planId?: string;
  requestId?: string;
  status: "queued" | "running" | "completed" | "failed";
  stage: number;
  events: { at: string; message: string }[];
  artifactId?: string;
  error?: string;
};
export type Health = {
  status: "ok";
  version: string;
  codexEnabled: boolean;
  credentialsPresent: boolean;
  model: string;
  pythonAvailable: boolean;
  authRequired: boolean;
};
export const kindLabels: Record<StrategySpec["kind"], string> = {
  ma_cross: "双均线趋势",
  momentum: "动量突破",
  mean_reversion: "均值回归",
};
