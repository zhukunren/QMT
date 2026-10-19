import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { DocumentPassage, DocumentStatus, Source, StrategySpec } from "@qmt/shared";

type Page = { id: string; title: string; url: string; sectionCount: number; characters: number; contentHash: string; fetchedAt: string };
type Chunk = { id: string; pageId: string; heading: string; url: string; text: string; contentHash: string };
type Corpus = { version: number; snapshotId: string; fetchedAt: string; scope: string; discoveredPages: number; pages: Page[]; chunks: Chunk[] };
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const corpus = JSON.parse(readFileSync(new URL("../assets/qmt-docs/corpus.json", import.meta.url), "utf8")) as Corpus;
const pages = new Map(corpus.pages.map(p => [p.id, p]));
const chunks = new Map(corpus.chunks.map(c => [c.id, c]));
// Fail closed: a partial, corrupt or redirected snapshot must never become model evidence.
if (corpus.version !== 1 || corpus.pages.length < 15 || corpus.discoveredPages !== corpus.pages.length || pages.size !== corpus.pages.length || chunks.size !== corpus.chunks.length ||
    sha(corpus.pages.map(p => p.contentHash).join("\n")) !== corpus.snapshotId ||
    corpus.pages.some(p => !/^https:\/\/knowledge\.thinktrader\.net\/docs\/python\/[a-z_]+\.html$/.test(p.url)) ||
    corpus.chunks.some(c => !pages.has(c.pageId) || c.text.length > 2600 || !c.text.trim() || sha(c.text) !== c.contentHash || c.url.split("#")[0] !== pages.get(c.pageId)?.url)) {
  throw new Error("官方文档快照不完整或校验失败，请运行 npm run docs:sync 后重启服务。");
}

export const documentStatus: DocumentStatus = {
  snapshotId: corpus.snapshotId, fetchedAt: corpus.fetchedAt, scope: corpus.scope,
  discoveredPages: corpus.discoveredPages, indexedPages: pages.size,
  sectionCount: corpus.pages.reduce((n, p) => n + p.sectionCount, 0),
  chunkCount: chunks.size, characters: corpus.pages.reduce((n, p) => n + p.characters, 0),
};
export const sources: Source[] = corpus.pages.map(p => ({
  id: p.id, title: p.title, url: p.url, section: `${p.sectionCount} 个章节 · ${p.characters.toLocaleString("zh-CN")} 字正文`,
  reviewedAt: p.fetchedAt.slice(0, 10), snapshotId: corpus.snapshotId, contentHash: p.contentHash,
  summary: [...new Set(corpus.chunks.filter(c => c.pageId === p.id).map(c => c.heading.split(" > ").at(-1)))].slice(0, 5).join("；"),
}));

export function getPassage(id: string): DocumentPassage | undefined {
  const chunk = chunks.get(id);
  if (!chunk) return;
  const prefix = id.slice(0, id.lastIndexOf(":")) + ":";
  return { ...chunk, title: pages.get(chunk.pageId)!.title, snapshotId: corpus.snapshotId, fetchedAt: corpus.fetchedAt,
    relatedChunkIds: corpus.chunks.filter(c => c.id !== id && c.id.startsWith(prefix)).map(c => c.id) };
}

function terms(query: string) {
  const normalized = query.toLowerCase();
  const result = new Set(normalized.match(/[a-z][a-z0-9_]{1,}/g) || []);
  for (const run of normalized.match(/[\u4e00-\u9fff]+/g) || []) {
    if (run.length === 1) result.add(run);
    for (let i = 0; i < run.length - 1; i++) result.add(run.slice(i, i + 2));
  }
  return [...result];
}
const indexed = corpus.chunks.map(c => ({ chunk: c, heading: c.heading.toLowerCase(), text: c.text.toLowerCase(), tokens: new Set(terms(c.heading + " " + c.text)) }));
const frequencies = new Map<string, number>();
for (const entry of indexed) for (const term of entry.tokens) frequencies.set(term, (frequencies.get(term) || 0) + 1);
function containsTerm(value: string, term: string) {
  return /^[a-z]/.test(term) ? new RegExp(`(^|[^a-z0-9_])${term}([^a-z0-9_]|$)`).test(value) : value.includes(term);
}

/** Local lexical search: exact API names plus Chinese bigrams, weighted by inverse document frequency. */
export function searchDocuments(query: string, limit = 6, pageId?: string): DocumentPassage[] {
  const tokens = terms(query.slice(0, 300));
  if (!tokens.length) return [];
  const scored = indexed.filter(e => !pageId || e.chunk.pageId === pageId).map(e => {
    let score = 0;
    for (const term of tokens) {
      const weight = Math.log(1 + indexed.length / (1 + (frequencies.get(term) || 0)));
      if (containsTerm(e.heading, term)) score += weight * (e.heading.endsWith(term) ? (e.chunk.id.endsWith(":0") ? 13 : 10) : 6);
      if (containsTerm(e.text, term)) score += weight * 2 / (0.7 + e.text.length / 6000);
    }
    return { id: e.chunk.id, score };
  }).filter(e => e.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, Math.max(1, Math.min(limit, 12))).map(e => getPassage(e.id)!);
}

