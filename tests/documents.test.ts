import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defaultSpec, type GenerateInput } from "@qmt/shared";
import { documentStatus, sources, getPassage, searchDocuments, templateSources } from "../apps/api/src/sources.js";
import { interpretWithDocuments } from "../apps/api/src/agent.js";
import { validateCitations, type JsonRunner } from "../apps/api/src/document-retrieval.js";

const input: GenerateInput = { provider: "codex", spec: defaultSpec, prompt: "600000.SH 使用 5 日与 20 日均线金叉买入死叉卖出。" };
const market = searchDocuments("get_market_data_ex", 1, "qmt-data-function")[0]!;
const mode = searchDocuments("do_back_test", 1, "qmt-variable-convention")[0]!;
const response = () => ({ supported: true, reason: "", assumptions: [], spec: defaultSpec,
  citations: [market, mode].map(p => ({ chunkId: p.id, quote: p.text.slice(0, 30), reason: "核对该接口的运行参数和返回约定。" })),
});

describe("official full-text corpus and retrieval", () => {
  it("covers the complete discovered manual with anchored original bodies and clean code", () => {
    expect(documentStatus.indexedPages).toBe(15);
    expect(documentStatus.discoveredPages).toBe(documentStatus.indexedPages);
    expect(documentStatus.sectionCount).toBeGreaterThan(300);
    expect(documentStatus.characters).toBeGreaterThan(200000);
    expect(sources.map(s => s.id)).toEqual(expect.arrayContaining(["qmt-data-structure", "qmt-callback-function", "qmt-enum-constants", "qmt-question-answer", "qmt-code-examples"]));
    expect(market.text).toContain("subscribe=True");
    expect(market.text).toContain("dividend_type");
    expect(market.text).not.toContain("1ContextInfo");
    expect(market.url).toContain("#");
    expect(market.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(market.relatedChunkIds?.length).toBeGreaterThan(0);
    expect(getPassage(market.relatedChunkIds![0]!)?.heading).toBe(market.heading);
  });
  it("retrieves Chinese topics, exact API names and field tables, respecting page filters", () => {
    expect(searchDocuments("回测撮合", 3).some(p => /回测|撮合/.test(p.text))).toBe(true);
    expect(searchDocuments("passorder", 1)[0]!.heading).toContain("综合下单函数");
    expect(searchDocuments("get_market_data_ex", 2, "qmt-data-function").every(p => p.pageId === "qmt-data-function")).toBe(true);
    expect(searchDocuments("unknown_nonexistent_api", 3)).toHaveLength(0);
    expect(searchDocuments("get_market_data_ex", 3, "qmt-no-page")).toHaveLength(0);
    const refs = templateSources({ ...defaultSpec, execution: "backtest" });
    expect(refs.some(s => s.section.includes("持仓对象 - Position"))).toBe(true);
    expect(refs.some(s => s.section.includes("账户对象 - Account"))).toBe(true);
    expect(refs.every(s => getPassage(s.chunkId!)?.text.includes(s.excerpt!))).toBe(true);
  });
  it("lets AI search, read continuation bodies, and save verified citations plus an audit trace", async () => {
    const prompts: string[] = [];
    const runner: JsonRunner = async (prompt) => {
      prompts.push(prompt);
      if (prompts.length === 1) return { queries: ["get_market_data_ex", "do_back_test"], readChunkIds: [] };
      if (prompts.length === 2) {
        expect(prompt).toContain(JSON.stringify(market.text.slice(0, 20)).slice(1, -1));
        return { queries: [], readChunkIds: [market.relatedChunkIds![0]!] };
      }
      expect(prompt).toContain("subscribe=True");
      expect(prompt).toContain(JSON.stringify(getPassage(market.relatedChunkIds![0]!)!.text.slice(0, 40)).slice(1, -1));
      return { ...response(), spec: { ...defaultSpec, maxPositionPct: 90, maxOrderValue: 100000 } };
    };
    const result = await interpretWithDocuments(input, runner);
    expect(prompts).toHaveLength(3);
    expect(result.sources?.filter(s => s.citationKind === "ai")).toHaveLength(2);
    expect(result.retrieval?.queries).toContain(`read:${market.relatedChunkIds![0]}`);
    expect(result.retrieval?.snapshotId).toBe(documentStatus.snapshotId);
    expect(result.retrieval?.retrievedChunkIds).toContain(market.id);
    expect(result.spec.maxPositionPct).toBe(20);
    expect(result.spec.maxOrderValue).toBe(10000);
  });
  it("rejects fabricated or unseen citations and non-verbatim quotes", () => {
    expect(() => validateCitations([{ chunkId: "qmt-fake:0:0", quote: "不存在的原文", reason: "依据" }], [market])).toThrow("未检索");
    expect(() => validateCitations([{ chunkId: mode.id, quote: mode.text.slice(0, 12), reason: "依据" }], [market])).toThrow("未检索");
    expect(() => validateCitations([{ chunkId: market.id, quote: "完全虚构的行情接口约定", reason: "依据" }], [market])).toThrow("原文校验");
  });
  it("fails closed if AI skips retrieval, requests missing chunks, or provides insufficient evidence", async () => {
    await expect(interpretWithDocuments(input, async () => ({ queries: [], readChunkIds: [] }))).rejects.toThrow("未提出");
    await expect(interpretWithDocuments(input, async () => ({ queries: ["回测"], readChunkIds: ["qmt-fake:0:0"] }))).rejects.toThrow("不存在");
    let call = 0;
    const runner: JsonRunner = async () => ++call === 1 ? { queries: ["回测"], readChunkIds: [] } : call === 2 ? { queries: [], readChunkIds: [] } : { ...response(), citations: [] };
    await expect(interpretWithDocuments(input, runner)).rejects.toThrow("足够");
  });
  it("does not expand supported strategy scope just because the full manual contains live APIs", async () => {
    let call = 0;
    const runner: JsonRunner = async prompt => {
      if (++call === 1) return { queries: ["实盘 passorder"], readChunkIds: [] };
      if (call === 2) return { queries: [], readChunkIds: [] };
      expect(prompt).toContain("文档中存在相关接口不代表系统支持");
      return { ...response(), supported: false, reason: "暂不支持实盘、网格和止损。", citations: [] };
    };
    await expect(interpretWithDocuments({ ...input, prompt: "生成实盘网格和止损" }, runner)).rejects.toThrow("暂不支持实盘");
  });
  it("parses official HTML without gutters and preserves the existing snapshot on sync failure", () => {
    const result = spawnSync(process.env.PYTHON_PATH || "python", ["-X", "utf8", "-I", fileURLToPath(new URL("./docs_sync_cases.py", import.meta.url))], { encoding: "utf8", windowsHide: true, timeout: 10000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});
