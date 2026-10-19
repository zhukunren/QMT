"""Trusted AST inspection only. Never executes a submitted script."""
import ast
import json
import sys
from pathlib import Path


def validate(code):
    checks = []

    def check(key, name, passed, detail):
        checks.append(dict(id=key, name=name, status="pass" if passed else "fail", detail=detail))

    try:
        tree = ast.parse(code, feature_version=(3, 6))
        check("syntax", "Python 3.6 语法兼容", True, "使用 Python AST 3.6 语法规则解析；不等于目标客户端运行测试。")
    except (SyntaxError, ValueError) as error:
        check("syntax", "Python 3.6 语法兼容", False, str(error))
        return checks
    nodes = list(ast.walk(tree))
    functions = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
    live = any(isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "EXECUTION_MODE" for t in n.targets) and isinstance(n.value, ast.Constant) and n.value.value == "live" for n in tree.body)
    if live:
        return validate_live(code, tree, checks, check)
    check("lifecycle", "QMT 生命周期", all(k in functions and len(functions[k].args.args) == 1 for k in ("init", "handlebar")), "检查 init(C) 和 handlebar(C) 入口。")
    imports = [n for n in nodes if isinstance(n, (ast.Import, ast.ImportFrom))]
    import_ok = all(isinstance(n, ast.Import) and all(a.name == "math" for a in n.names) for n in imports)
    calls = [n for n in nodes if isinstance(n, ast.Call)]
    bad = {"exec", "eval", "compile", "open", "__import__", "globals", "locals", "getattr"}
    unsafe = [c for c in calls if isinstance(c.func, ast.Name) and c.func.id in bad and not (
        c.func.id == "getattr" and len(c.args) == 3 and isinstance(c.args[1], ast.Constant) and c.args[1].value == "do_back_test")]
    check("safe-api", "依赖与危险调用", import_ok and not unsafe, "仅允许标准库 math；阻断文件、网络、动态执行等危险调用。")
    check("encoding", "GBK 导出兼容", code.startswith("#coding:gbk") and encodable(code), "逐字符检查 GBK 可编码性；下载时按 GBK 实际编码。")
    market_calls = [c for c in calls if isinstance(c.func, ast.Attribute) and c.func.attr == "get_market_data_ex"]
    bounded = bool(market_calls) and all(any(k.arg == "end_time" and isinstance(k.value, ast.Name) and k.value.id == "bar_time" for k in c.keywords) and any(k.arg == "subscribe" and isinstance(k.value, ast.Constant) and k.value.value is False for k in c.keywords) for c in market_calls)
    check("history", "历史数据时间边界", bounded and "C.get_bar_timetag(C.barpos - 1)" in code, "行情截至前一根 K 线，关闭订阅；复权显式设置 none。")
    check("live-block", "实盘与未知环境阻断", code.count('getattr(C, "do_back_test", None) is not True') == 2, "init 和 handlebar 双重检查回测标识；未知值拒绝执行。")
    check("idempotency", "重复 K 线保护", "C.barpos <= C.studio_last_bar" in code and "C.studio_last_bar = C.barpos" in code, "相同或倒退 barpos 不再处理。")
    check("risk", "委托边界与可用持仓", all(s in code for s in ("cash * 0.99", "equity * MAX_POSITION", "MAX_ORDER_VALUE", "int(budget / price / 100) * 100", "m_nCanUseVolume", "math.isfinite", "frame.empty")), "检查现金缓冲、仓位上限、单笔限额、100 股取整、可卖数量与缺失数据。")
    orders = [c for c in calls if isinstance(c.func, ast.Name) and c.func.id == "passorder"]
    check("orders", "交易接口参数", len(orders) == 2 and all(len(c.args) == 11 and isinstance(c.args[1], ast.Constant) and c.args[1].value == 1101 and isinstance(c.args[8], ast.Constant) and c.args[8].value == 0 for c in orders), "校验 passorder 11 参数、1101 股数单位、quickTrade=0。")
    return checks