export function citationFor(passage: DocumentPassage, reason: string, excerpt: string, citationKind: "ai" | "template"): Source {
  const canonical = chunks.get(passage.id);
  if (passage.snapshotId !== corpus.snapshotId || !canonical || canonical.text !== passage.text || canonical.url !== passage.url || canonical.contentHash !== passage.contentHash || excerpt.length < 4 || excerpt.length > 600 || !canonical.text.includes(excerpt))
    throw new Error("官方文档引用未通过原文校验，已阻止生成。");
  return { id: passage.id, chunkId: passage.id, title: passage.title, url: passage.url,
    section: passage.heading, reviewedAt: passage.fetchedAt.slice(0, 10), summary: reason,
    excerpt, contentHash: passage.contentHash, snapshotId: passage.snapshotId, citationKind };
}

/** Dependencies actually used by all three templates, independent of model claims. */
export function templatePassages(spec: StrategySpec): DocumentPassage[] {
  const required = [
    ["do_back_test", "qmt-variable-convention"],
    ["get_market_data_ex", "qmt-data-function"],
    ["回测示例 handlebar get_bar_timetag", "qmt-start-now"],
    ["回测模型", "qmt-start-now"],
    ["GBK 编码", "qmt-start-now"],
    ["初始化函数 init", "qmt-system-function"],
    ["行情事件函数 handlebar", "qmt-system-function"],
    ...(spec.execution !== "signal" ? [
      ["综合下单函数 passorder", "qmt-trading-function"],
      ["get_trade_detail_data", "qmt-trading-function"],
      ["持仓对象 Position m_nCanUseVolume", "qmt-data-structure"],
      ["账户对象 Account m_dAvailable m_dBalance", "qmt-data-structure"],
      ["单股交易 1101", "qmt-enum-constants"],
    ] : []),
    ...(spec.execution === "live" ? [
      ["实盘模型", "qmt-start-now"],
      ["实盘示例 run_time", "qmt-start-now"],
      ["is_last_bar", "qmt-system-function"],
      ["get_full_tick", "qmt-data-function"],
      ["get_full_tick返回对象", "qmt-data-structure"],
      ["get_trading_dates", "qmt-data-function"],
      ["get_instrument_detail", "qmt-data-function"],
      ["cancel 撤销委托", "qmt-trading-function"],
      ["委托对象 Order", "qmt-data-structure"],
      ["委托状态 enum_EEntrustStatus", "qmt-enum-constants"],
      ["order_callback", "qmt-callback-function"],
      ["deal_callback", "qmt-callback-function"],
      ["account_callback set_account", "qmt-callback-function"],
      ["orderError_callback", "qmt-callback-function"],
      ["下单与回报相关", "qmt-question-answer"],
    ] : []),
  ];
  return [...new Map(required.flatMap(([query, pageId]) => {
    const hits = searchDocuments(query!, 1, pageId);
    if (!hits.length) throw new Error(`官方文档缺少模板依据：${query}`);
    // Include continuation chunks of a selected section so parameters/tables are not cut off.
    return hits.flatMap(p => corpus.chunks.filter(c => c.id.startsWith(p.id.slice(0, p.id.lastIndexOf(":")) + ":")).map(c => [c.id, getPassage(c.id)!] as const));
  })).values()];
}
export function templateSources(spec: StrategySpec): Source[] {
  const uniqueSections = new Map<string, DocumentPassage>();
  for (const p of templatePassages(spec)) if (!uniqueSections.has(p.url)) uniqueSections.set(p.url, p);
  return [...uniqueSections.values()].map(p => {
    const topic = p.heading.includes("持仓对象") ? "m_nCanUseVolume" : p.heading.includes("账户对象") ? "m_dAvailable" : p.heading.includes("get_market_data_ex") || p.heading.endsWith("回测模型") ? "subscribe" : p.heading.endsWith("示例") ? "GBK" : "";
    const index = topic ? p.text.indexOf(topic) : -1;
    let start = Math.max(0, index - 70);
    if (start) start = p.text.lastIndexOf("\n", start) + 1;
    const excerpt = p.text.slice(start, start + 320).trim();
    return citationFor(p, "固定模板所用接口与运行约定的正文依据。", excerpt, "template");
  });
}
export function mergeSources(...groups: Source[][]): Source[] {
  return [...new Map(groups.flat().map(s => [s.chunkId || s.id, s])).values()];
}
export function documentCatalog() {
  return sources.map(s => ({ pageId: s.id, title: s.title, sections: [...new Set(corpus.chunks.filter(c => c.pageId === s.id).map(c => c.heading))] }));
}
