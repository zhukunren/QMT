import { useRef, useState } from "react";
import { ArrowRight, Check, FileText, Layers3, X } from "lucide-react";
import { executionLabels, type StrategySpec } from "@qmt/shared";
import { strategyTemplates, templatePreview, templateSpec } from "./onboarding";
import { useDialogFocus } from "./useDialogFocus";

export function TemplatePicker({
  spec,
  initialKind,
  onApply,
  onClose,
}: {
  spec: StrategySpec;
  initialKind?: StrategySpec["kind"];
  onApply: (kind: StrategySpec["kind"], manual: boolean) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState(initialKind || spec.kind);
  const dialog = useRef<HTMLElement>(null);
  useDialogFocus(dialog, true, onClose);
  const current = templateSpec(spec, kind);
  const rules = templatePreview(spec, kind);
  return (
    <div
      className="modal-overlay template-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal template-picker"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-picker-title"
        tabIndex={-1}
      >
        <header className="template-picker-header">
          <div>
            <div className="eyebrow">从一个清楚的规则开始</div>
            <h2 id="template-picker-title">选择策略模板</h2>
            <p>先比较买卖条件，再选择创建方式。</p>
          </div>
          <button
            className="icon-button"
            aria-label="关闭模板选择"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <div className="template-picker-body">
          <div
            className="template-choice-list"
            role="group"
            aria-label="策略模板选项"
          >
            {strategyTemplates.map((template) => (
              <button
                key={template.kind}
                className={`template-choice ${kind === template.kind ? "selected" : ""}`}
                aria-pressed={kind === template.kind}
                onClick={() => setKind(template.kind)}
              >
                <span className="template-choice-indicator">
                  {kind === template.kind ? (
                    <Check size={15} />
                  ) : (
                    <Layers3 size={15} />
                  )}
                </span>
                <span>
                  <strong>{template.title}</strong>
                  <small>{template.description}</small>
                </span>
                <span className="template-choice-tag">{template.tag}</span>
              </button>
            ))}
          </div>
          <section
            className="template-rule-preview"
            aria-label="所选模板的规则"
            aria-live="polite"
          >
            <h3>本次将使用的规则</h3>
            {rules ? (
              <>
                <p>
                  <span>买入</span>
                  {rules.buy}
                </p>
                <p>
                  <span>卖出</span>
                  {rules.sell}
                </p>
              </>
            ) : (
              <p>当前参数需要先修正，应用后可在参数区继续调整。</p>
            )}
            <div className="template-kept-settings">
              <span>{current.symbol || "股票待填写"}</span>
              <span>日线</span>
              <span>{executionLabels[current.execution]}</span>
              <span>
                {Number.isFinite(current.maxPositionPct)
                  ? `仓位上限 ${current.maxPositionPct}%`
                  : "仓位待填写"}
              </span>
            </div>
            <small>
              股票、预算和生成用途沿用当前设置；切换模板时填入该模板的默认周期与阈值。
            </small>
          </section>
        </div>
        <footer className="template-picker-footer">
          <button
            className="secondary-button"
            onClick={() => onApply(kind, false)}
          >
            <FileText size={16} />
            填入策略描述
          </button>
          <button
            className="primary-button"
            onClick={() => onApply(kind, true)}
          >
            <Layers3 size={16} />
            使用模板创建
            <ArrowRight size={16} />
          </button>
        </footer>
      </section>
    </div>
  );
}
export function FirstRunGuide({
  onTemplate,
  onGuide,
  disabled,
}: {
  onTemplate: () => void;
  onGuide: () => void;
  disabled: boolean;
}) {
  return (
    <section className="first-run-guide panel" aria-label="首次使用引导">
      <span className="square-icon">
        <Layers3 size={22} />
      </span>
      <div>
        <h2>第一次使用？先跑通一个示例</h2>
        <p>选模板 → 核对规则 → 生成脚本 → 按步骤载入 QMT。</p>
      </div>
      <div>
        <button
          className="primary-button"
          disabled={disabled}
          onClick={onTemplate}
        >
          选择入门模板
          <ArrowRight size={15} />
        </button>
        <button className="text-button" onClick={onGuide}>
          查看上手步骤
        </button>
      </div>
    </section>
  );
}
