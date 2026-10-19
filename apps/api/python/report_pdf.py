"""Render stored validation results as a Chinese PDF. Never executes strategy code."""
import io
import json
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from xml.sax.saxutils import escape
from urllib.parse import urlsplit, unquote

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether,
)

FONT = "QmtReportSans"
NAVY = colors.HexColor("#153d70")
BLUE = colors.HexColor("#245d9e")
INK = colors.HexColor("#364d68")
MUTED = colors.HexColor("#7b8fa8")
LINE = colors.HexColor("#e2eaf4")
PALE = colors.HexColor("#f0f5fc")
RED = colors.HexColor("#a8485b")
CST = timezone(timedelta(hours=8))
LABELS = {"ma_cross": "双均线趋势", "momentum": "动量突破", "mean_reversion": "均值回归"}
STATUS = {"pass": "已通过", "fail": "未通过", "pending": "待验收"}


def text(value):
    return escape(str(value)).replace("\n", "<br/>")


def timestamp(value):
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(CST).strftime("%Y-%m-%d %H:%M:%S") + "（北京时间）"
    except (ValueError, TypeError):
        return str(value)


def make_report(artifact):
    font_path = Path(__file__).resolve().parents[1] / "assets/fonts/QmtReportSans-Regular.ttf"
    pdfmetrics.registerFont(TTFont(FONT, str(font_path)))
    pdfmetrics.registerFontFamily(FONT, normal=FONT, bold=FONT, italic=FONT, boldItalic=FONT)
    styles = {
        "body": ParagraphStyle("body", fontName=FONT, fontSize=9.5, leading=16, textColor=INK, wordWrap="CJK", splitLongWords=True, spaceAfter=6),
        "small": ParagraphStyle("small", fontName=FONT, fontSize=8.3, leading=13.5, textColor=MUTED, wordWrap="CJK", splitLongWords=True),
        "title": ParagraphStyle("title", fontName=FONT, fontSize=23, leading=32, textColor=NAVY, spaceAfter=7),
        "heading": ParagraphStyle("heading", fontName=FONT, fontSize=12.5, leading=20, textColor=BLUE, spaceBefore=12, spaceAfter=8, keepWithNext=True),
        "cell": ParagraphStyle("cell", fontName=FONT, fontSize=8.7, leading=14, textColor=INK, wordWrap="CJK", splitLongWords=True),
        "tableHead": ParagraphStyle("tableHead", fontName=FONT, fontSize=9, leading=14, textColor=colors.white, wordWrap="CJK"),
    }
    def p(value, style="body"):
        return Paragraph(text(value), styles[style])

    spec, report = artifact["spec"], artifact["report"]
    checks = report["checks"]
    passed = sum(c["status"] == "pass" for c in checks)
    failed = sum(c["status"] == "fail" for c in checks)
    pending = sum(c["status"] == "pending" for c in checks)
    good = report["passed"] and not failed
    now = artifact.get("reportGeneratedAt") or datetime.now(timezone.utc).isoformat()
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=42, rightMargin=42, topMargin=62, bottomMargin=46,
        title="脚本校验报告 - " + spec["name"], author="东吴证券 · QMT 策略工坊", subject="策略规格、静态检查结果与客户端待验收事项", pageCompression=1)
    width = A4[0] - 84
    story = [p("脚本校验报告", "title"), p(spec["name"]), Spacer(1, 9)]
    conclusion = "静态规则校验通过" if good else "静态规则校验未通过"
    status = Table([[p(conclusion), p("通过 %d 项  /  未通过 %d 项  /  待验收 %d 项" % (passed, failed, pending), "small")]], colWidths=[width * .47, width * .53])
    status.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), PALE if good else colors.HexColor("#fff2f4")), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12), ("TOPPADDING", (0, 0), (-1, -1), 12), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    story.extend([status, Spacer(1, 13)])
    provider = "智能理解需求 + 固定模板生成" if artifact["provider"] == "codex" else "固定模板生成"
    meta = [
        [p("脚本编号", "small"), p(artifact["id"], "cell")],
        [p("脚本生成时间", "small"), p(timestamp(artifact["createdAt"]), "cell")],
        [p("报告导出时间", "small"), p(timestamp(now), "cell")],
        [p("生成方式", "small"), p(provider, "cell")],
    ]
    table = Table(meta, colWidths=[92, width - 92], hAlign="LEFT")
    table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    story.extend([table, p("一、策略说明", "heading"), p(artifact["summary"]), p("二、关键参数", "heading")])
    parameters = [
        ["股票代码", spec["symbol"], "策略类型", LABELS[spec["kind"]]],
        ["运行环境", "QMT 内置 Python", "行情周期", "日线"],
        ["短周期", str(spec["fastWindow"]) + " 天" if spec["kind"] == "ma_cross" else "不适用", "长周期", str(spec["slowWindow"]) + " 天"],
        ["动量 / 偏离阈值", "%g%%" % (spec["threshold"] * 100) if spec["kind"] != "ma_cross" else "不适用", "仓位预算上限", "%g%%" % spec["maxPositionPct"]],
        ["单笔委托上限" if spec["execution"] == "live" else "单笔买入上限", "人民币 {:,.0f} 元".format(spec["maxOrderValue"]), "执行方式", {"signal": "仅输出信号", "backtest": "历史回测虚拟下单", "live": "实盘脚本（默认关闭，本地启用）"}[spec["execution"]]],
    ]
    table = Table([[p(c, "cell") for c in row] for row in parameters], colWidths=[87, 162, 90, width - 339], hAlign="LEFT")
    table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BACKGROUND", (0, 0), (0, -1), PALE), ("BACKGROUND", (2, 0), (2, -1), PALE), ("GRID", (0, 0), (-1, -1), .5, LINE), ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    story.extend([table, p("三、默认值与适用条件", "heading")])
    for index, assumption in enumerate(artifact.get("assumptions", []), 1):
        story.append(p("%d. %s" % (index, assumption)))
    story.extend([Spacer(1, 6), p(report["scope"]), PageBreak(), p("四、校验结果", "heading"), p("以下为脚本生成时保存的静态检查结果；导出前已核对源码完整性。", "small"), Spacer(1, 10)])
    rows = [[p("检查项目", "tableHead"), p("结果", "tableHead"), p("检查说明", "tableHead")]]
    for check in checks:
        result_style = ParagraphStyle("result", parent=styles["cell"], textColor=RED if check["status"] == "fail" else BLUE if check["status"] == "pass" else MUTED)
        rows.append([p(check["name"], "cell"), Paragraph(text(STATUS.get(check["status"], check["status"])), result_style), p(check["detail"], "cell")])
    table = Table(rows, colWidths=[120, 52, width - 172], repeatRows=1, hAlign="LEFT")
    commands = [("VALIGN", (0, 0), (-1, -1), "TOP"), ("BACKGROUND", (0, 0), (-1, 0), BLUE), ("LINEBELOW", (0, 0), (-1, 0), .7, BLUE), ("LINEBELOW", (0, 1), (-1, -1), .4, LINE), ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]
    for index, check in enumerate(checks, 1):
        if check["status"] == "pending":
            commands.append(("BACKGROUND", (0, index), (-1, index), PALE))
        elif check["status"] == "fail":
            commands.append(("BACKGROUND", (0, index), (-1, index), colors.HexColor("#fff2f4")))
    table.setStyle(TableStyle(commands))
    story.extend([table, Spacer(1, 8), p("校验器 Python 版本：" + report["pythonVersion"], "small"), p("源码 SHA-256（UTF-8）：" + report["codeHash"], "small"), p("该摘要对应 UTF-8 源码；下载的 .py 文件实际编码为 GBK。", "small"), p("五、官方文档依据", "heading")])
    snapshot_id = artifact.get("retrieval", {}).get("snapshotId") or next((s.get("snapshotId") for s in artifact.get("sources", []) if s.get("snapshotId")), None)
    if snapshot_id:
        story.append(p("文档快照 SHA-256：" + snapshot_id, "small"))
        story.append(p("以下保存本次使用的章节、连续原文摘录与片段摘要；引用不代表已通过客户端验证。", "small"))
    if artifact.get("retrieval", {}).get("queries"):
        story.append(p("AI 文档查询：" + "；".join(artifact["retrieval"]["queries"]), "small"))
    for source in artifact.get("sources", []):
        content = [p(source["title"] + " · " + source["section"], "cell")]
        if source.get("chunkId"):
            content.append(p(("AI 引用" if source.get("citationKind") == "ai" else "模板依据") + " · " + source["chunkId"], "small"))
            content.append(p(source["summary"], "cell"))
        if source.get("excerpt"):
            content.append(p("原文摘录：" + source["excerpt"], "small"))
        url = str(source["url"])
        if url.startswith("https://knowledge.thinktrader.net/"):
            safe_url = escape(url, {'"': "&quot;"})
            content.append(Paragraph('<link href="%s" color="#245d9e">%s</link>' % (safe_url, text(url.split("#")[0])), styles["small"]))
            if urlsplit(url).fragment:
                content.append(p("章节锚点：" + unquote(urlsplit(url).fragment), "small"))
        else:
            content.append(p(url, "small"))
        content.append(p(("文档采集日期：" if source.get("snapshotId") else "文档核对日期：") + source["reviewedAt"], "small"))
        if source.get("contentHash") and source.get("chunkId"):
            content.append(p("片段 SHA-256：" + source["contentHash"], "small"))
        story.append(KeepTogether(content + [Spacer(1, 7)]))
    story.extend([Spacer(1, 4), p("使用说明：静态规则检查不能替代真实客户端回测与业务验收。本报告不证明策略收益，也不证明脚本已具备实盘使用条件。", "small")])

    def decorate(canvas, document):
        canvas.saveState()
        canvas.setFont(FONT, 9)
        canvas.setFillColor(NAVY)
        canvas.drawString(42, A4[1] - 30, "东吴证券 · QMT 策略工坊")
        canvas.setFont(FONT, 8)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(A4[0] - 42, A4[1] - 30, "策略研究 / 校验记录")
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(.6)
        canvas.line(42, A4[1] - 41, A4[0] - 42, A4[1] - 41)
        canvas.line(42, 38, A4[0] - 42, 38)
        canvas.setFont(FONT, 7.5)
        canvas.drawString(42, 25, "脚本编号：" + artifact["id"])
        canvas.drawRightString(A4[0] - 42, 25, "第 %d 页" % document.page)
        canvas.restoreState()

    doc.build(story, onFirstPage=decorate, onLaterPages=decorate)
    return buffer.getvalue()


if __name__ == "__main__":
    payload = json.load(sys.stdin)
    sys.stdout.buffer.write(make_report(payload))
