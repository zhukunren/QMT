"""Exercise the developer-owned live template against a local fake broker, never QMT."""
import contextlib
import datetime
import io
import json
import os
import sys
import tempfile
from types import SimpleNamespace as Row

payload = json.load(sys.stdin)
ns = {}
exec(compile(payload["code"], "trusted_live_template.py", "exec"), ns)
sent, broker_orders, positions, cancellations = [], [], [], []
now_epoch = [datetime.datetime(2026, 10, 19, 2, tzinfo=datetime.timezone.utc).timestamp()]
state = {"fail_send": False, "fail_query": False, "cancel_result": True}
account = Row(m_strAccountID="test_local_account", m_nBrokerType=2, m_strStatus="已登录",
              m_strTradingDate="20261019", m_dAvailable=100000.0, m_dBalance=100000.0)
tests = 0


def check(condition, message):
    global tests
    assert condition, message
    tests += 1


def trade_details(account_id, account_type, datatype):
    assert account_id == account.m_strAccountID and account_type == "STOCK"
    if state["fail_query"]:
        raise RuntimeError("模拟断线")
    return {"ACCOUNT": [account], "POSITION": positions, "ORDER": broker_orders}[datatype]


def send(*args):
    # The broker is invoked only after the exact order intent is durable.
    C = args[-1]
    with open(C.studio_path, encoding="utf-8") as stream:
        journal = json.load(stream)
    assert journal["intent"]["attempts"][-1]["tag"] == args[9]
    sent.append(args)
    if state["fail_send"]:
        raise RuntimeError("模拟已接收但响应丢失")


def cancel(*args):
    cancellations.append(args)
    if state["cancel_result"] == "exception":
        raise RuntimeError("模拟撤单响应丢失")
    return state["cancel_result"]


class Series:
    def __init__(self, values): self.values = values
    def tolist(self): return self.values


class Frame:
    empty = False
    index = ["20261016000000"]
    def __contains__(self, key): return key == "close"
    def __getitem__(self, key): return Series([10.0] * 20 + [11.0])


class Context:
    def __init__(self):
        self.do_back_test, self.period, self.barpos = False, "1d", 30
        self.latest, self.stale, self.no_ask, self.bad_calendar = True, False, False, False
        self.instrument_name, self.upper, self.last = "浦发银行", 12.0, 11.0
        self.signal_calls = 0
    def set_universe(self, value): self.universe = value
    def set_account(self, value): self.bound_account = value
    def run_time(self, *args): self.timer = args
    def is_last_bar(self): return self.latest
    def get_bar_timetag(self, pos): return pos
    def get_trading_dates(self, *args): return ["20261015", "20261016"] if self.bad_calendar else ["20261016", "20261019"]
    def get_market_data_ex(self, *args, **kwargs):
        assert kwargs["end_time"] == "20261016000000" and kwargs["subscribe"] is False
        return {ns["SYMBOL"]: Frame()}
    def get_full_tick(self, *args):
        return {ns["SYMBOL"]: {"time": (now_epoch[0] - (60 if self.stale else 0)) * 1000,
                "lastPrice": self.last, "askPrice": [0 if self.no_ask else 11.0], "askVol": [100],
                "bidPrice": [10.99], "bidVol": [100]}}
    def get_instrument_detail(self, symbol):
        return {"InstrumentName": self.instrument_name, "UpStopPrice": self.upper, "DownStopPrice": 8.0}


ns.update(get_trade_detail_data=trade_details, passorder=send, cancel=cancel,
          timetag_to_datetime=lambda pos, fmt: datetime.datetime(2026, 10, 19 if pos == 30 else 16).strftime(fmt))
ns["time"] = Row(time=lambda: now_epoch[0])
ns["studio_now"] = lambda: datetime.datetime.utcfromtimestamp(now_epoch[0]) + datetime.timedelta(hours=8)
ns["ACCOUNT_ID"] = account.m_strAccountID
ns["ACCOUNT_READY_STATUS"] = "已登录"
ns["compute_signal"] = lambda values: 1


def handle(C):
    with contextlib.redirect_stdout(io.StringIO()): ns["handlebar"](C)


def timer(C):
    with contextlib.redirect_stdout(io.StringIO()): ns["studio_timer"](C)


def stop(C):
    with contextlib.redirect_stdout(io.StringIO()): ns["stop"](C)


def order(index=-1, status=50, filled=0):
    args = sent[index]
    return Row(m_strAccountID=account.m_strAccountID, m_strInstrumentID=ns["SYMBOL"].split(".")[0],
               m_strExchangeID=ns["SYMBOL"].split(".")[1], m_strRemark=args[9], m_strInsertDate="20261019",
               m_nVolumeTotalOriginal=args[6], m_nVolumeTraded=filled, m_nOrderStatus=status, m_strOrderSysID="order_%d" % len(sent))


