# 本段是生成器维护的实盘运行层。只在 QMT 内置 Python 的策略交易界面运行。
import os
import json
import hashlib
import time
import datetime
import threading

# 在 QMT 本地核对账户、模拟柜台和客户端版本后，才将开关改为 True。
LIVE_TRADING_ENABLED = False
# 留空时使用策略交易界面选择的 account。不得在网页中提交资金账号或密码。
ACCOUNT_ID = ""
# 官方文档没有统一枚举 m_strStatus；填入本券商客户端已登录时的精确状态文字。
# 留空或状态不匹配时仅打印实际状态，不发新委托。
ACCOUNT_READY_STATUS = ""
# 状态文件和锁必须放在持久化本地磁盘；留空使用用户目录。
STATE_DIRECTORY = ""
ORDER_TIMEOUT_SECONDS = 60
MAX_CANCEL_RETRIES = 3
MAX_ORDER_RETRIES = 1
MAX_TICK_AGE_SECONDS = 15
TERMINAL_STATUSES = (53, 54, 56, 57)
WORKING_STATUSES = (49, 50, 51, 52, 55)


def studio_now():
    # 使用北京时间，不依赖 Windows 的时区设置。
    return datetime.datetime.utcnow() + datetime.timedelta(hours=8)


def studio_session(now):
    clock = now.strftime("%H%M%S")
    return now.weekday() < 5 and ("093000" <= clock < "112900" or "130000" <= clock < "145500")


def studio_notice(C, message):
    if C.studio_notice != message:
        print(message)
        C.studio_notice = message


def studio_save(C):
    # 先持久化意图，再调用异步交易接口；提交结果未知时禁止重新下单。
    temporary = C.studio_path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as stream:
        json.dump(C.studio_state, stream, ensure_ascii=False, allow_nan=False)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, C.studio_path)


def studio_symbol(row):
    return str(row.m_strInstrumentID) + "." + str(row.m_strExchangeID)


def studio_ours(C, row):
    return str(row.m_strAccountID) == C.studio_account and studio_symbol(row) == SYMBOL


def studio_query(C):
    # 不能用空账户、错误日期或缓存的其他账户继续下单。
    accounts = get_trade_detail_data(C.studio_account, "STOCK", "ACCOUNT")
    positions = get_trade_detail_data(C.studio_account, "STOCK", "POSITION")
    orders = get_trade_detail_data(C.studio_account, "STOCK", "ORDER")
    if not isinstance(accounts, list) or not isinstance(positions, list) or not isinstance(orders, list):
        raise RuntimeError("交易查询未返回完整列表，已暂停。")
    matches = [row for row in accounts if str(row.m_strAccountID) == C.studio_account]
    if len(matches) != 1 or int(matches[0].m_nBrokerType) != 2:
        raise RuntimeError("未读取到唯一的普通股票账户，已暂停。")
    account_info = matches[0]
    ready = bool(ACCOUNT_READY_STATUS) and str(account_info.m_strStatus) == ACCOUNT_READY_STATUS and not C.studio_account_blocked
    if not ready:
        studio_notice(C, "【账户未就绪】当前状态：%s。请在本地核对 ACCOUNT_READY_STATUS，暂停新委托。" % account_info.m_strStatus)
    if str(account_info.m_strTradingDate) != studio_now().strftime("%Y%m%d"):
        ready = False
    cash, equity = float(account_info.m_dAvailable), float(account_info.m_dBalance)
    if not math.isfinite(cash) or not math.isfinite(equity) or cash < 0 or equity <= 0:
        ready = False
    held, sellable = 0, 0
    for row in positions:
        if studio_ours(C, row):
            volume, available = int(row.m_nVolume), int(row.m_nCanUseVolume)
            if volume < 0 or available < 0 or available > volume:
                raise RuntimeError("持仓数量异常，已暂停。")
            held += volume
            sellable += available
    return ready, cash, equity, held, sellable, [row for row in orders if studio_ours(C, row)]


