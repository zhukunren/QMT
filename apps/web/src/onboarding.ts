import {
  defaultSpec,
  kindLabels,
  specSchema,
  strategyRules,
  type StrategySpec,
} from "@qmt/shared";

export const strategyTemplates = [
  {
    kind: "ma_cross",
    title: "双均线趋势",
    tag: "比较两条均线",
    description: "短均线上穿时买入，下穿时卖出。",
  },
  {
    kind: "momentum",
    title: "动量突破",
    tag: "观察阶段涨跌幅",
    description: "涨幅超过阈值买入，跌幅超过阈值卖出。",
  },
  {
    kind: "mean_reversion",
    title: "均值回归",
    tag: "观察价格偏离",
    description: "低于均价一定幅度买入，回到均价卖出。",
  },
] as const;
export function templateSpec(
  base: StrategySpec,
  kind: StrategySpec["kind"],
): StrategySpec {
  const automaticName = Object.values(kindLabels).some(
    (label) => base.name === `${label}策略`,
  );
  const parameters =
    base.kind === kind
      ? {}
      : {
          fastWindow: defaultSpec.fastWindow,
          slowWindow: defaultSpec.slowWindow,
          threshold: defaultSpec.threshold,
        };
  return {
    ...base,
    ...parameters,
    kind,
    name: automaticName ? `${kindLabels[kind]}策略` : base.name,
  };
}
export function templateDescription(spec: StrategySpec) {
  const rules = strategyRules(spec);
  return `对 ${spec.symbol}，${rules.buy}，${rules.sell}。仓位不超过 ${spec.maxPositionPct}%，单笔买入不超过 ${spec.maxOrderValue.toLocaleString("zh-CN")} 元。`;
}
export function templatePreview(
  base: StrategySpec,
  kind: StrategySpec["kind"],
) {
  const spec = templateSpec(base, kind);
  return specSchema.safeParse(spec).success ? strategyRules(spec) : null;
}
export const importSteps = [
  { id: "download", title: "准备脚本", short: "下载" },
  { id: "editor", title: "载入策略编辑器", short: "载入" },
  { id: "backtest", title: "设置历史回测", short: "回测" },
  { id: "review", title: "核对运行结果", short: "核对" },
] as const;
export type ImportStepId = (typeof importSteps)[number]["id"];
export type ImportProgress = {
  version: 1;
  active: number;
  completed: ImportStepId[];
};
export function readImportProgress(raw: string | null): ImportProgress {
  const fallback: ImportProgress = { version: 1, active: 0, completed: [] };
  try {
    const value = JSON.parse(raw || "null");
    if (
      value?.version !== 1 ||
      !Number.isInteger(value.active) ||
      value.active < 0 ||
      value.active >= importSteps.length ||
      !Array.isArray(value.completed)
    )
      return fallback;
    return {
      version: 1,
      active: value.active,
      completed: [
        ...new Set<ImportStepId>(
          value.completed.filter((id: unknown) =>
            importSteps.some((step) => step.id === id),
          ),
        ),
      ],
    };
  } catch {
    return fallback;
  }
}
export const importProgressKey = (id: string) => `qmt.import-guide.v1.${id}`;
export function advanceImport(progress: ImportProgress): ImportProgress {
  const id = importSteps[progress.active].id;
  return {
    version: 1,
    active: Math.min(progress.active + 1, importSteps.length - 1),
    completed: [...new Set([...progress.completed, id])],
  };
}
