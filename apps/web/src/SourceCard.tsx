import { ArrowUpRight, BookOpen } from "lucide-react";
import type { Source } from "@qmt/shared";

export function SourceCard({ source }: { source: Source }) {
  return (
    <article className="source-card">
      <span className="square-icon"><BookOpen size={19} /></span>
      <div>
        <span className="source-official">{source.citationKind === "ai" ? "AI 已引用正文" : source.chunkId ? "模板章节依据" : "官方正文目录"}</span>
        <a href={source.url} target="_blank" rel="noreferrer" className="source-title-link">
          <h3>{source.title}</h3><ArrowUpRight size={16} />
        </a>
        <span className="source-section">{source.section}</span>
        <p>{source.summary}</p>
        {source.excerpt && <blockquote className="source-excerpt">{source.excerpt}</blockquote>}
        <small>{source.snapshotId ? "采集于" : "核对于"} {source.reviewedAt}</small>
        {source.chunkId && <details className="source-provenance">
          <summary>查看引用记录</summary>
          <p>片段：{source.chunkId}</p>
          <p>文档快照：{source.snapshotId}</p>
          <p>原文 SHA-256：{source.contentHash}</p>
        </details>}
      </div>
    </article>
  );
}