def studio_apply_order(C, row):
    intent = C.studio_state["intent"]
    if not intent or not studio_ours(C, row):
        return
    for attempt in intent["attempts"]:
        if str(row.m_strRemark) != attempt["tag"] or str(row.m_strInsertDate) != intent["day"]:
            continue
        status, filled = int(row.m_nOrderStatus), int(row.m_nVolumeTraded)
        if int(row.m_nVolumeTotalOriginal) != attempt["volume"] or filled < 0 or filled > attempt["volume"]:
            raise RuntimeError("委托回报与本地意图不一致，须人工核对。")
        if status not in TERMINAL_STATUSES + WORKING_STATUSES:
            raise RuntimeError("收到未识别的委托状态，须人工核对。")
        if status == 56 and filled != attempt["volume"]:
            raise RuntimeError("已成回报的数量不完整，须人工核对。")
        if filled < attempt["filled"] or (attempt["status"] in TERMINAL_STATUSES and status not in TERMINAL_STATUSES):
            return  # 忽略重复或过时回报，成交数量不得倒退。
        if attempt["status"] in TERMINAL_STATUSES and filled != attempt["filled"]:
            raise RuntimeError("终态委托的成交数量发生变化，须人工核对。")
        if attempt["order_id"] and str(row.m_strOrderSysID) and attempt["order_id"] != str(row.m_strOrderSysID):
            raise RuntimeError("同一委托备注出现多个柜台委托号，须人工核对。")
        attempt["filled"] = filled
        attempt["status"] = status
        attempt["order_id"] = str(row.m_strOrderSysID)
        if attempt is intent["attempts"][-1] and status in TERMINAL_STATUSES:
            total_filled = sum(item["filled"] for item in intent["attempts"])
            retry = status in (53, 54) and attempt["cancel_requested"] and attempt["retry_allowed"]
            retry = retry and len(intent["attempts"]) <= MAX_ORDER_RETRIES and total_filled < intent["target"]
            intent["phase"] = "retry" if retry else "done"
        studio_save(C)
        labels = {49: "待报", 50: "已报", 51: "已报待撤", 52: "部成待撤", 53: "部撤", 54: "已撤", 55: "部分成交", 56: "全部成交", 57: "废单"}
        studio_notice(C, "【委托回报】状态：%s；本次已成交：%s 股。%s" % (labels[status], filled, getattr(row, "m_strCancelInfo", "") if status == 57 else ""))
        return


def studio_reconcile(C, orders, now):
    intent = C.studio_state["intent"]
    for row in orders:
        studio_apply_order(C, row)
    if not intent:
        # 即使状态文件被误删，也根据柜台备注拦截同日重新开仓。
        if any(str(row.m_strRemark).startswith("QS") and str(row.m_strInsertDate) == now.strftime("%Y%m%d") for row in orders):
            raise RuntimeError("发现同日生成器委托但本地记录缺失，请恢复原状态文件。")
        return
    if intent["phase"] == "retry" and intent["day"] < now.strftime("%Y%m%d"):
        # 已确认撤单的剩余量不跨日自动补单；解除昨日重试意图，今日重新判断信号。
        intent["phase"] = "done"
        studio_save(C)
    if intent["phase"] not in ("pending", "unknown"):
        return
    attempt = intent["attempts"][-1]
    if attempt["status"] in TERMINAL_STATUSES:
        return
    if time.time() - attempt["submitted"] < ORDER_TIMEOUT_SECONDS and studio_session(now):
        return
    if not attempt["order_id"]:
        studio_notice(C, "【提交结果待核对】尚无可确认的委托号，暂停重试；请查 QMT 委托记录。")
        return
    if attempt["cancel_requested"] or attempt["cancel_calls"] >= MAX_CANCEL_RETRIES:
        return
    attempt["cancel_calls"] += 1
    eligible = studio_session(now) and intent["day"] == now.strftime("%Y%m%d")
    attempt["retry_allowed"] = False
    # 先记录撤单请求；即使接口抛异常也不能当作已经撤单。
    attempt["cancel_requested"] = True
    studio_save(C)
    sent = cancel(attempt["order_id"], C.studio_account, "STOCK", C)
    if sent is True:
        attempt["retry_allowed"] = eligible
        studio_save(C)
    elif sent is False:
        attempt["cancel_requested"] = False
        studio_save(C)
    studio_notice(C, "【撤单请求】已请求撤销未成交部分，须等待柜台撤单回报；不会立即补单。")


