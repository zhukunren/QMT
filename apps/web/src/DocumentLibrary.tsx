import { useEffect, useRef, useState, type FormEvent } from "react";
import { BookOpen, LoaderCircle, Search } from "lucide-react";
import type { DocumentPassage, DocumentStatus, Source } from "@qmt/shared";
import { api } from "./api";
import { SourceCard } from "./SourceCard";

export function DocumentLibrary({ sources }: { sources: Source[] }) {
  const [status, setStatus] = useState<DocumentStatus>();
  const [statusError, setStatusError] = useState("");
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [pageId, setPageId] = useState("");
  const [passages, setPassages] = useState<DocumentPassage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setStatusError("");
    void api<DocumentStatus>("/documents/status", { signal: controller.signal })
      .then(setStatus)
      .catch((e) => {
        if (!controller.signal.aborted)
          setStatusError(e instanceof Error ? e.message : "文档状态加载失败。");
      });
    return () => {
      controller.abort();
      pending.current?.abort();
    };
  }, [revision]);

  async function search(event?: FormEvent, keyword = query, scope = pageId) {
    event?.preventDefault();
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setPassages([]);
    setSearched("");
    try {
      const params = new URLSearchParams({
        q: keyword.trim(),
        limit: "8",
        ...(scope ? { pageId: scope } : {}),
      });
      const result = await api<
        DocumentStatus & { passages: DocumentPassage[] }
      >(`/documents/search?${params}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setStatus(result);
      setPassages(result.passages);
      setSearched(keyword.trim());
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "正文检索失败，请重试。");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function read(id: string) {
    if (busy) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      const passage = await api<DocumentPassage>(
        `/documents/chunks/${encodeURIComponent(id)}`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted)
        setPassages((current) =>
          current.some((p) => p.id === id) ? current : [...current, passage],
        );
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "章节读取失败。");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <>
      <div className="docs-banner">
        <BookOpen size={23} />
        <div>
          <h2>迅投内置 Python 官方正文库</h2>
          {status ? (
            <p className="document-status-meta">
              已收录 {status.indexedPages} / {status.discoveredPages} 个页面、
              {status.sectionCount} 个章节，共约{" "}
              {Math.round(status.characters / 10000)} 万字。采集日期：
              {status.fetchedAt.slice(0, 10)}。
            </p>
          ) : (
            <p>正在加载文档收录状态…</p>
          )}
          <p>AI 根据策略需求检索正文并引用具体章节；客户端兼容性仍需验收。</p>
          {statusError && (
            <p role="alert">
              {statusError}{" "}
              <button
                className="text-button"
                onClick={() => setRevision((n) => n + 1)}
              >
                重新加载
              </button>
            </p>
          )}
        </div>
      </div>
      <section className="panel document-search" aria-label="官方文档正文检索">
        <h2>检索章节正文</h2>
        <p>输入接口名称或问题，例如 get_market_data_ex、回测撮合、可用持仓。</p>
        <form
          onSubmit={(event) => void search(event)}
          className="document-search-form"
        >
          <label className="document-keyword">
            <span>文档关键词</span>
            <span className="search-input">
              <Search size={17} />
              <input
                aria-label="文档关键词"
                placeholder="输入接口名称或中文关键词"
                required
                minLength={2}
                maxLength={300}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </span>
          </label>
          <label className="document-range">
            <span>文档范围</span>
            <select
              aria-label="文档范围"
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
            >
              <option value="">全部文档</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Search size={16} />
            )}
            检索正文
          </button>
        </form>
        <span className="document-topics-label">常用专题</span>
        <nav className="document-topics" aria-label="实盘官方文档专题">
          {[
            ["实盘运行", "实盘模型", "qmt-start-now"],
            ["下单与撤单", "passorder cancel", "qmt-trading-function"],
            ["委托状态", "enum_EEntrustStatus", "qmt-enum-constants"],
            ["委托回报", "order_callback", "qmt-callback-function"],
            ["成交回报", "deal_callback", "qmt-callback-function"],
            ["账户和资金", "账户对象", "qmt-data-structure"],
            ["实时行情", "get_full_tick", "qmt-data-function"],
          ].map(([title, keyword, scope]) => (
            <button
              key={title}
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                setQuery(keyword!);
                setPageId(scope!);
                void search(undefined, keyword, scope);
              }}
            >
              {title}
            </button>
          ))}
        </nav>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        {searched && (
          <p role="status" className="document-result-summary">
            “{searched}”找到 {passages.length} 个正文片段
            {passages.length
              ? "，展开查看原文。"
              : "。请尝试具体接口名或缩短关键词。"}
          </p>
        )}
        <div className="document-passages">
          {passages.map((p, i) => (
            <details className="document-passage" key={p.id} open={i === 0}>
              <summary>{p.heading}</summary>
              <p className="document-passage-meta">
                {p.title} · 片段 {p.id} · 采集于 {p.fetchedAt.slice(0, 10)}
              </p>
              <pre tabIndex={0} aria-label={`${p.heading} · 章节正文`}>
                {p.text}
              </pre>
              <div className="document-passage-actions">
                <a href={p.url} target="_blank" rel="noreferrer">
                  在官网打开本章节 ↗
                </a>
                {p.relatedChunkIds
                  ?.filter((id) => !passages.some((item) => item.id === id))
                  .map((id) => (
                    <button
                      type="button"
                      key={id}
                      className="text-button"
                      disabled={busy}
                      onClick={() => void read(id)}
                    >
                      阅读同章节片段 {Number(id.split(":").at(-1)) + 1}
                    </button>
                  ))}
              </div>
            </details>
          ))}
        </div>
      </section>
      <h2 className="document-catalog-title">全部文档目录</h2>
      <div className="docs-grid">
        {sources.map((source) => (
          <SourceCard key={source.id} source={source} />
        ))}
      </div>
      {status && <p className="document-scope">收录范围：{status.scope}</p>}
    </>
  );
}
