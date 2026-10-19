import { useState } from "react";
import { Download, Copy, BookOpen } from "lucide-react";
import type { ArtifactSummary } from "@qmt/shared";
import { download, readVerifiedScript } from "./api";

export function LiveImportGuide({
  item,
  onOpen,
  onNotice,
}: {
  item: ArtifactSummary;
  onOpen: (id: string, tab?: "code" | "checks" | "explain") => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function prepare(copy: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (copy)
        await navigator.clipboard.writeText(await readVerifiedScript(item.id));
      else await download(item.id);
      onNotice(
        copy
          ? "已复制默认关闭交易开关的实盘源码"
          : "实盘脚本已下载，须在 QMT 本地配置与验收",
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "操作失败，请重试。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel live-import-guide"
      aria-label="实盘脚本配置与验收"
    >
      <h2>实盘脚本配置与验收</h2>
      <p>
        账户与交易开关只在 QMT
        本地配置。网页不会连接交易账户，也不会替您启动交易。
      </p>
      <ol>
        <li>
          <h3>准备脚本与模拟环境</h3>
          <p>
            先用相同规则生成历史回测版本核对信号，再将实盘版本载入东吴 QMT 内置
            Python
            模型。日线、单只股票；在策略交易界面选择普通股票账户，先使用模拟柜台。
          </p>
        </li>
        <li>
          <h3>在 QMT 本地设置账户和启用开关</h3>
          <p>
            <code>ACCOUNT_ID</code>{" "}
            留空则使用策略交易界面选择的账户；也可仅在本地填写。将{" "}
            <code>ACCOUNT_READY_STATUS</code>{" "}
            设置为该券商客户端已登录时的精确状态文字，缺失或不匹配均不下新单。完成核对后，在本地将{" "}
            <code>LIVE_TRADING_ENABLED = False</code> 改为 <code>True</code>
            。实盘版在“策略交易”运行，不能用“回测”启动。
          </p>
          <p>
            如不知道正常状态文字，可先在模拟柜台保持状态配置为空，启用后查看“账户未就绪”日志显示的实际状态；核实账户确已登录后再填写，不能将“准备登录”或“断线”设为就绪状态。
          </p>
        </li>
        <li>
          <h3>保留状态文件，只运行一个实例</h3>
          <p>
            同一账户同一股票仅允许一台电脑一个实例。默认在用户目录的{" "}
            <code>.qmt_strategy_studio</code>{" "}
            保存意图和锁。正常停止会释放锁；异常退出后，先确认旧进程已关闭、核对柜台委托，再人工移除对应{" "}
            <code>.lock</code>。保留 <code>.json</code>
            ，记录丢失或异常须先恢复，不应删除后重新运行。
          </p>
        </li>
        <li>
          <h3>核对回报、撤单和重启</h3>
          <p>
            模板在北京时间连续竞价时段的 09:30–11:29、13:00–14:55
            接受新委托，要求当日交易日、已登录账户和 15
            秒内行情；使用指定限价。买卖均受单笔限额约束。未成交 60
            秒后请求撤单，仅收到已撤回报后允许一次剩余量重试；部分成交不会重买已成交部分。手动撤单、废单和提交结果未知均不自动重发。
          </p>
          <p>
            在模拟柜台验证部分成交、超时撤单、拒单、断线、重复回报及重启恢复后，再决定是否运行真实柜台。停止脚本不保证未完成委托已撤销，须在
            QMT 委托界面继续处理。
          </p>
        </li>
      </ol>
      <div className="guide-empty-actions">
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => void prepare(false)}
        >
          <Download size={16} />
          下载实盘脚本
        </button>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => void prepare(true)}
        >
          <Copy size={16} />
          复制实盘源码
        </button>
        <button
          className="text-button"
          onClick={() => void onOpen(item.id, "checks")}
        >
          <BookOpen size={16} />
          查看验收事项
        </button>
      </div>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <p>
        <a
          href="https://knowledge.thinktrader.net/docs/python/start_now.html"
          target="_blank"
          rel="noreferrer"
        >
          官方实盘运行说明 ↗
        </a>{" "}
        ·{" "}
        <a
          href="https://knowledge.thinktrader.net/docs/python/callback_function.html"
          target="_blank"
          rel="noreferrer"
        >
          官方委托与成交回报 ↗
        </a>{" "}
        ·{" "}
        <a
          href="https://knowledge.thinktrader.net/docs/python/trading_function.html"
          target="_blank"
          rel="noreferrer"
        >
          官方下单与撤单接口 ↗
        </a>
      </p>
    </section>
  );
}
