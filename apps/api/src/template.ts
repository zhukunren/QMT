import type { StrategySpec, Source } from "@qmt/shared";
import { renderLiveScript } from "./live-template.js";

// Model output never becomes executable Python. Only validated literals enter this reviewed template.
export function renderScript(spec: StrategySpec, sources: Source[] = []): string {
  if (spec.execution === "live") return renderLiveScript(spec, sources);
  const py = (s: string) => JSON.stringify(s).replace(/\\u2028|\\u2029/g, " ");
  const references = sources.length ? `# 本次生成的官方章节依据（快照 ${sources[0]?.snapshotId || "legacy"}）：\n${[...new Set(sources.map(s => s.url))].map(url => `# ${url}`).join("\n")}\n` : "";
  return `#coding:gbk
# 东吴证券 | QMT 策略工坊 | 模板版本 1.0.2
# 本脚本用于策略研究，请在实际使用的东吴 QMT 客户端中完成验证。
# 官方文档：快速开始与交易函数说明
# https://knowledge.thinktrader.net/docs/python/start_now.html
# https://knowledge.thinktrader.net/docs/python/trading_function.html
# 仅支持日线；使用前一根已完成的 K 线，信号延迟一根日线。
# 实盘与未知环境均被阻断；撮合、费用、滑点和复权影响须在 QMT 中核对。
${references}import math

# 策略参数：名称、类型、股票代码、短周期、长周期及触发阈值。
STRATEGY_NAME = ${py(spec.name)}
KIND = ${py(spec.kind)}
SYMBOL = ${py(spec.symbol)}
FAST = ${spec.fastWindow}
SLOW = ${spec.slowWindow}
THRESHOLD = ${spec.threshold}
# 风险预算：仓位上限为总资产比例，单笔买入上限的单位为元。
MAX_POSITION = ${spec.maxPositionPct / 100}
MAX_ORDER_VALUE = ${spec.maxOrderValue}
# 是否允许虚拟回测下单；为 False 时只打印买卖信号。
ENABLE_BACKTEST_ORDERS = ${spec.execution === "backtest" ? "True" : "False"}
# 固定的回测虚拟账户，不填写真实交易账号。
BACKTEST_ACCOUNT = "qmt_studio_backtest"


def init(C):
    # 仅允许明确的回测环境，避免误触发真实交易。
    if getattr(C, "do_back_test", None) is not True:
        raise RuntimeError("【无法启动】当前不是已确认的回测环境。请在 QMT 策略编辑器中点击“回测”；本脚本不支持实盘交易。")
    if C.period != "1d":
        raise RuntimeError("【无法启动】当前行情周期不是日线。请将行情周期设为“日线（1d）”，再点击“回测”。")
    C.set_universe([SYMBOL])
    C.studio_last_bar = -1
    print("【启动成功】策略：%s；股票：%s；运行方式：%s。" % (
        STRATEGY_NAME, SYMBOL, "历史回测虚拟下单" if ENABLE_BACKTEST_ORDERS else "仅输出买卖信号"))


def compute_signal(closes):
    # 仅计算信号：1 表示买入，-1 表示卖出，0 表示继续观察。
    # 行情不足或包含无效价格时，不产生交易信号。
    if len(closes) < SLOW + 1:
        return 0
    if not all(math.isfinite(v) and v > 0 for v in closes):
        return 0
    if KIND == "ma_cross":
        # 双均线策略：短均线上穿长均线买入，下穿时卖出。
        prev_fast = sum(closes[-FAST-1:-1]) / FAST
        prev_slow = sum(closes[-SLOW-1:-1]) / SLOW
        fast = sum(closes[-FAST:]) / FAST
        slow = sum(closes[-SLOW:]) / SLOW
        if prev_fast <= prev_slow and fast > slow:
            return 1
        if prev_fast >= prev_slow and fast < slow:
            return -1
    elif KIND == "momentum":
        # 动量策略：长周期收益率超过正阈值买入，低于负阈值卖出。
        momentum = closes[-1] / closes[-SLOW-1] - 1.0
        if momentum > THRESHOLD:
            return 1
        if momentum < -THRESHOLD:
            return -1
    elif KIND == "mean_reversion":
        # 均值回归策略：价格低于均价达到阈值时买入，回到均价时卖出。
        mean = sum(closes[-SLOW:]) / SLOW
        deviation = closes[-1] / mean - 1.0
        if deviation < -THRESHOLD:
            return 1
        if deviation >= 0:
            return -1
    return 0


def handlebar(C):
    # 再次检查回测环境，不仅依赖初始化时的保护。
    if getattr(C, "do_back_test", None) is not True:
        return
    if C.period != "1d" or C.barpos < SLOW + 2:
        return
    # 同一根或倒退的 K 线不重复处理，避免重复信号和重复委托。
    if C.barpos <= C.studio_last_bar:
        return
    C.studio_last_bar = C.barpos
    # 行情截至前一根 K 线，不使用当前 K 线尚未完成的收盘价。
    bar_time = timetag_to_datetime(C.get_bar_timetag(C.barpos - 1), "%Y%m%d%H%M%S")
    data = C.get_market_data_ex(
        ["close"], [SYMBOL], period="1d", end_time=bar_time,
        count=SLOW + 1, dividend_type="none", fill_data=False, subscribe=False)
    frame = data.get(SYMBOL)
    if frame is None or frame.empty or "close" not in frame:
        print("【行情不足】本次计算已跳过。请先下载该股票的日线历史行情，并检查股票代码和回测日期范围。")
        return
    closes = [float(v) for v in frame["close"].tolist()]
    signal = compute_signal(closes)
    if signal == 0:
        return
    print("【策略信号】行情截止时间：%s；股票：%s；方向：%s。%s" % (
        bar_time, SYMBOL, "买入" if signal == 1 else "卖出",
        "仅记录信号，不进行虚拟下单。" if not ENABLE_BACKTEST_ORDERS else "是否发起虚拟买卖，还需检查资金和可卖持仓。"))
    if not ENABLE_BACKTEST_ORDERS:
        return
    # 查询虚拟账户的实际状态，不把已发送委托当作已成交。
    accounts = get_trade_detail_data(BACKTEST_ACCOUNT, "STOCK", "ACCOUNT")
    if not accounts:
        print("【账户不可用】未读取到回测虚拟账户，本次不下单。请检查 QMT 的回测参数和客户端运行状态，再重新回测。")
        return
    account = accounts[0]
    cash = float(account.m_dAvailable)
    equity = float(account.m_dBalance)
    if not math.isfinite(cash) or not math.isfinite(equity) or equity <= 0:
        print("【账户数据异常】资金数据无效或总资产不大于零，本次不下单。请检查回测初始资金和账户数据。")
        return
    positions = get_trade_detail_data(BACKTEST_ACCOUNT, "STOCK", "POSITION")
    held, sellable = 0, 0
    # 分别统计总持仓与可卖数量，可卖数量用于遵守 T+1 约束。
    for position in positions:
        code = position.m_strInstrumentID + "." + position.m_strExchangeID
        if code == SYMBOL:
            held += int(position.m_nVolume)
            sellable += int(position.m_nCanUseVolume)
    price = closes[-1]
    if signal == 1 and held == 0:
        # 预留 1% 现金缓冲，取现金、仓位预算和单笔上限中的最小值。
        budget = max(0.0, min(cash * 0.99, equity * MAX_POSITION, MAX_ORDER_VALUE))
        # 买入数量向下取整到 100 股，不足一手则跳过。
        volume = int(budget / price / 100) * 100
        if volume >= 100:
            passorder(23, 1101, BACKTEST_ACCOUNT, SYMBOL, 5, -1, volume,
                      STRATEGY_NAME, 0, "studio_buy", C)
            print("【虚拟买入请求】股票：%s；数量：%d 股。是否成交请以 QMT 回测记录为准。" % (SYMBOL, volume))
        else:
            print("【本次未买入】按当前资金和预算上限，无法买入至少 100 股。请检查股票价格、可用资金、仓位预算及单笔买入上限。")
    elif signal == -1 and sellable > 0:
        # 仅卖出 QMT 报告的可用数量，不能把当日不可卖持仓全部卖出。
        passorder(24, 1101, BACKTEST_ACCOUNT, SYMBOL, 5, -1, sellable,
                  STRATEGY_NAME, 0, "studio_sell", C)
        print("【虚拟卖出请求】股票：%s；数量：%d 股。是否成交请以 QMT 回测记录为准。" % (SYMBOL, sellable))
    elif signal == 1 and held > 0:
        print("【本次未买入】该股票已有持仓，本策略不重复加仓。")
    elif signal == -1 and sellable <= 0:
        print("【本次未卖出】当前没有可卖持仓。可能尚未持有该股票，或持仓受 T+1 规则限制；请查看 QMT 回测持仓记录。")
`;
}
