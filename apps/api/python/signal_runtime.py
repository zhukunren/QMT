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