def studio_quote(C, side, now):
    tick = C.get_full_tick([SYMBOL]).get(SYMBOL)
    if not isinstance(tick, dict):
        raise RuntimeError("未取得实时行情。")
    timestamp = float(tick["time"])
    if timestamp > 100000000000:
        timestamp /= 1000.0
    age = time.time() - timestamp
    if not math.isfinite(age) or age < -2 or age > MAX_TICK_AGE_SECONDS:
        raise RuntimeError("实时行情已过期或时钟不一致。")
    if (datetime.datetime.utcfromtimestamp(timestamp) + datetime.timedelta(hours=8)).date() != now.date():
        raise RuntimeError("行情日期不符。")
    detail = C.get_instrument_detail(SYMBOL)
    name = str(detail["InstrumentName"]).upper()
    if "ST" in name or "退" in name:
        raise RuntimeError("当前证券不属于模板允许的普通 A 股。")
    upper, lower = float(detail["UpStopPrice"]), float(detail["DownStopPrice"])
    last = float(tick["lastPrice"])
    prices, volumes = (tick["askPrice"], tick["askVol"]) if side == 1 else (tick["bidPrice"], tick["bidVol"])
    price = round(float(prices[0]), 2)
    if not all(math.isfinite(value) and value > 0 for value in (upper, lower, last, price)):
        raise RuntimeError("行情价格无效。")
    if not lower < last < upper or not lower <= price <= upper or int(volumes[0]) <= 0:
        raise RuntimeError("涨跌停、无对手报价或不可交易行情，跳过。")
    if abs(price / last - 1.0) > 0.005:
        raise RuntimeError("对手报价偏离最新价过大，跳过。")
    return price


def studio_signal(C, now):
    if not C.is_last_bar() or C.period != "1d" or C.barpos < SLOW + 2:
        return 0
    today = now.strftime("%Y%m%d")
    if timetag_to_datetime(C.get_bar_timetag(C.barpos), "%Y%m%d") != today:
        return 0
    dates = C.get_trading_dates(SYMBOL, "", today, 2, "1d")
    previous = timetag_to_datetime(C.get_bar_timetag(C.barpos - 1), "%Y%m%d")
    if len(dates) != 2 or str(dates[-1]) != today or str(dates[-2]) != previous:
        raise RuntimeError("交易日或上一根日线不完整，请补齐历史行情。")
    bar_time = timetag_to_datetime(C.get_bar_timetag(C.barpos - 1), "%Y%m%d%H%M%S")
    data = C.get_market_data_ex(["close"], [SYMBOL], period="1d", end_time=bar_time,
                                count=SLOW + 1, dividend_type="none", fill_data=False, subscribe=False)
    frame = data.get(SYMBOL)
    if frame is None or frame.empty or "close" not in frame:
        return 0
    if str(frame.index[-1]).replace("-", "")[:8] != previous:
        raise RuntimeError("历史行情末日与预期交易日不一致，已暂停。")
    return compute_signal([float(value) for value in frame["close"].tolist()])


