import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("sync_docs", Path(__file__).resolve().parents[1] / "scripts/sync-qmt-docs.py")
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class SyncCases(unittest.TestCase):
    def test_real_markup_keeps_heading_code_and_tables(self):
        html = '''<nav>不应进入正文</nav><article class="doc-content article"><h1>行情函数</h1>
        <h3 id="测试"><a class="header-anchor"><span>行情接口</span></a></h3>
        <p>参数说明''' + "正文内容与参数。" * 20 + '''</p><table><tr><td>m_nCanUseVolume</td><td>可卖持仓</td></tr></table>
        <div class="snippet"><span class="code-gutter">qmt://docs/python</span><div class="row"><span class="code-gutter gutter">1</span><code class="code">def init(C):</code></div><div class="row"><span class="code-gutter gutter">2</span><code class="code">    pass</code></div></div>
        <img src="/image.png" alt="操作界面"><script>evil()</script></article>'''
        title, sections, _ = sync.parse_page(html, sync.SEED)
        self.assertEqual(title, "行情函数")
        self.assertEqual(sections[0]["heading"], "行情函数 > 行情接口")
        self.assertEqual(sections[0]["anchor"], "测试")
        text = sections[0]["text"]
        self.assertIn("m_nCanUseVolume | 可卖持仓 |", text)
        self.assertIn("def init(C):\n    pass", text)
        self.assertNotIn("1def", text)
        self.assertNotIn("不应进入正文", text)
        self.assertNotIn("evil()", text)
        self.assertIn("https://knowledge.thinktrader.net/image.png", text)

    def test_allowlist_and_missing_article(self):
        self.assertTrue(sync.official(sync.SEED))
        self.assertFalse(sync.official("https://evil.invalid/docs/python/test.html"))
        self.assertFalse(sync.official("https://knowledge.thinktrader.net/docs/python/../secret.html"))
        with self.assertRaises(ValueError):
            sync.parse_page("<html>错误页面</html>", sync.SEED)

    def test_failed_sync_preserves_previous_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dest = root / "corpus.json"
            dest.write_text("keep-existing", encoding="utf-8")
            with patch.object(sync, "ROOT", root), patch.object(sync, "DEST", dest), patch.object(sync, "fetch", side_effect=OSError("offline")):
                with self.assertRaises(SystemExit):
                    sync.main()
            self.assertEqual(dest.read_text(encoding="utf-8"), "keep-existing")
            self.assertIn("offline", (root / ".runtime/docs-sync-status.json").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
