import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  FileCode2,
  FolderOpen,
  Info,
  LoaderCircle,
  PencilLine,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import {
  artifactName,
  kindLabels,
  scriptNameSchema,
  type ArtifactSummary,
} from "@qmt/shared";
import { api, ApiError, download } from "./api";
import { filterScripts, type LibraryFilters } from "./library";
import { DeleteScriptDialog } from "./DeleteScriptDialog";

const defaultFilters: LibraryFilters = {
  query: "",
  kind: "all",
  status: "all",
};
function time(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
export function ScriptLibrary({
  items,
  busy,
  loading,
  loadError,
  onReload,
  onOpen,
  onCopy,
  onTemplate,
  onResume,
  onImport,
  onRenamed,
  onDeleted,
  onNotice,
}: {
  items: ArtifactSummary[];
  busy: boolean;
  loading: boolean;
  loadError: string;
  onReload: () => void;
  onOpen: (id: string) => Promise<void>;
  onCopy: (id: string) => Promise<void>;
  onTemplate: () => void;
  onResume: () => void;
  onImport: (id: string) => void;
  onRenamed: (item: ArtifactSummary) => void;
  onDeleted: (id: string) => void;
  onNotice: (message: string) => void;
}) {
  const [filters, setFilters] = useState(defaultFilters);
  const [renaming, setRenaming] = useState<ArtifactSummary>();
  const [removing, setRemoving] = useState<ArtifactSummary>();
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const [action, setAction] = useState<{
    id: string;
    kind: "download" | "copy";
  }>();
  const [failure, setFailure] = useState<{
    id: string;
    kind: "download" | "copy";
    message: string;
  }>();
  const [downloadedId, setDownloadedId] = useState<string>();
  const pending = useRef(false);
  const visible = filterScripts(items, filters);
  const filtered =
    filters.query !== "" || filters.kind !== "all" || filters.status !== "all";
  async function run(item: ArtifactSummary, kind: "download" | "copy") {
    if (pending.current || (kind === "copy" && busy)) return;
    pending.current = true;
    setAction({ id: item.id, kind });
    setFailure(undefined);
    try {
      if (kind === "download") {
        await download(item.id);
        setDownloadedId(item.id);
        onNotice(`“${artifactName(item)}”已下载`);
      } else await onCopy(item.id);
    } catch (error) {
      setFailure({
        id: item.id,
        kind,
        message:
          error instanceof Error ? error.message : "操作未完成，请重试。",
      });
    } finally {
      pending.current = false;
      setAction(undefined);
    }
  }
  return (
    <>
      <section className="script-filters panel" aria-label="筛选脚本">
        <label className="script-search">
          <Search size={18} />
          <input
            aria-label="搜索脚本"
            placeholder="搜索名称或股票代码"
            value={filters.query}
            onChange={(e) =>
              setFilters((current) => ({ ...current, query: e.target.value }))
            }
          />
          {filters.query && (
            <button
              aria-label="清空搜索"
              onClick={() =>
                setFilters((current) => ({ ...current, query: "" }))
              }
            >
              <X size={15} />
            </button>
          )}
        </label>
        <label className="script-filter">
          <span>策略类型</span>
          <select
            aria-label="按策略类型筛选"
            value={filters.kind}
            onChange={(e) =>
              setFilters((current) => ({
                ...current,
                kind: e.target.value as LibraryFilters["kind"],
              }))
            }
          >
            <option value="all">全部策略类型</option>
            {Object.entries(kindLabels).map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="script-filter">
          <span>校验状态</span>
          <select
            aria-label="按状态筛选"
            value={filters.status}
            onChange={(e) =>
              setFilters((current) => ({
                ...current,
                status: e.target.value as LibraryFilters["status"],
              }))
            }
          >
            <option value="all">全部状态</option>
            <option value="passed">静态通过 · 待验收</option>
            <option value="failed">校验未通过</option>
          </select>
        </label>
      </section>
      <div className="script-list-summary">
        <p role="status">
          显示 <strong>{visible.length}</strong> / {items.length} 份脚本
        </p>
        {filtered && (
          <button
            className="text-button"
            onClick={() => setFilters(defaultFilters)}
          >
            <X size={14} />
            清除筛选
          </button>
        )}
        <span>按创建时间由近到远</span>
      </div>
      {loadError && (
        <div className="inline-error library-load-error" role="alert">
          <Info size={18} />
          <div>
            <strong>脚本列表暂时无法刷新</strong>
            <p>{loadError}</p>
          </div>
          <button className="text-button" onClick={onReload} disabled={loading}>
            重新加载
          </button>
        </div>
      )}
      {!items.length && loading ? (
        <div className="library-loading panel" role="status">
          <LoaderCircle size={22} className="spin" />
          正在加载您的脚本…
        </div>
      ) : !items.length && loadError ? null : visible.length ? (
        <div className="script-list">
          {visible.map((item) => (
            <article
              className="script-row panel"
              key={item.id}
              aria-label={`${artifactName(item)} · ${item.spec.symbol}`}
            >
              <button
                className="script-row-main"
                onClick={() => void onOpen(item.id)}
                aria-label={`查看 ${artifactName(item)} ${item.spec.symbol}`}
              >
                <span className="square-icon">
                  <FileCode2 size={21} />
                </span>
                <div>
                  <h2 title={artifactName(item)}>{artifactName(item)}</h2>
                  <p>
                    <span className="script-symbol">{item.spec.symbol}</span>
                    <span>{kindLabels[item.spec.kind]}</span>
                    <span>
                      {item.spec.execution === "signal"
                        ? "信号研究"
                        : item.spec.execution === "live"
                          ? "实盘脚本"
                          : "历史回测"}
                    </span>
                  </p>
                </div>
                <ChevronRight className="script-row-arrow" size={16} />
              </button>
              <div className="script-row-state">
                <span
                  className={`status-pill ${item.report.passed ? "good" : "bad"}`}
                >
                  {item.report.passed ? (
                    <CheckCircle2 size={13} />
                  ) : (
                    <Info size={13} />
                  )}{" "}
                  {item.report.passed ? "静态通过 · 待验收" : "校验未通过"}
                </span>
                <time
                  dateTime={item.createdAt}
                  title={new Date(item.createdAt).toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                  })}
                >
                  {time(item.createdAt)}
                </time>
              </div>
              <div
                className="script-row-actions"
                aria-label={`${artifactName(item)}的操作`}
              >
                <button
                  className="script-action"
                  disabled={Boolean(action) || Boolean(removing)}
                  onClick={() => setRenaming(item)}
                >
                  <PencilLine size={15} />
                  重命名
                </button>
                <button
                  className="script-action"
                  disabled={busy || Boolean(action) || Boolean(removing)}
                  onClick={() => void run(item, "copy")}
                >
                  {action?.id === item.id && action.kind === "copy" ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Copy size={15} />
                  )}
                  复制为新策略
                </button>
                <button
                  className="script-action script-download"
                  disabled={
                    !item.report.passed || Boolean(action) || Boolean(removing)
                  }
                  title={
                    !item.report.passed ? "校验未通过，暂不可下载" : undefined
                  }
                  onClick={() => void run(item, "download")}
                >
                  {action?.id === item.id && action.kind === "download" ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Download size={15} />
                  )}
                  下载
                </button>
                <button
                  className="script-action script-delete"
                  disabled={
                    busy || loading || Boolean(action) || Boolean(removing)
                  }
                  onClick={(event) => {
                    deleteTrigger.current = event.currentTarget;
                    setRemoving(item);
                  }}
                >
                  <Trash2 size={15} />
                  删除
                </button>
              </div>
              {failure?.id === item.id && (
                <div className="script-row-error" role="alert">
                  <Info size={16} />
                  <span>{failure.message}</span>
                  <button
                    className="text-button"
                    onClick={() => void run(item, failure.kind)}
                  >
                    重试
                  </button>
                  <button
                    className="icon-button"
                    aria-label="关闭操作错误"
                    onClick={() => setFailure(undefined)}
                  >
                    <X size={15} />
                  </button>
                </div>
              )}
              {downloadedId === item.id && (
                <div className="script-import-next">
                  <CheckCircle2 size={16} />
                  <span>下载已发起，接下来可在电脑端载入 QMT。</span>
                  <button
                    className="text-button"
                    onClick={() => onImport(item.id)}
                  >
                    查看导入步骤
                    <ChevronRight size={15} />
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state panel">
          {items.length ? (
            <SlidersHorizontal size={36} />
          ) : (
            <FolderOpen size={38} />
          )}
          <h2>
            {items.length ? "没有符合条件的脚本" : "您的第一个策略，从这里开始"}
          </h2>
          <p>
            {items.length
              ? "当前组合没有匹配结果。可以清空关键词，或重新选择策略类型和状态。"
              : "先选一个模板体验完整流程，也可以直接描述您的买卖条件。"}
          </p>
          {!items.length && (
            <ol className="library-empty-steps">
              <li>选择模板</li>
              <li>核对规则</li>
              <li>生成并导入 QMT</li>
            </ol>
          )}
          <div className="library-empty-actions">
            <button
              className="primary-button"
              disabled={!items.length && busy}
              onClick={
                items.length ? () => setFilters(defaultFilters) : onTemplate
              }
            >
              {items.length ? "清除全部筛选" : "从模板开始"}
            </button>
            {items.length ? (
              filters.query && (
                <button
                  className="secondary-button"
                  onClick={() =>
                    setFilters((current) => ({ ...current, query: "" }))
                  }
                >
                  仅清空关键词
                </button>
              )
            ) : (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={onResume}
              >
                描述我的策略
              </button>
            )}
          </div>
        </div>
      )}
      {renaming && (
        <RenameDialog
          key={renaming.id}
          item={renaming}
          onClose={() => setRenaming(undefined)}
          onSaved={(item) => {
            onRenamed(item);
            setRenaming(undefined);
            onNotice("脚本名称已更新");
          }}
        />
      )}
      {removing && (
        <DeleteScriptDialog
          item={removing}
          returnFocus={deleteTrigger}
          onClose={() => setRemoving(undefined)}
          onDeleted={(id) => {
            const index = visible.findIndex((item) => item.id === id);
            onDeleted(id);
            setRemoving(undefined);
            setDownloadedId((current) =>
              current === id ? undefined : current,
            );
            onNotice("脚本已删除");
            requestAnimationFrame(() => {
              const rows =
                document.querySelectorAll<HTMLButtonElement>(
                  ".script-row-main",
                );
              const target =
                rows[Math.min(Math.max(index, 0), rows.length - 1)] ||
                document.querySelector<HTMLInputElement>(
                  '[aria-label="搜索脚本"]',
                );
              target?.focus();
            });
          }}
        />
      )}
    </>
  );
}

function RenameDialog({
  item,
  onClose,
  onSaved,
}: {
  item: ArtifactSummary;
  onClose: () => void;
  onSaved: (item: ArtifactSummary) => void;
}) {
  const [name, setName] = useState(artifactName(item));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLFormElement>(null);
  const pending = useRef(false);
  const original = artifactName(item);
  const changed = name.trim() !== original;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    input.current?.select();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending.current) onClose();
      if (event.key === "Tab") {
        const controls = [
          ...(dialog.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled)",
          ) || []),
        ];
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", key);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    const result = scriptNameSchema.safeParse(name);
    if (!result.success) {
      setError(result.error.issues[0].message);
      input.current?.focus();
      return;
    }
    if (!changed) {
      onClose();
      return;
    }
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const updated = await api<ArtifactSummary>(
        `/artifacts/${item.id}/rename`,
        { method: "POST", body: JSON.stringify({ name: result.data }) },
      );
      onSaved(updated);
    } catch (error) {
      setError(
        error instanceof ApiError
          ? error.fields.name || error.message
          : "重命名未完成，您的输入已保留，请重试。",
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
        className="modal rename-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-title"
        onSubmit={submit}
        noValidate
      >
        <button
          className="modal-close icon-button"
          type="button"
          aria-label="关闭重命名"
          disabled={saving}
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <span className="modal-illustration">
          <PencilLine size={24} />
        </span>
        <h2 id="rename-title">重命名脚本</h2>
        <p className="modal-subtitle">
          名称用于脚本列表与下载文件名，方便您辨认和整理。
        </p>
        <label htmlFor="script-name">脚本名称</label>
        <input
          ref={input}
          id="script-name"
          value={name}
          maxLength={60}
          disabled={saving}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "rename-error" : "rename-hint"}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
        />
        <p className="rename-hint" id="rename-hint">
          {item.spec.symbol} · {kindLabels[item.spec.kind]}
          <span>{name.length} / 60</span>
        </p>
        {error && (
          <p className="field-error" id="rename-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={saving}
            onClick={onClose}
          >
            取消
          </button>
          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <CheckCircle2 size={16} />
            )}{" "}
            {saving ? "正在保存…" : "保存名称"}
          </button>
        </div>
      </form>
    </div>
  );
}
