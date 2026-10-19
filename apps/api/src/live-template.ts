import { readFileSync } from "node:fs";
import type { Source, StrategySpec } from "@qmt/shared";

const signal = readFileSync(
  new URL("../python/signal_runtime.py", import.meta.url),
  "utf8",
).trim();

export function renderLiveScript(
  spec: StrategySpec,
  sources: Source[],
): string {
  const runtime = readFileSync(
    new URL("../python/live_runtime.py", import.meta.url),
    "utf8",
  ).trim();
  const data = (value: string) =>
    JSON.stringify(value).replace(/\u2028|\u2029/g, " ");
  return `#coding:gbk
# 东吴证券 | QMT 策略工坊 | 实盘模板 2.0.0
# 默认关闭实盘开关；请在 QMT 本地设置账户与已登录状态，先完成模拟柜台验收。
# 同一账户同一股票仅可在同一台电脑运行一个实例；不得删除未核对的状态文件。
# 实盘委托、成交、重启和撤单处理依据下列官方章节；静态检查不等于客户端验收。
${[...new Set(sources.map((source) => source.url))].map((url) => `# ${url}`).join("\n")}
import math
EXECUTION_MODE = "live"
STRATEGY_NAME = ${data(spec.name)}
KIND = ${data(spec.kind)}
SYMBOL = ${data(spec.symbol)}
FAST = ${spec.fastWindow}
SLOW = ${spec.slowWindow}
THRESHOLD = ${spec.threshold}
MAX_POSITION = ${spec.maxPositionPct / 100}
# 实盘买入和卖出均受单笔委托金额上限约束；卖出可能分多个交易日完成。
MAX_ORDER_VALUE = ${spec.maxOrderValue}

${signal}

# QMT_STUDIO_LIVE_RUNTIME_BEGIN
${runtime}
# QMT_STUDIO_LIVE_RUNTIME_END
`;
}
