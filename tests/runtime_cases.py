"""Behavioral tests for developer-owned templates, never a production execution path."""
import contextlib
import io
import json
import sys
from types import SimpleNamespace

payload = json.load(sys.stdin)
orders, queries = [], []
positions = []
accounts = [SimpleNamespace(m_dAvailable=100000.0, m_dBalance=100000.0)]


def trade_details(account, kind, datatype):
    assert account == "qmt_studio_backtest"
    return accounts if datatype == "ACCOUNT" else positions


ns = {"get_trade_detail_data": trade_details,
      "timetag_to_datetime": lambda timestamp, fmt: str(timestamp),
      "passorder": lambda *args: orders.append(args)}
with contextlib.redirect_stdout(io.StringIO()):
    exec(compile(payload["code"], "reviewed_template.py", "exec"), ns)


class Series:
    def __init__(self, values): self.values = values
    def tolist(self): return self.values


class Frame:
    def __init__(self, values): self.values, self.empty = values, not bool(values)
    def __contains__(self, key): return key == "close"
    def __getitem__(self, key): return Series(self.values)


class Context:
    def __init__(self, closes=None, mode=True, period="1d"):
        self.do_back_test, self.period, self.barpos = mode, period, 30
        self.closes = closes if closes is not None else [10.0] * 20 + [11.0]
    def set_universe(self, universe): self.universe = universe
    def get_bar_timetag(self, pos): return pos
    def get_market_data_ex(self, *args, **kwargs):
        queries.append(kwargs)
        return {ns["SYMBOL"]: Frame(self.closes)}


tests = 0


def check(condition, message):
    global tests
    assert condition, message
    tests += 1


def run(context):
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        ns["init"](context)
        ns["handlebar"](context)
    return output.getvalue()


for mode in (False, None, 1, "true"):
    try:
        run(Context(mode=mode))
        raise AssertionError("Live or unknown mode accepted")
    except RuntimeError as error:
        check(not orders and "回测" in str(error) and "实盘" in str(error), "No live orders and actionable Chinese environment error")
try:
    run(Context(period="1m"))
    raise AssertionError("Minute bars accepted")
except RuntimeError as error:
    check(not orders and "日线" in str(error) and "回测" in str(error), "Unsupported period is blocked with Chinese instructions")

# Force a signal to exercise the risk wrapper identically for every strategy kind.
real_signal = ns["compute_signal"]
ns["compute_signal"] = lambda closes: 1
ctx = Context()
output = run(ctx)
check(len(orders) == 1 and "启动成功" in output and "买入" in output and "是否成交" in output and output.encode("gbk").decode("gbk") == output, "Backtest buy issued with GBK-compatible Chinese output and no fill claim")
check(orders[0][0] == 23 and orders[0][1] == 1101 and orders[0][8] == 0, "Order parameters")
check(orders[0][6] * 11 <= ns["MAX_ORDER_VALUE"], "Single order budget cap")
check(orders[0][6] % 100 == 0, "Round lots")
check(queries[-1]["end_time"] == "29" and queries[-1]["subscribe"] is False, "No current bar data")
with contextlib.redirect_stdout(io.StringIO()): ns["handlebar"](ctx)
check(len(orders) == 1, "Duplicate bar does not create duplicate order")
ctx.do_back_test = False
ctx.barpos += 1
with contextlib.redirect_stdout(io.StringIO()): ns["handlebar"](ctx)
check(len(orders) == 1, "Handlebar independently blocks live")

orders.clear()
ns["ENABLE_BACKTEST_ORDERS"] = False
output = run(Context())
check(not orders and "仅记录信号，不进行虚拟下单" in output and "方向：买入" in output, "Signal-only mode cannot send orders and explains the Chinese buy signal")
ns["ENABLE_BACKTEST_ORDERS"] = True
accounts[0].m_dAvailable = 10.0
output = run(Context())
check(not orders and "可用资金" in output and "本次未买入" in output, "Insufficient cash skips order with useful Chinese guidance")
accounts[0].m_dAvailable = 100000.0
positions.append(SimpleNamespace(m_strInstrumentID="600000", m_strExchangeID="SH", m_nVolume=100, m_nCanUseVolume=0))
output = run(Context())
check(not orders and "已有持仓" in output, "Existing holding does not trigger repeated buys and explains why")
ns["compute_signal"] = lambda closes: -1
output = run(Context())
check(not orders and "T+1" in output and "本次未卖出" in output, "T+1 unavailable position cannot be sold and explains the restriction")
positions[0].m_nCanUseVolume = 100
output = run(Context())
check(len(orders) == 1 and orders[0][0] == 24 and orders[0][6] == 100 and "方向：卖出" in output and "是否成交" in output, "Sell only available position with a Chinese signal and no fill claim")
orders.clear()
accounts.clear()
output = run(Context())
check(not orders and "回测虚拟账户" in output and "请检查" in output, "Missing account skips orders and explains what to check")
output = run(Context(closes=[]))
check(not orders and "请先下载" in output and "日线历史行情" in output, "Missing market data skips orders with Chinese recovery instructions")

check(real_signal([10.0] * 3) == 0, "Short data is ignored")
check(real_signal([10.0] * 20 + [float("nan")]) == 0, "NaN ignored")
check(real_signal([10.0] * 20 + [float("inf")]) == 0, "Inf ignored")
check(real_signal([10.0] * 20 + [0]) == 0, "Zero price ignored")
check(real_signal([10.0] * 20 + [-1]) == 0, "Negative price ignored")
if ns["KIND"] == "mean_reversion":
    check(real_signal([10.0] * 20 + [9.0]) == 1, "Mean reversion buy")
    check(real_signal([10.0] * 20 + [11.0]) == -1, "Mean reversion sell")
else:
    check(real_signal([10.0] * 20 + [11.0]) == 1, "Trend buy")
    check(real_signal([10.0] * 20 + [9.0]) == -1, "Trend sell")
print(json.dumps({"tests": tests}))
