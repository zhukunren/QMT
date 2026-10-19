import { useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  Clock3,
  Info,
  LoaderCircle,
  RefreshCw,
  Settings2,
} from "lucide-react";
import type { Job } from "@qmt/shared";
import { ApiError } from "./api";

export function TaskProgress({
  phase,
  busy,
  startedAt,
  job,
  failure,
  onRetry,
  onReview,
  onSettings,
}: {
  phase: "understand" | "generate";
  busy: boolean;
  startedAt?: number;
  job?: Job;
  failure?: ApiError;
  onRetry: () => void;
  onReview?: () => void;
  onSettings: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt || !busy) return;
    const update = () =>
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startedAt, busy]);
  const generating = phase === "generate";
  const needsReview =
    failure &&
    [
      "PLAN_EXPIRED",
      "PLAN_MISSING",
      "REQUEST_CONFLICT",
      "ARTIFACT_DELETED",
    ].includes(failure.code);
  const canResume = generating && job?.status !== "failed";
  const title = failure
    ? needsReview
      ? "请重新确认策略规则"
      : generating
        ? job?.status === "failed"
          ? "脚本生成未完成"
          : "进度查询暂时中断"
        : "策略理解未完成"
    : generating
      ? job?.status === "completed"
        ? "正在打开生成结果"
        : "正在生成您的策略脚本"
      : "正在理解您的策略想法";
  const stages = ["接收任务", "生成脚本", "静态校验", "保存结果"];
  return (
    <section
      className={`task-progress ${generating ? "panel generation-progress" : "understanding-progress"} ${failure ? "has-failure" : ""}`}
      aria-label={generating ? "生成进度" : "策略理解进度"}
    >
      <div className="task-heading">
        {failure ? (
          <Info size={22} />
        ) : (
          <LoaderCircle size={22} className="spin" />
        )}
        <div>
          <h2>{title}</h2>
          <p>
            {failure
              ? "输入与确认规则已保留，请按下方提示恢复。"
              : generating
                ? "根据已确认的规则生成，不需要重复提交。"
                : "正在核对标的、买卖条件和资金预算，请稍候。"}
          </p>
        </div>
        {busy && (
          <span className="elapsed">
            <Clock3 size={14} />
            已等待 {elapsed} 秒
          </span>
        )}
      </div>
      {generating && (
        <ol className="generation-stages" aria-label="生成阶段">
          {stages.map((label, index) => {
            const stage = job?.stage || 0;
            const done = stage > index;
            const current = Math.min(stage, 3) === index && stage < 4;
            return (
              <li
                key={label}
                className={
                  done
                    ? "done"
                    : current
                      ? failure
                        ? "interrupted"
                        : "current"
                      : ""
                }
                aria-current={current ? "step" : undefined}
              >
                <span>{done ? <Check size={15} /> : index + 1}</span>
                <strong>{label}</strong>
                <small>
                  {done
                    ? "已完成"
                    : current
                      ? failure
                        ? "待恢复"
                        : "进行中"
                      : "等待中"}
                </small>
              </li>
            );
          })}
        </ol>
      )}
      {busy && (
        <p className="task-status" role="status">
          {generating
            ? job?.events.at(-1)?.message || "正在提交已确认的策略规则…"
            : elapsed >= 20
              ? "理解仍在进行，您填写的内容已保留，请勿重复提交。"
              : "理解完成后，会先展示规则供您核对。"}
        </p>
      )}
      {failure && (
        <div className="inline-error" role="alert">
          <Info size={18} />
          <div>
            <strong>{failure.message}</strong>
            <p>
              {generating
                ? canResume && !needsReview
                  ? "后台任务可能仍在继续，恢复查询会沿用原任务，不会重复生成。"
                  : "已保留确认后的规则，修复问题后可以重试。"
                : "描述和参数均已保留，可以调整后重新理解。"}
            </p>
          </div>
        </div>
      )}
      {job?.events.length ? (
        <details className="task-log">
          <summary>查看处理记录（{job.events.length}）</summary>
          <ol>
            {job.events.map((event, i) => (
              <li key={i}>
                <time>
                  {new Date(event.at).toLocaleTimeString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                    hour12: false,
                  })}
                </time>
                <span>{event.message}</span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {failure && (
        <div className="task-recovery">
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={needsReview && onReview ? onReview : onRetry}
          >
            <RefreshCw size={16} />
            {needsReview
              ? "重新核对规则"
              : generating
                ? job?.status === "failed"
                  ? "重新生成"
                  : "恢复生成进度"
                : "重新理解策略"}
          </button>
          {onReview && !needsReview && (
            <button
              type="button"
              className="secondary-button"
              onClick={onReview}
            >
              核对并修改规则
            </button>
          )}
          <button type="button" className="text-button" onClick={onSettings}>
            <Settings2 size={15} />
            连接设置
          </button>
        </div>
      )}
      {generating && !failure && (
        <p className="task-footnote">
          <CheckCircle2 size={15} />
          静态检查通过后可下载；QMT 客户端验收会单独列为待办。
        </p>
      )}
    </section>
  );
}