def position(held, sellable):
    return Row(m_strAccountID=account.m_strAccountID, m_strInstrumentID=ns["SYMBOL"].split(".")[0],
               m_strExchangeID=ns["SYMBOL"].split(".")[1], m_nVolume=held, m_nCanUseVolume=sellable)


with tempfile.TemporaryDirectory(prefix="qmt-live-tests-") as directory:
    ns["STATE_DIRECTORY"] = directory
    try:
        ns["init"](Context())
        raise AssertionError("Downloaded live template was armed by default")
    except RuntimeError:
        check(not sent, "Default-off gate blocks trading")
    ns["LIVE_TRADING_ENABLED"] = True
    for mode in (True, None, 0, 1, "false"):
        C = Context(); C.do_back_test = mode
        try:
            ns["init"](C)
            raise AssertionError("Backtest/unknown environment accepted")
        except RuntimeError:
            check(not sent, "Only literal live mode is accepted")

    sequence = [0]
    def fresh():
        sequence[0] += 1
        ns["STATE_DIRECTORY"] = os.path.join(directory, str(sequence[0]))
        sent.clear(); broker_orders.clear(); positions.clear(); cancellations.clear()
        state.update(fail_send=False, fail_query=False, cancel_result=True)
        account.m_dAvailable, account.m_strStatus, account.m_strTradingDate = 100000.0, "已登录", "20261019"
        now_epoch[0] = datetime.datetime(2026, 10, 19, 2, tzinfo=datetime.timezone.utc).timestamp()
        ns["compute_signal"] = lambda values: 1
        ns["ACCOUNT_READY_STATUS"] = "已登录"
        C = Context()
        with contextlib.redirect_stdout(io.StringIO()): ns["init"](C)
        return C

    C = fresh(); handle(C)
    check(len(sent) == 1 and C.bound_account == account.m_strAccountID, "Account binding and live order")
    check(sent[0][1] == 1101 and sent[0][4] == 11 and sent[0][8] == 1, "Share quantity, limit price and latest-bar quickTrade")
    check(sent[0][6] % 100 == 0 and sent[0][6] * sent[0][5] <= ns["MAX_ORDER_VALUE"], "Live buy lot and monetary budget")
    check(len(sent[0][9]) <= 24, "Broker order remark length")
    for _ in range(3): handle(C); timer(C)
    check(len(sent) == 1, "No duplicate orders without a report")
    try:
        ns["init"](Context())
        raise AssertionError("Concurrent instance accepted")
    except FileExistsError:
        check(True, "Account/symbol lock blocks concurrent scripts")
    stop(C)
    restarted = Context()
    with contextlib.redirect_stdout(io.StringIO()): ns["init"](restarted)
    handle(restarted)
    check(len(sent) == 1, "Restart restores pending intent without resubmission")
    now_epoch[0] += 90; timer(restarted); handle(restarted)
    check(not cancellations and len(sent) == 1, "Unknown order number blocks cancellation guesses and resubmission")
    stop(restarted)

    C = fresh(); state["fail_send"] = True; handle(C)
    check(C.studio_state["intent"]["phase"] == "unknown", "Lost submit acknowledgement retained as unknown")
    state["fail_send"] = False; handle(C); timer(C)
    check(len(sent) == 1, "Unknown submit is never blindly retried")
    stop(C)

    for field, value in [("stale", True), ("latest", False), ("no_ask", True), ("bad_calendar", True), ("instrument_name", "*ST测试"), ("upper", 11.0), ("last", float("nan"))]:
        C = fresh(); setattr(C, field, value); handle(C)
        check(not sent, "Invalid live market guard: " + field); stop(C)
    for setting in ("status", "date", "cash", "query", "missing-status", "time"):
        C = fresh()
        if setting == "status": account.m_strStatus = "准备登录"
        if setting == "date": account.m_strTradingDate = "20261016"
        if setting == "cash": account.m_dAvailable = 1.0
        if setting == "query": state["fail_query"] = True
        if setting == "missing-status": ns["ACCOUNT_READY_STATUS"] = ""
        if setting == "time": now_epoch[0] += 2 * 3600
        handle(C); check(not sent, "Invalid account/session guard: " + setting); stop(C)

    C = fresh()
    with contextlib.redirect_stdout(io.StringIO()): ns["account_callback"](C, Row(m_strAccountID=account.m_strAccountID, m_strStatus="断线"))
    handle(C); check(not sent, "Disconnect callback overrides stale positive query cache")
    with contextlib.redirect_stdout(io.StringIO()): ns["account_callback"](C, account)
    handle(C); check(len(sent) == 1, "Confirmed logged-in callback allows recovery"); stop(C)

    C = fresh(); positions.append(position(100, 0)); handle(C)
    check(not sent, "Existing position blocks adding to holdings"); stop(C)
    C = fresh(); ns["compute_signal"] = lambda values: -1; positions.append(position(1000, 0)); handle(C)
    check(not sent, "T+1 unavailable shares cannot be sold")
    positions[0].m_nCanUseVolume = 1000; handle(C)
    check(len(sent) == 1 and sent[0][0] == 24 and sent[0][6] <= 1000 and sent[0][6] * sent[0][5] <= ns["MAX_ORDER_VALUE"], "Sell uses available shares and limit-price notional cap"); stop(C)

    C = fresh(); handle(C); row = order(status=55, filled=55); broker_orders.append(row)
    positions.append(position(55, 0)); now_epoch[0] += 61; timer(C)
    check(len(cancellations) == 1 and len(sent) == 1, "Timeout requests cancellation without immediate replacement")
    row.m_nOrderStatus = 52; timer(C)
    check(len(sent) == 1, "Cancel-pending is not a cancellation confirmation")
    row.m_nOrderStatus = 53
    with contextlib.redirect_stdout(io.StringIO()): ns["order_callback"](C, row)
    handle(C)
    check(len(sent) == 2 and sent[-1][6] % 100 == 0 and sent[-1][6] <= C.studio_state["intent"]["target"] - 55, "Partial fill retry contains only unfilled round lots")
    check(55 * sent[0][5] + sent[1][6] * sent[1][5] <= ns["MAX_ORDER_VALUE"], "Cumulative retry notional is bounded")
    second = order(status=50); broker_orders.append(second); now_epoch[0] += 61; timer(C)
    second.m_nOrderStatus = 54; timer(C); handle(C)
    check(len(sent) == 2 and C.studio_state["intent"]["phase"] == "done", "At most one order retry")
    with contextlib.redirect_stdout(io.StringIO()): ns["deal_callback"](C, Row()); ns["deal_callback"](C, Row())
    check(len(sent) == 2 and sum(x["filled"] for x in C.studio_state["intent"]["attempts"]) == 55, "Duplicate deal callbacks do not double-count fills"); stop(C)

    for terminal in (54, 56, 57):
        C = fresh(); handle(C); row = order(status=terminal, filled=sent[0][6] if terminal == 56 else 0); broker_orders.append(row)
        timer(C); handle(C)
        check(len(sent) == 1, "Manual cancel/fill/rejection is not automatically resent: " + str(terminal)); stop(C)

    for result in (False, None, "exception"):
        C = fresh(); handle(C); row = order(); broker_orders.append(row)
        state["cancel_result"] = result; now_epoch[0] += 61
        for _ in range(5): timer(C)
        check(len(cancellations) <= 3, "Cancellation requests have a bounded retry count")
        row.m_nOrderStatus = 54; timer(C); handle(C)
        check(len(sent) == 1, "Unacknowledged cancellation cannot authorize a replacement: " + str(result)); stop(C)

    C = fresh(); handle(C); row = order(); broker_orders.append(row); now_epoch[0] += 61; timer(C)
    row.m_nOrderStatus = 54; timer(C)
    check(C.studio_state["intent"]["phase"] == "retry", "Confirmed timeout cancellation prepares an intraday retry")
    now_epoch[0] += 24 * 3600; account.m_strTradingDate = "20261020"; timer(C)
    check(C.studio_state["intent"]["phase"] == "done" and len(sent) == 1, "Cancelled retry intent expires at the next trading day without a stale replacement"); stop(C)

    C = fresh(); save = ns["studio_save"]
    def failed_save(context): raise OSError("模拟磁盘写入失败")
    ns["studio_save"] = failed_save; handle(C)
    check(not sent, "Failed intent persistence prevents broker submission")
    ns["studio_save"] = save; stop(C)

    C = fresh(); handle(C); row = order(status=50); row.m_strAccountID = "another_account"
    with contextlib.redirect_stdout(io.StringIO()): ns["order_callback"](C, row)
    check(C.studio_state["intent"]["attempts"][-1]["status"] is None, "Unrelated account callback ignored"); stop(C)

    C = fresh(); handle(C); broker_orders.append(order()); path = C.studio_path; stop(C); os.remove(path)
    C = Context()
    with contextlib.redirect_stdout(io.StringIO()): ns["init"](C)
    handle(C); check(len(sent) == 1, "Missing local journal is detected against broker history"); stop(C)

    C = fresh(); handle(C); path = C.studio_path; stop(C)
    with open(path, "w", encoding="utf-8") as stream: stream.write('{"broken":true}')
    try:
        ns["init"](Context())
        raise AssertionError("Corrupt journal silently reset")
    except (ValueError, KeyError, RuntimeError):
        check(len(sent) == 1, "Corrupt journal fails closed")

print(json.dumps({"tests": tests}))
