import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Copy,
  Download,
  FileCode2,
  FileText,
  FolderOpen,
  Info,
  Layers3,
  LoaderCircle,
  Menu,
  Plus,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import {
  defaultSpec,
  artifactName,
  kindLabels,
  specSchema,
  specErrors,
  strategyRules,
  executionLabels,
  type Artifact,
  type ArtifactSummary,
  type Health,
  type Job,
  type Plan,
  type Source,
  type StrategySpec,
  type SpecErrors,
} from "@qmt/shared";
import { api, ApiError, download, setAccessToken } from "./api";
import { PlanReview } from "./PlanReview";
import { TaskProgress } from "./TaskProgress";
import { runGeneration } from "./generation";
import { DocumentLibrary } from "./DocumentLibrary";
import { SourceCard } from "./SourceCard";
import { ScriptLibrary } from "./ScriptLibrary";
import { copyName } from "./library";
import { TemplatePicker, FirstRunGuide } from "./TemplatePicker";
import { ImportGuide } from "./ImportGuide";
import {
  strategyTemplates,
  templateSpec,
  templateDescription,
  importProgressKey,
} from "./onboarding";
import { useDialogFocus } from "./useDialogFocus";

type Page = "create" | "task" | "result" | "library" | "docs" | "guide";
type Provider = "codex" | "template";
type Draft = { prompt: string; spec: StrategySpec; advanced: boolean };
const newDrafts = (): Record<Provider, Draft> => ({
  codex: { prompt: "", spec: { ...defaultSpec }, advanced: false },
  template: { prompt: "", spec: { ...defaultSpec }, advanced: true },
});
type HistoryItem = ArtifactSummary;
const steps = ["描述想法", "确认策略", "生成脚本", "查看与下载"];
function time(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function App() {
  const [page, setPage] = useState<Page>("create");
  const [health, setHealth] = useState<Health>();
  const [healthLoading, setHealthLoading] = useState(true);
  const [connectionError, setConnectionError] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [drafts, setDrafts] = useState(newDrafts);
  const [provider, setProvider] = useState<Provider>("codex");
  const { prompt, spec, advanced } = drafts[provider];
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState("");
  const [plan, setPlan] = useState<Plan>();
  const [generationPlan, setGenerationPlan] = useState<Plan>();
  const [flowError, setFlowError] = useState<ApiError>();
  const [phase, setPhase] = useState<"understand" | "generate">("understand");
  const [startedAt, setStartedAt] = useState<number>();
  const [inputErrors, setInputErrors] = useState<
    SpecErrors & { prompt?: string }
  >({});
  const [artifact, setArtifact] = useState<Artifact>();
  const [resultTab, setResultTab] = useState<
    "explain" | "code" | "checks" | "sources"
  >("explain");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [errorRetry, setErrorRetry] = useState<() => void>();
  const [downloading, setDownloading] = useState<"script" | "report">();
  const [settings, setSettings] = useState(false);
  const [token, setToken] = useState("");
  const [mobile, setMobile] = useState(false);
  const [mobileLayout, setMobileLayout] = useState(
    () => window.matchMedia("(max-width: 800px)").matches,
  );
  const [templateChoice, setTemplateChoice] = useState<StrategySpec["kind"]>();
  const [guideId, setGuideId] = useState<string>();
  const [lastDownloadedId, setLastDownloadedId] = useState<string>();
  const [copySource, setCopySource] = useState("");
  const [job, setJob] = useState<Job>();
  const abortPoll = useRef(false);
  const operation = useRef(false);
  const generationRequest = useRef("");
  const resultRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  useDialogFocus(
    sidebarRef,
    mobile && mobileLayout,
    () => setMobile(false),
    mobileTriggerRef,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 800px)");
    const update = () => {
      setMobileLayout(media.matches);
      if (!media.matches) setMobile(false);
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  function updateDraft(update: Partial<Draft>, mode: Provider = provider) {
    setDrafts((current) => ({
      ...current,
      [mode]: { ...current[mode], ...update },
    }));
  }
  function setAdvanced(value: boolean) {
    updateDraft({ advanced: value });
  }
  function switchProvider(next: Provider) {
    setProvider(next);
    setPlan(undefined);
    setError("");
    setInputErrors({});
    setFlowError(undefined);
  }
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    if (page === "result") resultRef.current?.focus({ preventScroll: true });
  }, [page, artifact?.id]);

  const refresh = async () => {
    setHealthLoading(true);
    const responses = await Promise.allSettled([
      api<Health>("/health"),
      api<HistoryItem[]>("/artifacts"),
      api<Source[]>("/sources"),
    ]);
    if (responses[0].status === "fulfilled") {
      setHealth(responses[0].value);
      setConnectionError("");
    } else {
      setHealth(undefined);
      setConnectionError("暂时无法连接服务，请确认后端已启动后重新连接。");
    }
    if (responses[1].status === "fulfilled") setHistory(responses[1].value);
    else if (responses[1].reason instanceof Error) {
      setConnectionError(responses[1].reason.message);
    }
    if (responses[2].status === "fulfilled") setSources(responses[2].value);
    setHealthLoading(false);
  };
  useEffect(() => {
    abortPoll.current = false;
    void refresh();
    return () => {
      abortPoll.current = true;
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    if (!plan && !settings) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href], [tabindex="0"]',
        ) || [],
      );
    focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const items = focusable();
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
      if (event.key === "Escape") {
        dialog
          ?.querySelector<HTMLButtonElement>(
            'button[aria-label="关闭策略确认"], button[aria-label="关闭设置"]',
          )
          ?.click();
      }
    };
    document.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [Boolean(plan), settings]);

  function nav(next: Page) {
    setPage(next);
    setMobile(false);
    setError("");
    setErrorRetry(undefined);
  }
  function reset() {
    setCopySource("");
    setArtifact(undefined);
    setPlan(undefined);
    setJob(undefined);
    setGenerationPlan(undefined);
    setFlowError(undefined);
    setInputErrors({});
    generationRequest.current = "";
    setDrafts(newDrafts());
    setProvider("codex");
    nav("create");
    setTimeout(() => promptRef.current?.focus(), 0);
  }
  function openTemplatePicker(kind: StrategySpec["kind"] = spec.kind) {
    if (!busy) setTemplateChoice(kind);
  }
  function useTemplate(kind: StrategySpec["kind"], manual = false) {
    const nextSpec = templateSpec(spec, kind);
    const mode = manual ? "template" : "codex";
    updateDraft(
      {
        spec: nextSpec,
        prompt: manual ? "" : templateDescription(nextSpec),
        advanced: manual,
      },
      mode,
    );
    setTemplateChoice(undefined);
    setCopySource("");
    setProvider(mode);
    setFlowError(undefined);
    setInputErrors({});
    setArtifact(undefined);
    setPlan(undefined);
    setJob(undefined);
    setGenerationPlan(undefined);
    generationRequest.current = "";
    setPhase("understand");
    nav("create");
    if (!manual) setTimeout(() => promptRef.current?.focus(), 0);
  }
  function openImportGuide(id?: string) {
    setGuideId(id || artifact?.id);
    nav("guide");
  }
  function resumeDescription() {
    switchProvider("codex");
    nav("create");
  }
  async function copyArtifact(
    id: string,
    execution?: StrategySpec["execution"],
  ) {
    if (busy) return;
    const source =
      artifact?.id === id ? artifact : await api<Artifact>(`/artifacts/${id}`);
    const name = copyName(source, history);
    updateDraft(
      {
        prompt: "",
        spec: {
          ...source.spec,
          name,
          execution: execution || source.spec.execution,
        },
        advanced: true,
      },
      "template",
    );
    setProvider("template");
    setCopySource(artifactName(source));
    setArtifact(undefined);
    setPlan(undefined);
    setJob(undefined);
    setGenerationPlan(undefined);
    setFlowError(undefined);
    setInputErrors({});
    generationRequest.current = "";
    setPhase("understand");
    nav("create");
    setNotice("已复制策略参数，调整并确认后即可生成新脚本。");
  }
  function onRenamed(updated: ArtifactSummary) {
    setHistory((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
    setArtifact((current) =>
      current?.id === updated.id ? { ...current, ...updated } : current,
    );
  }
  function onDeleted(id: string) {
    setHistory((current) => current.filter((item) => item.id !== id));
    setArtifact((current) => (current?.id === id ? undefined : current));
    setGuideId((current) => (current === id ? undefined : current));
    setLastDownloadedId((current) => (current === id ? undefined : current));
    if (job?.artifactId === id) {
      setJob(undefined);
      setGenerationPlan(undefined);
      generationRequest.current = "";
    }
    try {
      localStorage.removeItem(importProgressKey(id));
    } catch {
      /* Optional local guide progress. */
    }
    void refresh();
  }
  async function copyFromResult(
    id: string,
    execution?: StrategySpec["execution"],
  ) {
    try {
      await copyArtifact(id, execution);
    } catch (error) {
      setError(error instanceof Error ? error.message : "复制未完成，请重试。");
      setErrorRetry(() => () => void copyFromResult(id, execution));
    }
  }
  async function understand(event?: FormEvent) {
    event?.preventDefault();
    if (operation.current) return;
    setError("");
    setFlowError(undefined);
    const fields: SpecErrors & { prompt?: string } = specErrors(spec);
    if (provider === "codex" && prompt.trim().length < 5)
      fields.prompt = "请描述何时买入、何时卖出，至少填写 5 个字。";
    setInputErrors(fields);
    if (Object.keys(fields).length) {
      const first = fields.prompt ? "prompt" : Object.keys(fields)[0];
      if (first !== "prompt") setAdvanced(true);
      requestAnimationFrame(() =>
        document.getElementById(`draft-${first}`)?.focus(),
      );
      return;
    }
    operation.current = true;
    setArtifact(undefined);
    setJob(undefined);
    setGenerationPlan(undefined);
    setPhase("understand");
    setStartedAt(Date.now());
    setBusy(true);
    setBusyText(
      provider === "codex"
        ? "正在检索官方正文并理解策略…"
        : "正在整理模板规则…",
    );
    try {
      const understood = await api<Plan>("/plans", {
        method: "POST",
        timeoutMs: 130000,
        body: JSON.stringify({
          prompt: provider === "template" ? "" : prompt,
          provider,
          spec: specSchema.parse(spec),
        }),
      });
      nav("create");
      setPlan(understood);
    } catch (error) {
      const failure =
        error instanceof ApiError
          ? error
          : new ApiError("策略理解未完成，请稍后重试。");
      setFlowError(failure);
      if (Object.keys(failure.fields).length) {
        setInputErrors(failure.fields);
        setAdvanced(true);
      }
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  async function generate(confirmed = generationPlan, restart = false) {
    if (!confirmed || operation.current) return;
    operation.current = true;
    setPhase("generate");
    setStartedAt(Date.now());
    setBusy(true);
    setBusyText("正在生成并检查脚本…");
    setFlowError(undefined);
    abortPoll.current = false;
    if (restart || !generationRequest.current)
      generationRequest.current = crypto.randomUUID();
    const existingJob = restart ? undefined : job;
    if (restart) setJob(undefined);
    nav("task");
    try {
      const output = await runGeneration({
        planId: confirmed.id,
        requestId: generationRequest.current,
        existingJob,
        onJob: setJob,
        cancelled: () => abortPoll.current,
      });
      setArtifact(output);
      setResultTab(output.report.passed ? "explain" : "checks");
      nav("result");
      await refresh();
    } catch (error) {
      if (!abortPoll.current)
        setFlowError(
          error instanceof ApiError
            ? error
            : new ApiError("生成暂时中断，已保留当前规则。"),
        );
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  function acceptReview(reviewed: Plan) {
    setPlan(undefined);
    setGenerationPlan(reviewed);
    updateDraft({ spec: reviewed.spec }, reviewed.provider);
    void generate(reviewed, true);
  }
  function backFromReview(nextSpec: StrategySpec) {
    if (plan) updateDraft({ spec: nextSpec, advanced: true }, plan.provider);
    setFlowError(undefined);
    setInputErrors({});
    setPlan(undefined);
    nav("create");
  }
  function reopenReview() {
    if (flowError?.code === "PLAN_MISSING") {
      setFlowError(undefined);
      nav("create");
      return;
    }
    if (generationPlan) {
      nav("create");
      setPlan(generationPlan);
    }
  }
  async function openArtifact(
    id: string,
    tab: "explain" | "code" | "checks" = "explain",
  ) {
    try {
      setArtifact(await api<Artifact>(`/artifacts/${id}`));
      setResultTab(tab);
      nav("result");
    } catch (e) {
      setError((e as Error).message);
      setErrorRetry(() => () => void openArtifact(id));
    }
  }
  async function saveDownload(report = false) {
    if (!artifact || downloading) return;
    setDownloading(report ? "report" : "script");
    setError("");
    setErrorRetry(undefined);
    try {
      await download(artifact.id, report);
      if (!report) setLastDownloadedId(artifact.id);
      setNotice(
        report ? "PDF 校验报告已下载" : "Python 脚本已下载，请按指引导入 QMT",
      );
    } catch (e) {
      setError((e as Error).message);
      setErrorRetry(() => () => void saveDownload(report));
    } finally {
      setDownloading(undefined);
    }
  }
  function field<K extends keyof StrategySpec>(key: K, value: StrategySpec[K]) {
    setInputErrors((current) =>
      key === "kind"
        ? {
            ...current,
            kind: undefined,
            fastWindow: undefined,
            slowWindow: undefined,
            threshold: undefined,
          }
        : { ...current, [key]: undefined },
    );
    if (phase === "understand") setFlowError(undefined);
    setDrafts((current) => ({
      ...current,
      [provider]: {
        ...current[provider],
        spec:
          key === "kind"
            ? templateSpec(
                current[provider].spec,
                value as StrategySpec["kind"],
              )
            : { ...current[provider].spec, [key]: value },
      },
    }));
  }
  const progress = busy && job ? 2 : plan ? 1 : 0;
  const navs = [
    { id: "create" as Page, icon: WandSparkles, name: "创建策略" },
    { id: "library" as Page, icon: FolderOpen, name: "我的脚本" },
    { id: "docs" as Page, icon: BookOpen, name: "官方文档" },
    { id: "guide" as Page, icon: CircleHelp, name: "使用指南" },
  ];

  return (
    <div className="app-shell">
      {mobile && mobileLayout && (
        <button
          className="sidebar-shade"
          aria-label="关闭导航遮罩"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        id="workspace-nav"
        className={`sidebar ${mobile && mobileLayout ? "mobile-open" : ""}`}
        role={mobile && mobileLayout ? "dialog" : undefined}
        aria-modal={mobile && mobileLayout ? true : undefined}
        aria-label="工作空间导航"
        aria-hidden={mobileLayout && !mobile ? true : undefined}
        inert={mobileLayout && !mobile}
      >
        <button
          className="icon-button drawer-close"
          aria-label="关闭导航"
          onClick={() => setMobile(false)}
        >
          <X size={20} />
        </button>
        <div className="brand">
          <img src="/dongwu-logo.png" alt="东吴证券 SOOCHOW SECURITIES" />
          <span className="brand-divider" />
          <span className="brand-product">量化服务平台</span>
        </div>
        <button className="new-button" onClick={reset} disabled={busy}>
          <Plus size={17} /> 新建策略 <span>NEW</span>
        </button>
        <div className="nav-group-label">工作空间</div>
        <nav aria-label="主导航">
          {navs.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id || (page === "task" && item.id === "create") || (page === "result" && item.id === "library") ? "active" : ""}`}
              aria-current={
                page === item.id ||
                (page === "task" && item.id === "create") ||
                (page === "result" && item.id === "library")
                  ? "page"
                  : undefined
              }
              onClick={() => nav(item.id)}
            >
              <item.icon size={19} />
              {item.name}
              {item.id === "library" && history.length > 0 && (
                <span className="nav-count">{history.length}</span>
              )}
              {(page === item.id ||
                (page === "result" && item.id === "library")) && (
                <span className="nav-active-dot" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-recents">
          <div className="nav-group-label">
            最近的策略 <Clock3 size={13} />
          </div>
          {history.length ? (
            history.slice(0, 4).map((item) => (
              <button key={item.id} onClick={() => void openArtifact(item.id)}>
                <FileText size={15} />
                <span className="recent-info">
                  <strong>{artifactName(item)}</strong>
                  <small>
                    <span>{item.spec.symbol}</span>
                    <time dateTime={item.createdAt}>
                      {time(item.createdAt)}
                    </time>
                  </small>
                </span>
              </button>
            ))
          ) : (
            <p>
              您的策略会保存在这里
              <br />
              <span>从一个投资想法开始吧</span>
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="secure-note">
            <ShieldCheck size={21} />
            <div>
              为每个想法，多一层审慎<span>官方文档参考 · 生成过程可追溯</span>
            </div>
          </div>
          <button
            className="nav-item"
            onClick={() => {
              setMobile(false);
              setSettings(true);
            }}
          >
            <Settings2 size={18} />
            连接设置
            <span className={`connection-dot ${health ? "online" : ""}`} />
          </button>
          <div className="sidebar-profile">
            <span className="avatar">研</span>
            <div>
              个人研究工作台<span>QMT 策略工坊</span>
            </div>
            <span className="preview-tag">预览版</span>
          </div>
        </div>
      </aside>
      <div
        className="main-shell"
        inert={mobile && mobileLayout}
        aria-hidden={mobile && mobileLayout ? true : undefined}
      >
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-toggle icon-button"
              ref={mobileTriggerRef}
              aria-label="打开导航"
              aria-expanded={mobile && mobileLayout}
              aria-controls="workspace-nav"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <span>量化工具</span>
            <ChevronRight size={14} />
            <strong>QMT 策略工坊</strong>
          </div>
          <div className="topbar-right">
            {(busy || flowError) &&
              page !== (phase === "generate" ? "task" : "create") && (
                <button
                  className="active-task-link"
                  onClick={() => nav(phase === "generate" ? "task" : "create")}
                >
                  <Clock3 size={15} />
                  查看处理进度
                </button>
              )}
            <span className="environment">
              <i />
              研究与回测环境
            </span>
            <span className="top-divider" />
            <button onClick={() => nav("guide")}>
              <CircleHelp size={17} />
              使用帮助
            </button>
            <span className="top-avatar">研</span>
          </div>
        </header>
        <main className={`page-${page}`}>
          {error && (
            <div className="error-banner" role="alert">
              <Info size={18} />
              <span>{error}</span>
              {errorRetry && (
                <button
                  className="text-button error-retry"
                  onClick={errorRetry}
                >
                  重试
                </button>
              )}
              <button aria-label="关闭错误" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {page === "create" && (
            <>
              <section className="welcome">
                <div className="welcome-copy">
                  <h1>创建策略</h1>
                  <div className="welcome-caption">
                    <p>描述买卖条件，确认规则后生成 QMT 脚本。</p>
                    <div className="welcome-links">
                      <button
                        type="button"
                        className="reference-link"
                        onClick={() => nav("docs")}
                      >
                        <BookOpen size={15} />
                        查看参考文档
                        <ArrowUpRight size={14} />
                      </button>
                      <details className="scope-help">
                        <summary>
                          <Info size={15} />
                          支持范围
                          <ChevronDown size={14} />
                        </summary>
                        <div className="scope-popover">
                          <h2>当前支持</h2>
                          <p>沪深主板普通 A 股 · 单只股票 · 日线</p>
                          <p>
                            双均线、动量、均值回归；支持信号、历史回测与实盘脚本。
                          </p>
                          <p>
                            实盘须在 QMT
                            本地配置启用并完成模拟柜台验收。暂不支持
                            MiniQMT、止损止盈、网格或多股票。
                          </p>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => nav("docs")}
                          >
                            官方文档
                            <ArrowUpRight size={14} />
                          </button>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => nav("guide")}
                          >
                            使用指南
                            <ArrowUpRight size={14} />
                          </button>
                        </div>
                      </details>
                    </div>
                  </div>
                </div>
                <div className="welcome-art" aria-hidden="true">
                  <div className="art-sheet">
                    <div className="art-sheet-top">
                      <span />
                      <span />
                      <span />
                    </div>
                    <svg viewBox="0 0 180 66">
                      <path
                        d="M0 50H180M0 25H180M30 0V66M75 0V66M120 0V66M165 0V66"
                        stroke="#e6edf7"
                        fill="none"
                      />
                      <path
                        d="M0 56L18 43L32 48L51 29L69 37L88 25L105 30L125 9L142 18L163 3L180 9"
                        stroke="#3978ce"
                        strokeWidth="2.5"
                        fill="none"
                      />
                      <path
                        d="M0 46Q45 49 83 35T180 18"
                        stroke="#9ebce6"
                        strokeWidth="2"
                        fill="none"
                        strokeDasharray="4 4"
                      />
                    </svg>
                  </div>
                  <span className="art-badge">
                    <Sparkles size={17} />
                  </span>
                </div>
              </section>
              <div className="workflow" aria-label="创建流程">
                {steps.map((s, i) => (
                  <div
                    key={s}
                    className={`workflow-step ${i === progress ? "current" : ""} ${i < progress ? "complete" : ""}`}
                  >
                    <span>
                      {i < progress ? (
                        <Check size={13} />
                      ) : (
                        String(i + 1).padStart(2, "0")
                      )}
                    </span>
                    <strong>{s}</strong>
                    {i < 3 && <div className="step-line" />}
                  </div>
                ))}
              </div>
              <div className="workspace-grid">
                <div className="workspace-primary">
                  <section className="composer panel" aria-label="创建策略">
                    <form onSubmit={understand} noValidate>
                      <div className="create-entry">
                        <div className="composer-mode">
                          <div
                            className="provider-picker"
                            role="group"
                            aria-label="创建方式"
                          >
                            <button
                              type="button"
                              aria-pressed={provider === "codex"}
                              className={provider === "codex" ? "selected" : ""}
                              onClick={() => switchProvider("codex")}
                              disabled={busy}
                            >
                              <Sparkles size={16} /> 智能理解
                            </button>
                            <button
                              type="button"
                              aria-pressed={provider === "template"}
                              className={
                                provider === "template" ? "selected" : ""
                              }
                              onClick={() => switchProvider("template")}
                              disabled={busy}
                            >
                              <Layers3 size={16} /> 模板体验
                            </button>
                          </div>
                        </div>
                        <div
                          className={`prompt-container ${provider === "template" ? "template-mode" : ""}`}
                        >
                          {provider === "template" ? (
                            <div className="template-description">
                              <h3>{kindLabels[spec.kind]}</h3>
                              {copySource && (
                                <p className="copy-source">
                                  来自：{copySource}
                                </p>
                              )}
                              <p>
                                <span className="rule-label">买入</span>
                                {strategyRules(spec).buy}
                              </p>
                              <p>
                                <span className="rule-label">卖出</span>
                                {strategyRules(spec).sell}
                              </p>
                            </div>
                          ) : (
                            <textarea
                              ref={promptRef}
                              id="draft-prompt"
                              aria-invalid={Boolean(inputErrors.prompt)}
                              aria-describedby={
                                inputErrors.prompt
                                  ? "draft-prompt-error"
                                  : undefined
                              }
                              aria-label="策略想法"
                              placeholder={
                                "例如：600000.SH，5 日均线上穿 20 日均线买入，下穿卖出。\n单笔最多 1 万元，仓位不超过 20%。"
                              }
                              value={prompt}
                              onChange={(e) => {
                                updateDraft({ prompt: e.target.value });
                                setInputErrors((current) => ({
                                  ...current,
                                  prompt: undefined,
                                }));
                                if (phase === "understand")
                                  setFlowError(undefined);
                                setPlan(undefined);
                              }}
                              maxLength={4000}
                              disabled={busy}
                            />
                          )}
                          {provider === "codex" && (
                            <div className="prompt-bottom">
                              <span>写清买卖条件与仓位</span>
                              <span>{prompt.length} / 4000</span>
                            </div>
                          )}
                        </div>
                        {inputErrors.prompt && (
                          <p
                            className="field-error"
                            role="alert"
                            id="draft-prompt-error"
                          >
                            {inputErrors.prompt}
                          </p>
                        )}
                        <section
                          className="template-section"
                          aria-label={
                            provider === "codex" ? "策略示例" : "选择策略模板"
                          }
                        >
                          <span className="example-label">
                            {provider === "codex"
                              ? "从模板里找一个想法"
                              : "比较并选择模板"}
                          </span>
                          <div className="quick-templates">
                            {strategyTemplates.map((item, i) => (
                              <button
                                key={item.kind}
                                type="button"
                                className={`quick-template ${provider === "template" && spec.kind === item.kind ? "selected" : ""}`}
                                aria-pressed={
                                  provider === "template"
                                    ? spec.kind === item.kind
                                    : undefined
                                }
                                onClick={() => openTemplatePicker(item.kind)}
                                disabled={busy}
                              >
                                {i === 0 ? (
                                  <TrendingUp size={16} />
                                ) : i === 1 ? (
                                  <Zap size={16} />
                                ) : (
                                  <Layers3 size={16} />
                                )}
                                {item.title}
                                <ArrowUpRight size={13} />
                              </button>
                            ))}
                          </div>
                        </section>
                      </div>
                      <div className="create-settings">
                        <div className="defaults-row">
                          <div className="platform-summary">
                            <span className="platform-icon">Q</span>
                            <span>QMT 内置 Python · 日线</span>
                          </div>
                          <div>
                            <label htmlFor="draft-execution">生成用途</label>

                            <select
                              id="draft-execution"
                              aria-label="生成用途"
                              value={spec.execution}
                              onChange={(e) =>
                                field(
                                  "execution",
                                  e.target.value as StrategySpec["execution"],
                                )
                              }
                              disabled={busy}
                            >
                              <option value="signal">仅查看策略信号</option>
                              <option value="backtest">
                                历史回测（虚拟下单）
                              </option>
                              <option value="live">
                                实盘交易（QMT 本地启用）
                              </option>
                            </select>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="advanced-toggle"
                          onClick={() => setAdvanced(!advanced)}
                          aria-expanded={advanced}
                          aria-controls="draft-parameters"
                          disabled={busy}
                        >
                          <SlidersHorizontal size={15} />
                          {provider === "template" ? "模板参数" : "高级设置"}
                          <span>{advanced ? "收起" : "按需调整"}</span>
                          <ChevronDown
                            size={14}
                            className={advanced ? "rotate" : ""}
                          />
                        </button>
                        {advanced && (
                          <div
                            className="advanced-fields"
                            id="draft-parameters"
                          >
                            <label>
                              策略名称
                              <input
                                id="draft-name"
                                aria-invalid={Boolean(inputErrors.name)}
                                aria-describedby={
                                  inputErrors.name
                                    ? "draft-name-error"
                                    : undefined
                                }
                                value={spec.name}
                                onChange={(e) => field("name", e.target.value)}
                                maxLength={60}
                                disabled={busy}
                              />
                              {inputErrors.name && (
                                <span
                                  className="field-error"
                                  id="draft-name-error"
                                >
                                  {inputErrors.name}
                                </span>
                              )}
                            </label>
                            <label>
                              股票代码
                              <input
                                id="draft-symbol"
                                aria-invalid={Boolean(inputErrors.symbol)}
                                aria-describedby={
                                  inputErrors.symbol
                                    ? "draft-symbol-error"
                                    : undefined
                                }
                                value={spec.symbol}
                                onChange={(e) =>
                                  field("symbol", e.target.value.toUpperCase())
                                }
                                placeholder="600000.SH"
                                disabled={busy}
                              />
                              {inputErrors.symbol && (
                                <span
                                  className="field-error"
                                  id="draft-symbol-error"
                                >
                                  {inputErrors.symbol}
                                </span>
                              )}
                            </label>
                            <label>
                              策略模板
                              <select
                                id="draft-kind"
                                aria-invalid={Boolean(inputErrors.kind)}
                                aria-describedby={
                                  inputErrors.kind
                                    ? "draft-kind-error"
                                    : undefined
                                }
                                value={spec.kind}
                                onChange={(e) =>
                                  field(
                                    "kind",
                                    e.target.value as StrategySpec["kind"],
                                  )
                                }
                                disabled={busy}
                              >
                                {Object.entries(kindLabels).map(([v, n]) => (
                                  <option key={v} value={v}>
                                    {n}
                                  </option>
                                ))}
                              </select>
                              {inputErrors.kind && (
                                <span
                                  className="field-error"
                                  id="draft-kind-error"
                                >
                                  {inputErrors.kind}
                                </span>
                              )}
                            </label>
                            {spec.kind === "ma_cross" && (
                              <label>
                                短均线（天）
                                <input
                                  aria-label="短均线周期（天）"
                                  type="number"
                                  min={2}
                                  max={120}
                                  id="draft-fastWindow"
                                  aria-invalid={Boolean(inputErrors.fastWindow)}
                                  aria-describedby={
                                    inputErrors.fastWindow
                                      ? "draft-fastWindow-error"
                                      : undefined
                                  }
                                  value={
                                    Number.isFinite(spec.fastWindow)
                                      ? spec.fastWindow
                                      : ""
                                  }
                                  onChange={(e) =>
                                    field(
                                      "fastWindow",
                                      e.target.value === ""
                                        ? NaN
                                        : Number(e.target.value),
                                    )
                                  }
                                  disabled={busy}
                                />
                                {inputErrors.fastWindow && (
                                  <span
                                    className="field-error"
                                    id="draft-fastWindow-error"
                                  >
                                    {inputErrors.fastWindow}
                                  </span>
                                )}
                              </label>
                            )}
                            <label>
                              {spec.kind === "ma_cross"
                                ? "长均线（天）"
                                : "观察周期（天）"}
                              <input
                                aria-label={
                                  spec.kind === "ma_cross"
                                    ? "长均线周期（天）"
                                    : "观察周期（天）"
                                }
                                type="number"
                                min={3}
                                max={250}
                                id="draft-slowWindow"
                                aria-invalid={Boolean(inputErrors.slowWindow)}
                                aria-describedby={
                                  inputErrors.slowWindow
                                    ? "draft-slowWindow-error"
                                    : undefined
                                }
                                value={
                                  Number.isFinite(spec.slowWindow)
                                    ? spec.slowWindow
                                    : ""
                                }
                                onChange={(e) =>
                                  field(
                                    "slowWindow",
                                    e.target.value === ""
                                      ? NaN
                                      : Number(e.target.value),
                                  )
                                }
                                disabled={busy}
                              />
                              {inputErrors.slowWindow && (
                                <span
                                  className="field-error"
                                  id="draft-slowWindow-error"
                                >
                                  {inputErrors.slowWindow}
                                </span>
                              )}
                            </label>
                            {spec.kind !== "ma_cross" && (
                              <label>
                                {spec.kind === "momentum"
                                  ? "涨跌幅阈值（%）"
                                  : "均价偏离阈值（%）"}
                                <input
                                  aria-label={
                                    spec.kind === "momentum"
                                      ? "涨跌幅阈值（%）"
                                      : "均价偏离阈值（%）"
                                  }
                                  type="number"
                                  step={0.1}
                                  min={0.1}
                                  max={30}
                                  id="draft-threshold"
                                  aria-invalid={Boolean(inputErrors.threshold)}
                                  aria-describedby={
                                    inputErrors.threshold
                                      ? "draft-threshold-error"
                                      : undefined
                                  }
                                  value={
                                    Number.isFinite(spec.threshold)
                                      ? Number(
                                          (spec.threshold * 100).toFixed(8),
                                        )
                                      : ""
                                  }
                                  onChange={(e) =>
                                    field(
                                      "threshold",
                                      (e.target.value === ""
                                        ? NaN
                                        : Number(e.target.value)) / 100,
                                    )
                                  }
                                  disabled={busy}
                                />
                                {inputErrors.threshold && (
                                  <span
                                    className="field-error"
                                    id="draft-threshold-error"
                                  >
                                    {inputErrors.threshold}
                                  </span>
                                )}
                              </label>
                            )}
                            <label>
                              仓位上限（%）
                              <input
                                aria-label="仓位预算上限（%）"
                                type="number"
                                min={1}
                                max={100}
                                id="draft-maxPositionPct"
                                aria-invalid={Boolean(
                                  inputErrors.maxPositionPct,
                                )}
                                aria-describedby={
                                  inputErrors.maxPositionPct
                                    ? "draft-maxPositionPct-error"
                                    : undefined
                                }
                                value={
                                  Number.isFinite(spec.maxPositionPct)
                                    ? spec.maxPositionPct
                                    : ""
                                }
                                onChange={(e) =>
                                  field(
                                    "maxPositionPct",
                                    e.target.value === ""
                                      ? NaN
                                      : Number(e.target.value),
                                  )
                                }
                                disabled={busy}
                              />
                              {inputErrors.maxPositionPct && (
                                <span
                                  className="field-error"
                                  id="draft-maxPositionPct-error"
                                >
                                  {inputErrors.maxPositionPct}
                                </span>
                              )}
                            </label>
                            <label>
                              {spec.execution === "live"
                                ? "单笔委托（元）"
                                : "单笔上限（元）"}
                              <input
                                aria-label="单笔买入预算上限（元）"
                                type="number"
                                step={1000}
                                min={1000}
                                max={1000000}
                                id="draft-maxOrderValue"
                                aria-invalid={Boolean(
                                  inputErrors.maxOrderValue,
                                )}
                                aria-describedby={
                                  inputErrors.maxOrderValue
                                    ? "draft-maxOrderValue-error"
                                    : undefined
                                }
                                value={
                                  Number.isFinite(spec.maxOrderValue)
                                    ? spec.maxOrderValue
                                    : ""
                                }
                                onChange={(e) =>
                                  field(
                                    "maxOrderValue",
                                    e.target.value === ""
                                      ? NaN
                                      : Number(e.target.value),
                                  )
                                }
                                disabled={busy}
                              />
                              {inputErrors.maxOrderValue && (
                                <span
                                  className="field-error"
                                  id="draft-maxOrderValue-error"
                                >
                                  {inputErrors.maxOrderValue}
                                </span>
                              )}
                            </label>
                            <p>
                              <Info size={14} />
                              {spec.execution === "live"
                                ? "实盘买卖均受单笔限额约束；默认关闭交易开关，须在 QMT 本地启用。"
                                : "预算为买入上限，实际成交比例可能偏离。"}
                            </p>
                          </div>
                        )}
                        {!advanced && (
                          <dl className="draft-summary">
                            <div>
                              <dt>股票</dt>
                              <dd>{spec.symbol}</dd>
                            </div>
                            <div>
                              <dt>仓位上限</dt>
                              <dd>{spec.maxPositionPct}%</dd>
                            </div>
                            <div>
                              <dt>单笔上限</dt>
                              <dd>
                                {spec.maxOrderValue.toLocaleString("zh-CN")} 元
                              </dd>
                            </div>
                          </dl>
                        )}
                      </div>
                      <div className="composer-actions">
                        <span className="privacy-note">
                          <ShieldCheck size={14} />
                          {provider === "codex"
                            ? "描述将发送至智能服务，请勿填写账号或密码。"
                            : "固定规则模板 · 不调用 AI"}
                        </span>
                        <button
                          className="primary-button"
                          type="submit"
                          disabled={busy || !health?.pythonAvailable}
                        >
                          {busy ? (
                            <LoaderCircle size={17} className="spin" />
                          ) : (
                            <WandSparkles size={17} />
                          )}{" "}
                          {busy
                            ? busyText
                            : provider === "codex"
                              ? "理解我的策略"
                              : "确认模板参数"}{" "}
                          {!busy && <ArrowRight size={16} />}
                        </button>
                      </div>
                      <div className="create-status">
                        {phase === "understand" && (busy || flowError) && (
                          <TaskProgress
                            phase="understand"
                            busy={busy}
                            startedAt={startedAt}
                            failure={flowError}
                            onRetry={() => void understand()}
                            onSettings={() => setSettings(true)}
                          />
                        )}
                        {(!health?.pythonAvailable || connectionError) && (
                          <div className="service-hint" role="status">
                            <Info size={16} />
                            <span>
                              {healthLoading
                                ? "正在连接服务…"
                                : connectionError ||
                                  (health
                                    ? "Python 校验器不可用，请检查连接设置后重新连接。"
                                    : "服务未连接，连接恢复后即可继续。")}
                            </span>
                            <button
                              type="button"
                              className="text-button"
                              disabled={healthLoading}
                              onClick={() => void refresh()}
                            >
                              重新连接
                            </button>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => setSettings(true)}
                            >
                              连接设置
                            </button>
                          </div>
                        )}
                      </div>
                    </form>
                  </section>
                </div>
              </div>
            </>
          )}
          {page === "create" &&
            !healthLoading &&
            !connectionError &&
            !history.length && (
              <FirstRunGuide
                disabled={busy}
                onTemplate={() => openTemplatePicker("ma_cross")}
                onGuide={() => openImportGuide()}
              />
            )}
          {page === "task" && generationPlan && (
            <div className="generation-workspace">
              <PageIntro
                eyebrow="生成脚本 · 第 3 步"
                title={generationPlan.spec.name}
                description="确认的规则已保存，以下阶段反映服务端的实际处理状态。"
              />
              <TaskProgress
                phase="generate"
                busy={busy}
                startedAt={startedAt}
                job={job}
                failure={flowError}
                onRetry={() =>
                  void generate(generationPlan, job?.status === "failed")
                }
                onReview={reopenReview}
                onSettings={() => setSettings(true)}
              />
              {!busy && (
                <button
                  className="text-button back-to-draft"
                  onClick={() => {
                    setFlowError(undefined);
                    nav("create");
                  }}
                >
                  返回创建草稿 <ArrowRight size={15} />
                </button>
              )}
            </div>
          )}
          {page === "result" && artifact && (
            <div
              className="result-workspace"
              ref={resultRef}
              tabIndex={-1}
              aria-label="策略结果工作区"
            >
              <div className="result-location">
                <button className="text-button" onClick={() => nav("library")}>
                  <FolderOpen size={16} /> 我的脚本
                </button>
                <ChevronRight size={14} />
                <span>查看与下载</span>
                <button
                  className="text-button resume-draft"
                  onClick={() => nav("create")}
                >
                  返回创建草稿 <ArrowRight size={15} />
                </button>
              </div>
              <header className="result-page-heading">
                <div>
                  <h1>{artifactName(artifact)}</h1>
                  <p>
                    {artifact.spec.symbol} ·{" "}
                    {artifact.provider === "codex"
                      ? "智能理解 + 模板生成"
                      : "模板生成"}{" "}
                    · {time(artifact.createdAt)}
                  </p>
                </div>
                <span
                  className={`status-pill ${artifact.report.passed ? "good" : "bad"}`}
                >
                  {artifact.report.passed ? (
                    <CheckCircle2 size={13} />
                  ) : (
                    <Info size={13} />
                  )}{" "}
                  {artifact.report.passed ? "静态校验通过" : "校验未通过"}
                </span>
              </header>
              <div className="result-toolbar">
                <div className="result-actions">
                  <button
                    className="secondary-button"
                    onClick={() => void copyFromResult(artifact.id)}
                    disabled={busy}
                  >
                    <SlidersHorizontal size={16} /> 复制为新策略
                  </button>
                  <button
                    className="text-button report-download"
                    aria-label="下载校验报告（PDF）"
                    disabled={Boolean(downloading)}
                    onClick={() => void saveDownload(true)}
                  >
                    <FileText size={15} />
                    校验报告 PDF
                  </button>
                  <button
                    className="primary-button"
                    disabled={!artifact.report.passed || Boolean(downloading)}
                    onClick={() => void saveDownload()}
                  >
                    <Download size={16} />
                    下载 Python 脚本
                  </button>
                </div>
              </div>
              <section
                className="result-import-next panel"
                aria-label="下一步导入 QMT"
              >
                <span className="square-icon">
                  <BookOpen size={20} />
                </span>
                <div>
                  <h2>
                    {!artifact.report.passed
                      ? "先处理校验问题，再准备导入"
                      : artifact.spec.execution === "live"
                        ? "这份脚本是实盘模式，请按对应流程准备"
                        : lastDownloadedId === artifact.id
                          ? "下载已发起，接着在 QMT 中载入源码"
                          : "准备在 QMT 里验证策略？"}
                  </h2>
                  <p>按脚本运行方式完成 QMT 本地设置与验收。</p>
                </div>
                <button
                  className="text-button"
                  onClick={() => openImportGuide(artifact.id)}
                >
                  开始导入指引
                  <ArrowRight size={15} />
                </button>
              </section>
              <section className="result panel">
                <div className="result-tabs" role="group" aria-label="结果内容">
                  {(
                    [
                      {
                        id: "explain",
                        label: "策略说明",
                        icon: FileText,
                      },
                      { id: "code", label: "Python 脚本", icon: Code2 },
                      {
                        id: "checks",
                        label: "校验报告",
                        icon: ShieldCheck,
                      },
                      {
                        id: "sources",
                        label: "文档依据",
                        icon: BookOpen,
                      },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      className={resultTab === t.id ? "selected" : ""}
                      aria-pressed={resultTab === t.id}
                      onClick={() => setResultTab(t.id)}
                    >
                      <t.icon size={15} />
                      {t.label}
                    </button>
                  ))}
                </div>
                <details className="result-request">
                  <summary>
                    {artifact.provider === "codex"
                      ? "查看原始策略描述"
                      : "查看创建时的模板参数"}
                  </summary>
                  <p>
                    {artifact.prompt ||
                      `${kindLabels[artifact.spec.kind]} · ${artifact.spec.symbol} · 短周期 ${artifact.spec.fastWindow} 天 / 长周期 ${artifact.spec.slowWindow} 天 · 阈值 ${Number((artifact.spec.threshold * 100).toFixed(2))}% · 仓位预算 ${artifact.spec.maxPositionPct}% · 单笔预算 ${artifact.spec.maxOrderValue.toLocaleString()} 元`}
                  </p>
                </details>
                <div className="result-content">
                  {resultTab === "explain" && (
                    <>
                      <p className="strategy-summary">{artifact.summary}</p>
                      <div className="strategy-properties">
                        <div>
                          <span>运行方式</span>
                          <strong>
                            {executionLabels[artifact.spec.execution]}
                          </strong>
                        </div>
                        <div>
                          <span>
                            {artifact.spec.execution === "live"
                              ? "单笔委托上限"
                              : "单笔买入预算"}
                          </span>
                          <strong>
                            ¥ {artifact.spec.maxOrderValue.toLocaleString()}
                          </strong>
                        </div>
                        <div>
                          <span>仓位预算上限</span>
                          <strong>{artifact.spec.maxPositionPct}%</strong>
                        </div>
                      </div>
                      <h3 className="subheading">使用前，了解这些约定</h3>
                      <ul className="assumptions">
                        {artifact.assumptions.map((a, i) => (
                          <li key={i}>{a}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {resultTab === "code" && (
                    <>
                      <div className="code-toolbar">
                        <span>
                          strategy.py <span>Python 3.6 · GBK</span>
                        </span>
                        <button
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(artifact.code)
                              .then(() =>
                                setNotice(
                                  "脚本已复制；文件导入建议使用下载按钮，以保留 GBK 编码。",
                                ),
                              )
                              .catch(() =>
                                setError("剪贴板不可用，请下载脚本。"),
                              )
                          }
                        >
                          <Copy size={13} />
                          复制
                        </button>
                      </div>
                      <pre
                        className="code-block"
                        tabIndex={0}
                        aria-label="Python 脚本源码"
                      >
                        <code>
                          {artifact.code.split("\n").map((line, i) => (
                            <span className="code-line" key={i}>
                              <span className="line-number">{i + 1}</span>
                              <span
                                className={
                                  line.trim().startsWith("#")
                                    ? "code-comment"
                                    : /^(def |import )/.test(line)
                                      ? "code-keyword"
                                      : ""
                                }
                              >
                                {line || " "}
                              </span>
                            </span>
                          ))}
                        </code>
                      </pre>
                    </>
                  )}
                  {resultTab === "checks" && (
                    <>
                      <div className="validation-intro">
                        <ShieldCheck size={23} />
                        <div>
                          <strong>
                            {
                              artifact.report.checks.filter(
                                (c) => c.status === "pass",
                              ).length
                            }{" "}
                            项静态规则通过
                          </strong>
                          <p>
                            校验结果与待办事项分别列示，不代表收益或运行保证。
                          </p>
                        </div>
                      </div>
                      <div className="check-list">
                        {artifact.report.checks.map((c) => (
                          <div key={c.id} className={`check-row ${c.status}`}>
                            <span>
                              {c.status === "pass" ? (
                                <CheckCircle2 size={17} />
                              ) : c.status === "pending" ? (
                                <Clock3 size={17} />
                              ) : (
                                <X size={17} />
                              )}
                            </span>
                            <div>
                              <strong>{c.name}</strong>
                              <p>{c.detail}</p>
                            </div>
                            <small>
                              {c.status === "pass"
                                ? "已通过"
                                : c.status === "pending"
                                  ? "待验收"
                                  : "未通过"}
                            </small>
                          </div>
                        ))}
                      </div>
                      <p className="hash">
                        SHA-256 · {artifact.report.codeHash}
                      </p>
                    </>
                  )}
                  {resultTab === "sources" && (
                    <div className="source-list">
                      {artifact.retrieval && (
                        <div className="document-retrieval-trace">
                          <strong>本次 AI 正文检索</strong>
                          <p>查询：{artifact.retrieval.queries.join("；")}</p>
                          <p>
                            已读取 {artifact.retrieval.retrievedChunkIds.length}{" "}
                            个正文片段，以下展示引用及模板依据。
                          </p>
                        </div>
                      )}
                      {artifact.sources.map((s) => (
                        <SourceCard key={s.id} source={s} />
                      ))}
                    </div>
                  )}
                </div>
                <div className="result-warning">
                  <Info size={15} />
                  <span>{artifact.report.scope}</span>
                </div>
              </section>
            </div>
          )}
          {page === "library" && (
            <>
              <div className="library-page-heading">
                <PageIntro
                  eyebrow="YOUR STRATEGY LIBRARY"
                  title="我的脚本"
                  description="查找、整理和复用已生成的策略。"
                />
                <button
                  className="primary-button"
                  onClick={reset}
                  disabled={busy}
                >
                  <Plus size={16} />
                  创建策略
                </button>
              </div>
              <ScriptLibrary
                items={history}
                busy={busy}
                loading={healthLoading}
                loadError={connectionError}
                onReload={() => void refresh()}
                onOpen={openArtifact}
                onCopy={copyArtifact}
                onTemplate={() => openTemplatePicker("ma_cross")}
                onResume={resumeDescription}
                onImport={openImportGuide}
                onRenamed={onRenamed}
                onDeleted={onDeleted}
                onNotice={setNotice}
              />
            </>
          )}
          {page === "docs" && (
            <>
              <PageIntro
                eyebrow="OFFICIAL REFERENCES"
                title="官方文档"
                description="检索官方章节，核对接口约定与脚本依据。"
              />
              <DocumentLibrary sources={sources} />
              <div className="panel docs-footnote">
                <h3>关于生成方式</h3>
                <p>
                  系统根据需求检索官方文档，核对策略规则和引用后生成脚本，并执行静态校验。
                </p>
              </div>
            </>
          )}
          {page === "guide" && (
            <ImportGuide
              key={guideId || "default"}
              items={history}
              initialId={guideId}
              initialArtifact={artifact}
              onBacktestCopy={(id) => copyFromResult(id, "backtest")}
              busy={busy}
              loading={healthLoading}
              loadError={connectionError}
              onReload={() => void refresh()}
              onTemplate={() => openTemplatePicker("ma_cross")}
              onCreate={resumeDescription}
              onOpen={openArtifact}
              onNotice={setNotice}
            />
          )}
          <footer className="page-footer">
            <span>东吴证券 · QMT 策略工坊</span>
            <span>辅助策略编写 · 使用前请完成 QMT 回测验证</span>
            <span>v0.1.0</span>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {notice}
        </div>
      )}
      {templateChoice && (
        <TemplatePicker
          spec={spec}
          initialKind={templateChoice}
          onApply={useTemplate}
          onClose={() => setTemplateChoice(undefined)}
        />
      )}
      {plan && (
        <PlanReview
          key={plan.id}
          plan={plan}
          onConfirm={acceptReview}
          onBack={backFromReview}
        />
      )}
      {settings && (
        <div className="modal-overlay">
          <form
            className="modal settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onSubmit={(e) => {
              e.preventDefault();
              setAccessToken(token);
              setSettings(false);
              setError("");
              void refresh();
              setNotice("连接设置已更新");
            }}
          >
            <button
              type="button"
              className="modal-close icon-button"
              aria-label="关闭设置"
              onClick={() => setSettings(false)}
            >
              <X size={20} />
            </button>
            <span className="modal-illustration">
              <Settings2 size={25} />
            </span>
            <h2 id="settings-title">连接设置</h2>
            <p className="modal-subtitle">仅管理员开启访问控制时需要填写。</p>
            <label>
              工作台访问令牌
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="管理员提供的令牌"
                autoComplete="off"
              />
            </label>
            <p className="settings-note">
              令牌仅在当前页面有效，刷新后需重新填写。请勿填写交易密码或模型服务密钥。
            </p>
            <div className="connection-details">
              <div>
                后端服务<span>{health ? "已连接" : "未连接"}</span>
              </div>
              <div>
                Python 校验器
                <span>{health?.pythonAvailable ? "可用" : "不可用"}</span>
              </div>
              <div>
                智能服务凭据
                <span>
                  {health?.credentialsPresent
                    ? "已检测到，待调用验证"
                    : "未检测到"}
                </span>
              </div>
              <div>
                访问控制
                <span>{health?.authRequired ? "已开启" : "本地开发模式"}</span>
              </div>
            </div>
            <div className="modal-actions">
              <button className="primary-button" type="submit">
                保存并连接
                <ArrowRight size={16} />
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function PageIntro({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <section className="page-intro">
      <div className="eyebrow">
        <span />
        {eyebrow}
      </div>
      <h1>{title}</h1>
      <p>{description}</p>
    </section>
  );
}