def studio_submit(C, side, cash, equity, held, sellable, price, now):
    today = now.strftime("%Y%m%d")
    intent = C.studio_state["intent"]
    retry = bool(intent and intent["phase"] == "retry" and intent["day"] == today)
    if intent and not retry and (intent["phase"] != "done" or intent["day"] >= today):
        return
    if retry and intent["side"] != side:
        return
    filled = sum(item["filled"] for item in intent["attempts"]) if retry else 0
    spent = sum(item["filled"] * item["price"] for item in intent["attempts"]) if retry else 0.0
    if side == 1:
        if held != filled:  # 部成后的持仓尚未同步或已有其他持仓，不加仓。
            return
        budget = max(0.0, min(cash * 0.99, equity * MAX_POSITION - held * price, MAX_ORDER_VALUE - spent))
        volume = int(budget / price / 100) * 100
    else:
        budget = MAX_ORDER_VALUE - spent
        volume = min(sellable, int(budget / price / 100) * 100)
        if 0 < sellable < 100 and sellable * price <= budget:
            volume = sellable  # 零股仅允许一次性卖出全部可卖零股。
    if retry:
        volume = min(volume, intent["target"] - filled)
    if side == 1 or volume != sellable:
        volume = int(volume / 100) * 100
    if volume <= 0:
        return
    if not retry:
        intent = {"day": today, "side": side, "target": volume, "phase": "pending", "attempts": []}
        C.studio_state["intent"] = intent
    attempt = {"tag": C.studio_tag + today + str(len(intent["attempts"])), "volume": volume,
               "price": price, "submitted": time.time(), "status": None, "filled": 0,
               "order_id": "", "cancel_requested": False, "retry_allowed": False, "cancel_calls": 0}
    intent["attempts"].append(attempt)
    intent["phase"] = "pending"
    studio_save(C)
    # 指定限价，quickTrade=1 仅在最新 bar 触发；历史回放不得发出真实委托。
    try:
        passorder(23 if side == 1 else 24, 1101, C.studio_account, SYMBOL, 11, price, volume,
                  STRATEGY_NAME, 1, attempt["tag"], C)
    except Exception:
        intent["phase"] = "unknown"
        studio_save(C)
        raise RuntimeError("下单接口返回异常，提交结果未知；须查询柜台，禁止盲目重试。")
    studio_notice(C, "【实盘委托已提交】%s %s 股，限价 %.2f；此消息不代表成交。" % ("买入" if side == 1 else "卖出", volume, price))


def studio_cycle(C, allow_new):
    if not C.studio_running or getattr(C, "do_back_test", None) is not False:
        return
    with C.studio_mutex:
        try:
            now = studio_now()
            ready, cash, equity, held, sellable, orders = studio_query(C)
            studio_reconcile(C, orders, now)
            if not allow_new or not LIVE_TRADING_ENABLED or not ready or not studio_session(now):
                return
            # 任何该股的未完成委托（包括人工委托）均拦截新的下单。
            if any(int(row.m_nOrderStatus) not in TERMINAL_STATUSES for row in orders):
                return
            side = studio_signal(C, now)
            if side:
                price = studio_quote(C, side, now)
                studio_submit(C, side, cash, equity, held, sellable, price, now)
        except Exception as error:
            studio_notice(C, "【暂停下单】%s" % error)