def validate_live(code, tree, checks, check):
    begin, end = "# QMT_STUDIO_LIVE_RUNTIME_BEGIN\n", "# QMT_STUDIO_LIVE_RUNTIME_END"
    canonical = Path(__file__).with_name("live_runtime.py").read_text(encoding="utf-8").strip()
    signal = ast.dump(ast.parse(Path(__file__).with_name("signal_runtime.py").read_text(encoding="utf-8")))
    intact = code.count(begin) == 1 and code.count(end) == 1
    header_ok = False
    if intact:
        before, rest = code.split(begin, 1)
        body, after = rest.split(end, 1)
        intact = body.strip() == canonical and not after.strip()
        prefix = ast.parse(before)
        values, signal_functions, math_imports = {}, [], 0
        try:
            for node in prefix.body:
                if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                    key = node.targets[0].id
                    if key in values:
                        raise ValueError("duplicate parameter")
                    values[key] = ast.literal_eval(node.value)
                elif isinstance(node, ast.Import) and len(node.names) == 1 and node.names[0].name == "math" and node.names[0].asname is None:
                    math_imports += 1
                elif isinstance(node, ast.FunctionDef) and node.name == "compute_signal":
                    signal_functions.append(ast.dump(ast.Module(body=[node], type_ignores=[])))
                else:
                    raise ValueError("unexpected prefix")
            expected = {"EXECUTION_MODE", "STRATEGY_NAME", "KIND", "SYMBOL", "FAST", "SLOW", "THRESHOLD", "MAX_POSITION", "MAX_ORDER_VALUE"}
            header_ok = set(values) == expected and math_imports == 1 and signal_functions == [signal]
            header_ok = header_ok and values["EXECUTION_MODE"] == "live" and values["KIND"] in ("ma_cross", "momentum", "mean_reversion")
            header_ok = header_ok and 0.01 <= values["MAX_POSITION"] <= 1 and 1000 <= values["MAX_ORDER_VALUE"] <= 1000000
            header_ok = header_ok and 2 <= values["FAST"] <= 120 and 3 <= values["SLOW"] <= 250 and 0.001 <= values["THRESHOLD"] <= 0.3
            header_ok = header_ok and (values["KIND"] != "ma_cross" or values["FAST"] < values["SLOW"])
        except (ValueError, TypeError, KeyError):
            header_ok = False
    functions = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
    check("lifecycle", "实盘生命周期与回报", all(name in functions for name in ("init", "handlebar", "studio_timer", "order_callback", "deal_callback", "orderError_callback", "account_callback", "stop")), "包含初始化、行情、定时查询、账户、委托、成交、异常及停止处理。")
    check("safe-api", "固定实盘运行层完整性", intact and header_ok, "只接受本地维护的完整实盘模板与字面量参数；本地状态文件 I/O 受固定模板约束，不允许任意代码。")
    check("encoding", "GBK 导出兼容", code.startswith("#coding:gbk") and encodable(code), "源码可实际编码为 GBK。")
    check("history", "实时与历史数据边界", intact and "get_trading_dates" in code and "C.get_bar_timetag(C.barpos - 1)" in code, "仅最新日线触发，核对上一交易日与数据末日；行情有 15 秒新鲜度限制。")
    check("live-gate", "实盘默认关闭与账户检查", intact and "LIVE_TRADING_ENABLED = False" in code and "ACCOUNT_READY_STATUS = \"\"" in code, "下载后必须在 QMT 本地显式启用并配置已登录状态；拒绝回测及未知环境。")
    check("idempotency", "持久意图与单实例保护", intact and "os.O_EXCL" in code and "os.fsync" in code, "持久化后提交；账户和股票共用锁，重启恢复意图，未知提交结果不重发。")
    check("risk", "实盘预算与行情风控", intact and "MAX_ORDER_VALUE - spent" in code and "m_nCanUseVolume" in code, "买卖单笔限额、累计重试预算、现金缓冲、买入仓位、可卖持仓、交易时段、ST/退市名称、涨跌停与对手报价检查。")
    orders = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "passorder"]
    check("orders", "限价委托接口", len(orders) == 1 and len(orders[0].args) == 11 and isinstance(orders[0].args[4], ast.Constant) and orders[0].args[4].value == 11 and isinstance(orders[0].args[8], ast.Constant) and orders[0].args[8].value == 1, "1101 股数单位、指定限价、quickTrade=1，仅最新 bar 触发。")
    check("order-state", "撤单、部分成交与重试", intact and "MAX_ORDER_RETRIES = 1" in code and "TERMINAL_STATUSES = (53, 54, 56, 57)" in code, "超时请求撤单；仅已确认的本策略撤单允许一次剩余量重试，拒绝或未知结果不重发。")
    return checks


def encodable(code):
    try:
        code.encode("gbk")
        return True
    except UnicodeEncodeError:
        return False


if __name__ == "__main__":
    payload = json.load(sys.stdin)
    print(json.dumps({"checks": validate(payload["code"]), "pythonVersion": sys.version.split()[0]}, ensure_ascii=True))
