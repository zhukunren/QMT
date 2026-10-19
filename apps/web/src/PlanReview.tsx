import { useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight,
  CheckCircle2,
  FileCode2,
  Info,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  defaultSpec,
  kindLabels,
  specSchema,
  specErrors,
  strategyRules,
  type Plan,
  type SpecErrors,
  type StrategySpec,
} from "@qmt/shared";
import { api, ApiError } from "./api";
import { SourceCard } from "./SourceCard";

export function PlanReview({
  plan,
  onConfirm,
  onBack,
}: {
  plan: Plan;
  onConfirm: (reviewed: Plan) => void;
  onBack: (spec: StrategySpec) => void;
}) {
  const [value, setValue] = useState<StrategySpec>({ ...plan.spec });
  const [touched, setTouched] = useState<SpecErrors>({});
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<ApiError>();
  const submitting = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const limits = plan.riskLimits || plan.spec;
  const errors = { ...specErrors(value, limits), ...failure?.fields };
  const dirty = (key: keyof StrategySpec) => value[key] !== plan.spec[key];
  const changed = Object.keys(value).some((key) =>
    dirty(key as keyof StrategySpec),
  );
  function field<K extends keyof StrategySpec>(key: K, next: StrategySpec[K]) {
    setValue((current) => ({ ...current, [key]: next }));
    setFailure(undefined);
  }
  function changeKind(kind: StrategySpec["kind"]) {
    setValue((current) => {
      const next = { ...current, kind };
      const invalid = specErrors(next);
      // Clear invalid values only for controls the new template no longer uses.
      if (kind !== "ma_cross" && invalid.fastWindow)
        next.fastWindow = defaultSpec.fastWindow;
      if (kind === "ma_cross" && invalid.threshold)
        next.threshold = defaultSpec.threshold;
      return next;
    });
    setFailure(undefined);
  }
  function source(key: keyof StrategySpec) {
    return (
      <span className={`rule-source ${dirty(key) ? "edited" : ""}`}>
        {dirty(key)
          ? "已修改"
          : plan.editedFields?.includes(key)
            ? "手动确认"
            : plan.provider === "codex"
              ? "AI 解析"
              : "模板参数"}
      </span>
    );
  }
  function control(
    key: keyof StrategySpec,
    label: string,
    input: ReactNode,
    hint?: string,
  ) {
    const error = (attempted || touched[key]) && errors[key];
    return (
      <div className={`review-field ${error ? "has-error" : ""}`}>
        <div className="review-field-heading">
          <label htmlFor={`review-${key}`}>{label}</label>
          {source(key)}
        </div>
        {input}
        {hint && <small>{hint}</small>}
        {error && (
          <p className="field-error" id={`review-${key}-error`}>
            {error}
          </p>
        )}
      </div>
    );
  }
  function inputProps(key: keyof StrategySpec) {
    return {
      id: `review-${key}`,
      disabled: saving,
      "aria-invalid": Boolean((attempted || touched[key]) && errors[key]),
      "aria-describedby":
        (attempted || touched[key]) && errors[key]
          ? `review-${key}-error`
          : undefined,
      onBlur: () => setTouched((current) => ({ ...current, [key]: "touched" })),
    };
  }
  function number(
    key:
      | "fastWindow"
      | "slowWindow"
      | "threshold"
      | "maxPositionPct"
      | "maxOrderValue",
    label: string,
    min: number,
    max: number,
    step = 1,
    hint?: string,
  ) {
    const multiplier = key === "threshold" ? 100 : 1;
    return control(
      key,
      label,
      <input
        {...inputProps(key)}
        type="number"
        min={min}
        max={max}
        step={step}
        value={
          Number.isFinite(value[key])
            ? Number((value[key] * multiplier).toFixed(8))
            : ""
        }
        onChange={(e) =>
          field(
            key,
            e.target.value === "" ? NaN : Number(e.target.value) / multiplier,
          )
        }
      />,
      hint,
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    setAttempted(true);
    setFailure(undefined);
    const nextErrors = specErrors(value, limits);
    if (Object.keys(nextErrors).length) {
      const key = Object.keys(nextErrors)[0];
      formRef.current
        ?.querySelector<HTMLInputElement>(`#review-${key}`)
        ?.focus();
      return;
    }
    submitting.current = true;
    setSaving(true);
    try {
      const reviewed = await api<Plan>(`/plans/${plan.id}/revisions`, {
        method: "POST",
        body: JSON.stringify({ spec: specSchema.parse(value) }),
      });
      onConfirm(reviewed);
    } catch (error) {
      setFailure(
        error instanceof ApiError
          ? error
          : new ApiError("规则校验未完成，请稍后重试。"),
      );
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
  const rulesValid = !(["fastWindow", "slowWindow", "threshold"] as const).some(
    (key) => errors[key],
  );
  const rules = strategyRules(value);
  return (
    <div className="modal-overlay">
      <form
        ref={formRef}
        className="modal plan-modal rule-review"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-title"
        onSubmit={submit}
        noValidate
      >
        <header className="review-header">
          <div>
            <div className="eyebrow">确认策略 · 第 2 步</div>
            <h2 id="plan-title">核对并调整策略规则</h2>
            <p>逐项确认，修改后的规则将重新校验后用于生成。</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭策略确认"
            onClick={() => onBack(value)}
            disabled={saving}
          >
            <X size={20} />
          </button>
        </header>
        <div className="review-body">
          <div className="review-section-title">
            <span>01</span>
            <h3>策略与标的</h3>
          </div>
          <div className="review-grid">
            {control(
              "name",
              "策略名称",
              <input
                {...inputProps("name")}
                value={value.name}
                maxLength={60}
                onChange={(e) => field("name", e.target.value)}
              />,
            )}
            {control(
              "symbol",
              "股票代码",
              <input
                {...inputProps("symbol")}
                value={value.symbol}
                placeholder="600000.SH"
                onChange={(e) => field("symbol", e.target.value.toUpperCase())}
              />,
            )}
            {control(
              "kind",
              "策略模板",
              <select
                {...inputProps("kind")}
                value={value.kind}
                onChange={(e) =>
                  changeKind(e.target.value as StrategySpec["kind"])
                }
              >
                {Object.entries(kindLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>,
            )}
            {control(
              "execution",
              "运行方式",
              <select
                {...inputProps("execution")}
                value={value.execution}
                onChange={(e) =>
                  field(
                    "execution",
                    e.target.value as StrategySpec["execution"],
                  )
                }
              >
                <option value="signal">仅输出买卖信号</option>
                <option value="backtest">历史回测（虚拟下单）</option>
                <option value="live">实盘交易（QMT 本地启用）</option>
              </select>,
            )}
          </div>
          <div className="review-section-title">
            <span>02</span>
            <h3>买入与卖出条件</h3>
            <small>调整周期与阈值，规则同步更新</small>
          </div>
          <div className="rule-preview" aria-live="polite">
            <div>
              <strong>买入</strong>
              <p>{rulesValid ? rules.buy : "请先填写有效的周期与阈值。"}</p>
            </div>
            <div>
              <strong>卖出</strong>
              <p>{rulesValid ? rules.sell : "请先填写有效的周期与阈值。"}</p>
            </div>
          </div>
          <div className="review-grid">
            {value.kind === "ma_cross" &&
              number("fastWindow", "短均线周期（天）", 2, 120)}
            {number(
              "slowWindow",
              value.kind === "ma_cross" ? "长均线周期（天）" : "观察周期（天）",
              3,
              250,
            )}
            {value.kind !== "ma_cross" &&
              number(
                "threshold",
                value.kind === "momentum"
                  ? "涨跌幅阈值（%）"
                  : "均价偏离阈值（%）",
                0.1,
                30,
                0.1,
              )}
          </div>
          <div className="review-section-title">
            <span>03</span>
            <h3>仓位与资金预算</h3>
          </div>
          <div className="review-grid">
            {number(
              "maxPositionPct",
              "仓位预算上限（%）",
              1,
              limits.maxPositionPct,
              1,
              `创建时的上限：${limits.maxPositionPct}%`,
            )}
            {number(
              "maxOrderValue",
              value.execution === "live"
                ? "单笔委托上限（元）"
                : "单笔买入预算（元）",
              1000,
              limits.maxOrderValue,
              1000,
              `创建时的上限：${limits.maxOrderValue.toLocaleString("zh-CN")} 元`,
            )}
          </div>
          <div className="review-conventions">
            <ShieldCheck size={18} />
            <div>
              <strong>固定运行约定</strong>
              <p>
                单只沪深主板普通 A 股 · 日线 · 使用前一根已完成 K 线 ·
                仅在无持仓时买入。
                {value.execution === "live"
                  ? "实盘脚本默认关闭交易开关，须在 QMT 本地选择账户、配置已登录状态并启用；先用模拟柜台验收。买卖均受单笔限额约束，卖出可能跨日完成。"
                  : "脚本只在 QMT 回测环境运行，静态校验后仍需客户端验收。"}
              </p>
            </div>
          </div>
          {Boolean(plan.sources?.length) && (
            <details className="review-document-sources">
              <summary>
                查看本次策略的官方章节依据（{plan.sources!.length} 条）
              </summary>
              <p>
                以下为理解本次需求时保存的正文依据；修改参数后会按当前模板重新绑定引用。
              </p>
              <div className="source-list">
                {plan.sources!.map((source) => (
                  <SourceCard key={source.id} source={source} />
                ))}
              </div>
            </details>
          )}
          <details className="review-reference">
            <summary>查看原始描述与解析说明</summary>
            {plan.prompt && <p>{plan.prompt}</p>}
            <ul>
              {plan.assumptions.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
            {changed && (
              <p>以上为修改前的解析说明；本次生成以当前核对的规则为准。</p>
            )}
          </details>
        </div>
        <footer className="review-footer">
          {failure && (
            <div className="inline-error" role="alert">
              <Info size={18} />
              <div>
                <strong>规则校验未完成</strong>
                <p>{failure.message}</p>
                <small>您的修改已保留。检查后可再次点击确认。</small>
              </div>
            </div>
          )}
          {attempted && !failure && Object.keys(errors).length > 0 && (
            <p className="field-error" role="alert">
              请修正标记的输入项，再确认生成。
            </p>
          )}
          <div className="review-footer-status">
            <CheckCircle2 size={15} />
            {changed
              ? "已修改的参数会用于本次脚本生成"
              : "确认后生成脚本，并执行静态校验"}
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="text-button"
              disabled={saving || !changed}
              onClick={() => {
                setValue({ ...plan.spec });
                setAttempted(false);
                setTouched({});
                setFailure(undefined);
              }}
            >
              <RotateCcw size={14} />
              还原规则
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={saving}
              onClick={() => onBack(value)}
            >
              返回修改
            </button>
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <FileCode2 size={16} />
              )}{" "}
              {saving ? "正在校验规则…" : "确认并生成脚本"}
              <ArrowRight size={16} />
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
