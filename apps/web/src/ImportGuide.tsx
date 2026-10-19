import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileCode2,
  Info,
  Layers3,
  LoaderCircle,
  Monitor,
  RotateCcw,
} from "lucide-react";
import {
  artifactFilename,
  artifactName,
  kindLabels,
  executionLabels,
  type ArtifactSummary,
} from "@qmt/shared";
import { ApiError, download, readVerifiedScript } from "./api";
import { LiveImportGuide } from "./LiveImportGuide";
import {
  advanceImport,
  importProgressKey,
  importSteps,
  readImportProgress,
  type ImportProgress,
} from "./onboarding";

export function ImportGuide({
  items,
  initialId,
  initialArtifact,
  busy = false,
  loading = false,
  loadError = "",
  onReload,
  onBacktestCopy,
  onTemplate,
  onCreate,
  onOpen,
  onNotice,
}: {
  items: ArtifactSummary[];
  initialId?: string;
  initialArtifact?: ArtifactSummary;
  busy?: boolean;
  loading?: boolean;
  loadError?: string;
  onReload?: () => void;
  onBacktestCopy?: (id: string) => Promise<void>;
  onTemplate: () => void;
  onCreate: () => void;
  onOpen: (id: string, tab?: "code" | "checks" | "explain") => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const options = [
    ...new Map(
      [...(initialArtifact ? [initialArtifact] : []), ...items].map((item) => [
        item.id,
        item,
      ]),
    ).values(),
  ];
  const [selectedId, setSelectedId] = useState(
    initialId || initialArtifact?.id || "",
  );
  const item = options.find((script) => script.id === selectedId) || options[0];
  return (
    <div className="import-guide">
      <header className="import-guide-header">
        <div className="eyebrow">GET STARTED</div>
        <h1>
          {item?.spec.execution === "live"
            ? "导入 QMT，配置实盘脚本"
            : "导入 QMT，先做历史回测"}
        </h1>
        <p>从生成的脚本出发，按步骤完成电脑端的准备与核对。</p>
      </header>
      {loadError && (
        <div className="inline-error" role="alert">
          <Info size={18} />
          <div>
            <strong>脚本列表暂时无法刷新</strong>
            <p>{loadError}</p>
            {onReload && (
              <button
                className="text-button"
                disabled={loading}
                onClick={onReload}
              >
                重新加载
              </button>
            )}
          </div>
        </div>
      )}
      {!item && loading ? (
        <div className="library-loading panel" role="status">
          <LoaderCircle size={22} className="spin" />
          正在加载可导入的脚本…
        </div>
      ) : !item && loadError ? null : !item ? (
        <section className="guide-empty panel">
          <span className="square-icon">
            <FileCode2 size={28} />
          </span>
          <h2>先创建一份脚本，再开始导入</h2>
          <p>
            选择模板、核对买卖规则、生成脚本后，这里会显示与该脚本对应的操作步骤。
          </p>
          <ol>
            <li>选择一个模板</li>
            <li>确认策略规则</li>
            <li>生成后按步骤导入</li>
          </ol>
          <div className="guide-empty-actions">
            <button
              className="primary-button"
              onClick={onTemplate}
              disabled={busy}
            >
              <Layers3 size={17} />
              从模板开始
            </button>
            <button
              className="secondary-button"
              onClick={onCreate}
              disabled={busy}
            >
              描述我的策略
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="import-script-context panel">
            <div>
              <label htmlFor="import-script">要导入的脚本</label>
              <select
                id="import-script"
                value={item.id}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                {options.map((option) => (
                  <option value={option.id} key={option.id}>
                    {artifactName(option)} · {option.spec.symbol}
                  </option>
                ))}
              </select>
            </div>
            <dl>
              <div>
                <dt>股票</dt>
                <dd>{item.spec.symbol}</dd>
              </div>
              <div>
                <dt>规则</dt>
                <dd>{kindLabels[item.spec.kind]}</dd>
              </div>
              <div>
                <dt>运行方式</dt>
                <dd>{executionLabels[item.spec.execution]}</dd>
              </div>
            </dl>
            <button
              className="text-button"
              onClick={() => void onOpen(item.id, "checks")}
            >
              <CheckCircle2 size={15} />
              查看校验报告
            </button>
          </section>
          {item.report.passed && item.spec.execution === "live" ? (
            <>
              {onBacktestCopy && (
                <section className="import-live-context panel">
                  <Monitor size={22} />
                  <div>
                    <h2>先用相同规则做历史回测</h2>
                    <p>
                      您选择的是独立实盘脚本。可先创建历史回测副本，核对策略规则后，再阅读下方对应的本地配置与验收说明。
                    </p>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void onBacktestCopy(item.id)}
                    >
                      <Copy size={16} />
                      复制为历史回测策略
                    </button>
                  </div>
                </section>
              )}
              <LiveImportGuide
                item={item}
                onOpen={onOpen}
                onNotice={onNotice}
              />
            </>
          ) : item.report.passed ? (
            <ImportSteps
              key={item.id}
              item={item}
              onOpen={onOpen}
              onNotice={onNotice}
            />
          ) : (
            <section className="import-blocked panel" role="alert">
              <Info size={23} />
              <div>
                <h2>先处理脚本校验问题</h2>
                <p>
                  这份脚本的静态校验未通过。请先查看报告、调整规则并重新生成，再继续下载与载入。
                </p>
                <button
                  className="primary-button"
                  onClick={() => void onOpen(item.id, "checks")}
                >
                  查看校验问题
                  <ArrowRight size={16} />
                </button>
              </div>
            </section>
          )}
        </>
      )}
      <section className="import-faq">
        <h2>遇到问题时</h2>
        <details>
          <summary>中文显示乱码怎么办？</summary>
          <p>
            工作台下载的是 GBK 编码的 Python 文件。请按 GBK
            编码打开，或使用步骤中的“复制完整脚本”，保留文件开头的编码声明。
          </p>
        </details>
        <details>
          <summary>有买卖信号，但看不到成交？</summary>
          <p>
            {item?.spec.execution === "live"
              ? "实盘提交不等于成交。先核对本地开关、已登录状态、行情、限价、预算和可卖持仓，再查看 QMT 委托及成交记录。未知提交结果不要手动反复运行。"
              : "先核对脚本的运行方式。“仅输出买卖信号”不会发送委托；虚拟回测下单还需核对信号条件、历史数据、资金预算和可卖持仓。"}
          </p>
        </details>
        <details>
          <summary>点击后没有日志或提示运行环境不符？</summary>
          <p>
            {item?.spec.execution === "live"
              ? "实盘版本须在策略交易界面运行，并在 QMT 本地配置账户、已登录状态和交易开关。"
              : "信号与历史回测版本使用策略编辑器中的“回测”，核对日线和股票代码，并取消独立 Python 进程。"}
            保留客户端错误信息及校验报告后再排查。
          </p>
        </details>
      </section>
      <p className="guide-source">
        步骤参考{" "}
        <a
          href="https://knowledge.thinktrader.net/docs/python/interface_operation.html"
          target="_blank"
          rel="noreferrer"
        >
          迅投官方界面说明
        </a>{" "}
        与{" "}
        <a
          href="https://knowledge.thinktrader.net/docs/python/start_now.html"
          target="_blank"
          rel="noreferrer"
        >
          快速开始
        </a>
        ；入口名称以您使用的券商客户端版本为准。
      </p>
    </div>
  );
}
function ImportSteps({
  item,
  onOpen,
  onNotice,
}: {
  item: ArtifactSummary;
  onOpen: (id: string, tab?: "code" | "checks" | "explain") => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const key = importProgressKey(item.id);
  const [progress, setProgress] = useState<ImportProgress>(() => {
    try {
      return readImportProgress(localStorage.getItem(key));
    } catch {
      return readImportProgress(null);
    }
  });
  const [pending, setPending] = useState<"download" | "copy" | "notes">();
  const [error, setError] = useState("");
  const [downloadStarted, setDownloadStarted] = useState(false);
  const [copied, setCopied] = useState(false);
  const activeOperation = useRef(false);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const reveal = () => {
      const nav = navRef.current;
      const current = nav?.querySelector<HTMLElement>('[aria-current="step"]');
      if (!nav || !current) return;
      const bounds = nav.getBoundingClientRect();
      const selected = current.getBoundingClientRect();
      if (selected.left < bounds.left)
        nav.scrollLeft -= bounds.left - selected.left;
      else if (selected.right > bounds.right)
        nav.scrollLeft += selected.right - bounds.right;
    };
    const frame = requestAnimationFrame(reveal);
    window.addEventListener("resize", reveal);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", reveal);
    };
  }, [progress.active]);
  const step = importSteps[progress.active];
  const complete = progress.completed.length === importSteps.length;
  function change(next: ImportProgress) {
    setProgress(next);
    setError("");
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Steps remain usable if browser storage is unavailable. */
    }
    if (next.active !== progress.active)
      requestAnimationFrame(() =>
        document
          .getElementById("import-step-title")
          ?.scrollIntoView({ block: "start", behavior: "instant" }),
      );
  }
  async function action(kind: "download" | "copy" | "notes") {
    if (activeOperation.current) return;
    activeOperation.current = true;
    setPending(kind);
    setError("");
    try {
      if (kind === "download") {
        await download(item.id);
        setDownloadStarted(true);
        onNotice("已发起脚本下载，请在电脑上备好文件。");
      } else if (kind === "copy") {
        const source = await readVerifiedScript(item.id);
        await navigator.clipboard.writeText(source);
        setCopied(true);
        onNotice("完整源码已复制，可粘贴到 QMT 的 Python 策略编辑器。");
      } else {
        await navigator.clipboard.writeText(
          `脚本：${artifactName(item)}\n股票：${item.spec.symbol}\n周期：日线（1d）\n策略位置：副图\n运行方式：${item.spec.execution === "signal" ? "仅输出买卖信号" : "历史回测虚拟下单"}\n取消独立 Python 进程；补齐历史数据后设置回测起止日期、初始资金、费用及滑点，再点击回测。`,
        );
        onNotice("回测设置要点已复制。");
      }
    } catch (error) {
      setError(
        error instanceof ApiError
          ? error.message
          : kind === "download"
            ? "下载未完成，请检查连接后重试。"
            : "当前浏览器无法复制，请下载文件并按 GBK 编码打开后复制。",
      );
    } finally {
      activeOperation.current = false;
      setPending(undefined);
    }
  }
  return (
    <>
      <nav className="import-step-nav" aria-label="导入步骤" ref={navRef}>
        {importSteps.map((entry, index) => (
          <button
            key={entry.id}
            aria-current={index === progress.active ? "step" : undefined}
            className={`${index === progress.active ? "current" : ""} ${progress.completed.includes(entry.id) ? "complete" : ""}`}
            disabled={Boolean(pending)}
            onClick={() => change({ ...progress, active: index })}
          >
            <span>
              {progress.completed.includes(entry.id) ? (
                <Check size={15} />
              ) : (
                index + 1
              )}
            </span>
            <strong>{entry.title}</strong>
          </button>
        ))}
      </nav>
      <section
        className="import-step panel"
        aria-labelledby="import-step-title"
      >
        <div className="import-step-title" aria-live="polite">
          <span>
            第 {progress.active + 1} / {importSteps.length} 步
          </span>
          <h2 id="import-step-title">{step.title}</h2>
        </div>
        {step.id === "download" && (
          <div className="import-step-content">
            <p>准备这份脚本的 Python 文件；也可以在下一步直接复制完整源码。</p>
            <button
              className="primary-button"
              disabled={Boolean(pending)}
              onClick={() => void action("download")}
            >
              {pending === "download" ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <Download size={17} />
              )}
              下载 Python 脚本
            </button>
            <div className="import-file">
              <FileCode2 size={28} />
              <div>
                <strong>{artifactFilename(item)}</strong>
                <span>Python 源码 · GBK 编码</span>
              </div>
            </div>
            <div className="import-mobile-note">
              <Monitor size={19} />
              <p>
                QMT 在电脑端使用。手机上下载后，请将文件传到安装 QMT
                的电脑，再继续下面的操作。
              </p>
            </div>
            {downloadStarted && (
              <p className="import-action-success" role="status">
                <CheckCircle2 size={15} />
                已发起下载，请确认文件已在电脑上就绪。
              </p>
            )}
          </div>
        )}
        {step.id === "editor" && (
          <div className="import-step-content">
            <ol>
              <li>在 QMT 的“模型研究”中新建模型，类型选择 Python。</li>
              <li>
                将完整源码粘贴到“策略编辑器”，保留开头的{" "}
                <code>#coding:gbk</code>。
              </li>
              <li>
                点击“编译”保存模型。Python
                模型中的编译按钮仅用于保存，实际错误仍需在回测日志中核对。
              </li>
            </ol>
            <div className="import-action-row">
              <button
                className="primary-button"
                disabled={Boolean(pending)}
                onClick={() => void action("copy")}
              >
                {pending === "copy" ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <Copy size={17} />
                )}
                复制完整脚本
              </button>
              <button
                className="text-button"
                onClick={() => void onOpen(item.id, "code")}
              >
                在工作台查看源码
                <ArrowRight size={15} />
              </button>
            </div>
            {copied && (
              <p className="import-action-success" role="status">
                <CheckCircle2 size={15} />
                源码已复制，切换到电脑上的策略编辑器粘贴。
              </p>
            )}
            <p className="import-detail-note">
              本工作台提供 .py 源码，这里采用新建 Python
              模型并复制源码的方式。官方“导入策略”说明用于加密模型迁移。
            </p>
          </div>
        )}
        {step.id === "backtest" && (
          <div className="import-step-content">
            <dl className="import-settings">
              <div>
                <dt>主图品种</dt>
                <dd>{item.spec.symbol}</dd>
              </div>
              <div>
                <dt>默认周期</dt>
                <dd>日线（1d）</dd>
              </div>
              <div>
                <dt>策略位置</dt>
                <dd>副图</dd>
              </div>
              <div>
                <dt>独立 Python 进程</dt>
                <dd>取消勾选</dd>
              </div>
            </dl>
            <ol>
              <li>
                在“操作 →
                数据管理”补齐该股票的日线历史数据，覆盖回测区间及观察周期。
              </li>
              <li>在“回测参数”中设置起止日期、初始资金、手续费和滑点。</li>
              <li>使用“回测”按钮启动。本脚本限定在历史回测环境使用。</li>
            </ol>
            <button
              className="secondary-button"
              disabled={Boolean(pending)}
              onClick={() => void action("notes")}
            >
              <Copy size={16} />
              复制回测设置要点
            </button>
          </div>
        )}
        {step.id === "review" && (
          <div className="import-step-content">
            <p className="import-mode-note">
              {item.spec.execution === "signal"
                ? "这份脚本仅输出买卖信号，不发送虚拟委托；没有成交记录是该模式的正常表现。"
                : "这份脚本允许历史回测中的虚拟下单。请结合日志、委托及成交记录核对结果。"}
            </p>
            <ul>
              <li>核对启动日志中的股票代码、策略名称与运行方式。</li>
              <li>
                核对买卖条件、数据区间和费用设置；没有信号时，先检查条件是否触发以及历史数据是否足够。
              </li>
              <li>出现错误时保留完整日志和校验报告，先修正再继续测试。</li>
            </ul>
            <button
              className="secondary-button"
              onClick={() => void onOpen(item.id, "checks")}
            >
              <BookOpen size={16} />
              重新查看校验报告
            </button>
          </div>
        )}
        {error && (
          <div className="inline-error import-error" role="alert">
            <Info size={18} />
            <p>{error} 您的步骤进度已保留。</p>
          </div>
        )}
        {complete && (
          <div className="import-complete" role="status">
            <CheckCircle2 size={22} />
            <div>
              <strong>已记录您的操作进度</strong>
              <p>完成标记用于记住步骤，仍需自行核对 QMT 的实际运行结果。</p>
            </div>
          </div>
        )}
        <footer className="import-step-actions">
          <button
            className="secondary-button"
            disabled={Boolean(pending) || progress.active === 0}
            onClick={() => change({ ...progress, active: progress.active - 1 })}
          >
            <ArrowLeft size={16} />
            上一步
          </button>
          <span>
            已记录 {progress.completed.length} / {importSteps.length} 步
          </span>
          <button
            className="primary-button"
            disabled={Boolean(pending)}
            onClick={() => change(advanceImport(progress))}
          >
            {progress.active === 3
              ? complete
                ? "已核对，保留记录"
                : "记录为已完成"
              : "这一步已完成，下一步"}
            {progress.active === 3 ? (
              <Check size={16} />
            ) : (
              <ArrowRight size={16} />
            )}
          </button>
        </footer>
      </section>
      <div className="import-progress-note">
        <span>步骤进度保存在当前浏览器。</span>
        <button
          className="text-button"
          disabled={Boolean(pending)}
          onClick={() => change(readImportProgress(null))}
        >
          <RotateCcw size={14} />
          重新查看步骤
        </button>
        <button
          className="text-button"
          onClick={() => void onOpen(item.id, "explain")}
        >
          返回脚本详情
          <ArrowRight size={14} />
        </button>
      </div>
    </>
  );
}