def init(C):
    C.studio_running = False
    if getattr(C, "do_back_test", None) is not False or not LIVE_TRADING_ENABLED:
        raise RuntimeError("【未启用实盘】须在 QMT 本地核对账户后设置 LIVE_TRADING_ENABLED=True，并在策略交易界面运行。")
    if C.period != "1d":
        raise RuntimeError("实盘模板仅支持日线。")
    selected = ACCOUNT_ID
    if not selected:
        try:
            selected = account
        except NameError:
            selected = ""
    if not isinstance(selected, str) or not selected.strip() or selected.strip() == "qmt_studio_backtest":
        raise RuntimeError("请在 QMT 策略交易界面选择普通股票账户，或在本地填写 ACCOUNT_ID。")
    C.studio_account = selected.strip()
    C.studio_mutex = threading.RLock()
    C.studio_notice = ""
    C.studio_account_blocked = False
    identity = hashlib.sha256((C.studio_account + ":" + SYMBOL).encode("utf-8")).hexdigest()
    C.studio_tag = "QS" + identity[:8]
    directory = STATE_DIRECTORY or os.path.join(os.path.expanduser("~"), ".qmt_strategy_studio")
    os.makedirs(directory, exist_ok=True)
    C.studio_path = os.path.join(directory, identity + ".json")
    C.studio_lock_path = C.studio_path + ".lock"
    descriptor = os.open(C.studio_lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    os.close(descriptor)
    try:
        fingerprint = hashlib.sha256((STRATEGY_NAME + ":" + SYMBOL + ":" + KIND).encode("utf-8")).hexdigest()
        if os.path.exists(C.studio_path):
            with open(C.studio_path, "r", encoding="utf-8") as stream:
                C.studio_state = json.loads(stream.read(1048576))
            state = C.studio_state
            if state["version"] != 1 or state["identity"] != identity or state["strategy"] != fingerprint:
                raise RuntimeError("本地记录属于其他策略或版本，须核对现有委托及记录后人工迁移。")
            intent = state["intent"]
            if intent and (intent["phase"] not in ("pending", "unknown", "retry", "done") or not intent["attempts"]):
                raise RuntimeError("本地委托记录不完整，请恢复原记录。")
            if intent:
                if intent["side"] not in (-1, 1) or not isinstance(intent["target"], int) or intent["target"] <= 0:
                    raise RuntimeError("本地意图数量或方向无效。")
                datetime.datetime.strptime(intent["day"], "%Y%m%d")
                if not 1 <= len(intent["attempts"]) <= MAX_ORDER_RETRIES + 1:
                    raise RuntimeError("本地记录的重试次数异常。")
                filled_before = 0
                for index, item in enumerate(intent["attempts"]):
                    if item["tag"] != C.studio_tag + intent["day"] + str(index) or item["status"] not in (None,) + TERMINAL_STATUSES + WORKING_STATUSES:
                        raise RuntimeError("本地委托编号或状态异常。")
                    if not 0 <= item["filled"] <= item["volume"] <= intent["target"] - filled_before:
                        raise RuntimeError("本地成交数量超出原始意图。")
                    if not math.isfinite(item["price"]) or item["price"] <= 0 or not math.isfinite(item["submitted"]):
                        raise RuntimeError("本地价格或时间异常。")
                    if not isinstance(item["order_id"], str) or not isinstance(item["cancel_requested"], bool) or not isinstance(item["retry_allowed"], bool) or not 0 <= item["cancel_calls"] <= MAX_CANCEL_RETRIES:
                        raise RuntimeError("本地撤单记录异常。")
                    filled_before += item["filled"]
                if intent["phase"] == "done" and intent["attempts"][-1]["status"] not in TERMINAL_STATUSES:
                    raise RuntimeError("本地完成状态没有柜台终态依据。")
                if intent["phase"] == "retry" and (intent["attempts"][-1]["status"] not in (53, 54) or not intent["attempts"][-1]["cancel_requested"] or not intent["attempts"][-1]["retry_allowed"]):
                    raise RuntimeError("本地重试状态没有撤单确认依据。")
        else:
            C.studio_state = {"version": 1, "identity": identity, "strategy": fingerprint, "intent": None}
            studio_save(C)
        C.set_universe([SYMBOL])
        C.set_account(C.studio_account)
        C.run_time("studio_timer", "3nSecond", "2020-01-01 09:30:00")
        C.studio_running = True
        print("【实盘模板已启动】本地开关已启用；账户状态、行情和预算全部满足后才下单。")
    except Exception:
        os.remove(C.studio_lock_path)
        raise


def handlebar(C):
    studio_cycle(C, True)


def studio_timer(C):
    # 无行情到达时也查询未完成委托并管理超时撤单；定时器不产生新委托。
    studio_cycle(C, False)


def order_callback(C, order_info):
    if not C.studio_running:
        return
    with C.studio_mutex:
        try:
            studio_apply_order(C, order_info)
        except Exception as error:
            C.studio_running = False
            print("【回报异常，已停止自动交易】%s" % error)


def deal_callback(C, deal_info):
    # 成交回报可能重复；以委托累计成交量和持仓查询复核，不能累加回调次数。
    studio_timer(C)


def account_callback(C, account_info):
    if C.studio_running and str(account_info.m_strAccountID) == C.studio_account:
        with C.studio_mutex:
            C.studio_account_blocked = not bool(ACCOUNT_READY_STATUS) or str(account_info.m_strStatus) != ACCOUNT_READY_STATUS
    studio_timer(C)


def orderError_callback(C, passorder_info, msg):
    print("【下单异常回报】%s；先核对委托记录，不据此自动重发。" % msg)
    studio_timer(C)


def stop(C):
    # 停止脚本不会保证柜台委托已撤；未完成委托须在 QMT 委托界面继续管理。
    if not C.studio_running:
        return
    with C.studio_mutex:
        C.studio_running = False
        studio_save(C)
        os.remove(C.studio_lock_path)
        print("【策略已停止】意图记录已保存；请在 QMT 核对并处理仍未完成的委托。")
