import { useRef, useState, type FormEvent, type RefObject } from "react";
import { LoaderCircle, Trash2, X } from "lucide-react";
import { artifactName, kindLabels, type ArtifactSummary } from "@qmt/shared";
import { api, ApiError } from "./api";
import { useDialogFocus } from "./useDialogFocus";

export function DeleteScriptDialog({
  item,
  onClose,
  onDeleted,
  returnFocus,
}: {
  item: ArtifactSummary;
  onClose: () => void;
  onDeleted: (id: string) => void;
  returnFocus: RefObject<HTMLElement | null>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const dialog = useRef<HTMLFormElement>(null);
  useDialogFocus(
    dialog,
    true,
    () => {
      if (!pending.current) onClose();
    },
    returnFocus,
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      await api(`/artifacts/${item.id}`, { method: "DELETE" });
      onDeleted(item.id);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 404)
        onDeleted(item.id);
      else
        setError(
          failure instanceof Error ? failure.message : "删除未完成，请重试。",
        );
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  return (
    <div className="modal-overlay">
      <form
        ref={dialog}
        className="modal delete-script-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-script-title"
        aria-describedby="delete-script-description"
        onSubmit={submit}
      >
        <button
          type="button"
          className="modal-close icon-button"
          aria-label="关闭删除确认"
          disabled={saving}
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <span className="modal-illustration delete-illustration">
          <Trash2 size={24} />
        </span>
        <h2 id="delete-script-title">删除这份脚本？</h2>
        <div className="delete-script-summary">
          <strong>{artifactName(item)}</strong>
          <span>
            {item.spec.symbol} · {kindLabels[item.spec.kind]}
          </span>
        </div>
        <p className="modal-subtitle" id="delete-script-description">
          删除后无法从工作台恢复，相关校验报告也会删除。已下载的文件及 QMT
          中运行的策略不受影响。
        </p>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={saving}
            onClick={onClose}
          >
            取消
          </button>
          <button type="submit" className="danger-button" disabled={saving}>
            {saving ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Trash2 size={16} />
            )}
            {saving ? "正在删除…" : "确认删除"}
          </button>
        </div>
      </form>
    </div>
  );
}
