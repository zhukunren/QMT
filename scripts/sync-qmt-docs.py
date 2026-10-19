"""Snapshot the official built-in Python manual. Standard library only; no JS execution.

All discovered /docs/python/*.html pages must succeed before the snapshot is replaced.
Images are retained as source links; image pixels and external manuals are not indexed.
"""
import hashlib
import json
import re
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urldefrag, quote
from urllib.request import Request, urlopen

BASE = "https://knowledge.thinktrader.net"
SEED = BASE + "/docs/python/start_now.html"
ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "apps/api/assets/qmt-docs/corpus.json"
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
BLOCK = {"p", "div", "li", "ul", "ol", "tr", "table", "pre", "blockquote", "details", "summary"}


class Node:
    def __init__(self, tag="root", attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []

    def descendants(self):
        yield self
        for child in self.children:
            if isinstance(child, Node):
                yield from child.descendants()


class Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                break

    def handle_data(self, value):
        self.stack[-1].children.append(value)


def ignored(node):
    classes = node.attrs.get("class", "").split()
    return node.tag in {"script", "style", "button", "nav", "svg"} or bool(set(classes) & {"code-gutter", "line-numbers", "line-number", "copy-code-button"})


def render(node, url):
    if isinstance(node, str):
        return node
    if ignored(node):
        return ""
    if "snippet" in node.attrs.get("class", "").split():
        lines = [render(n, url) for n in node.descendants() if n.tag == "code" and "code" in n.attrs.get("class", "").split()]
        if lines:
            return "\n```python\n" + "\n".join(lines) + "\n```\n"
    if node.tag == "img":
        return "\n[图片：%s %s]\n" % (node.attrs.get("alt", ""), urljoin(url, node.attrs.get("src", "")))
    if node.tag == "br":
        return "\n"
    text = "".join(render(child, url) for child in node.children)
    if node.tag in {"td", "th"}:
        return text + " | "
    if node.tag in BLOCK:
        return "\n" + text + "\n"
    return text


def clean(text):
    text = text.replace("\u200b", "").replace("\xa0", " ")
    return re.sub(r"\n{3,}", "\n\n", "\n".join(line.rstrip() for line in text.splitlines())).strip()


def parse_page(html, url):
    parser = Parser()
    parser.feed(html)
    nodes = list(parser.root.descendants())
    content = next((n for n in nodes if {"theme-default-content", "vp-doc", "doc-content"} & set(n.attrs.get("class", "").split())), None)
    if content is None:
        raise ValueError("Official article container missing: " + url)
    sections, headings, body = [], [], []
    current_anchor = ""

    def flush():
        text = clean("".join(body))
        if text and headings:
            sections.append({"heading": " > ".join(h[1] for h in headings), "anchor": current_anchor, "text": text})
        body.clear()

    def walk(node):
        nonlocal current_anchor
        if isinstance(node, str):
            body.append(node)
            return
        if ignored(node):
            return
        if re.fullmatch(r"h[1-6]", node.tag):
            flush()
            level = int(node.tag[1])
            while headings and headings[-1][0] >= level:
                headings.pop()
            headings.append((level, clean(render(node, url))))
            current_anchor = node.attrs.get("id", "")
            return
        if node.tag in {"pre", "table", "img"} or "snippet" in node.attrs.get("class", "").split():
            body.append(render(node, url))
            return
        if node.tag in BLOCK:
            body.append("\n")
        for child in node.children:
            walk(child)
        if node.tag in BLOCK:
            body.append("\n")

    walk(content)
    flush()
    h1 = next((n for n in content.descendants() if n.tag == "h1"), None)
    title = clean(render(h1, url)) if h1 else ""
    if not title or sum(len(s["text"]) for s in sections) < 100:
        raise ValueError("Empty or invalid article: " + url)
    links = sorted({urldefrag(urljoin(url, n.attrs["href"]))[0] for n in nodes if n.tag == "a" and n.attrs.get("href")})
    return title, sections, links


def official(url):
    parts = urlsplit(url)
    return parts.scheme == "https" and parts.netloc == "knowledge.thinktrader.net" and bool(re.fullmatch(r"/docs/python/[a-z_]+\.html", parts.path))


def fetch(url):
    for attempt in range(5):
        try:
            with urlopen(Request(url, headers={"User-Agent": "QMT-Studio-Docs-Sync/1.0"}), timeout=20) as response:
                if not official(response.url):
                    raise ValueError("Unexpected redirect: " + response.url)
                raw = response.read(12 * 1024 * 1024 + 1)
                if len(raw) > 12 * 1024 * 1024:
                    raise ValueError("Article exceeds size limit")
                return raw.decode("utf-8")
        except Exception:
            if attempt == 4:
                raise
            time.sleep(min(attempt + 1, 3))


def split_text(text, size=2600, overlap=200):
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            newline = text.rfind("\n", start + size // 2, end)
            if newline > start:
                end = newline
        yield text[start:end]
        if end == len(text):
            break
        start = max(start + 1, end - overlap)


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def main():
    pending, seen, pages, chunks, failures = [SEED], set(), [], [], []
    fetched_at = datetime.now(timezone.utc).isoformat()
    while pending:
        url = pending.pop(0)
        if url in seen:
            continue
        seen.add(url)
        if len(seen) > 80:
            raise ValueError("Discovery exceeded the built-in Python manual scope")
        try:
            title, sections, links = parse_page(fetch(url), url)
            page_id = "qmt-" + urlsplit(url).path.rsplit("/", 1)[-1][:-5].replace("_", "-")
            article = "\n\n".join(s["heading"] + "\n" + s["text"] for s in sections)
            page = {"id": page_id, "title": "迅投 QMT · " + title, "url": url, "sectionCount": len(sections), "characters": len(article), "contentHash": digest(article), "fetchedAt": fetched_at}
            pages.append(page)
            for index, section in enumerate(sections):
                for part, text in enumerate(split_text(section["text"])):
                    chunks.append({"id": f"{page_id}:{index}:{part}", "pageId": page_id, "heading": section["heading"], "url": url + ("#" + quote(section["anchor"], safe="-_.~") if section["anchor"] else ""), "text": text, "contentHash": digest(text)})
            pending.extend(link for link in links if official(link) and link not in seen)
            print(f"OK {title}: {len(sections)} sections", flush=True)
        except Exception as error:
            failures.append({"url": url, "error": str(error)})
            print("FAILED " + url + ": " + str(error), flush=True)
    report = {"fetchedAt": fetched_at, "discoveredPages": len(seen), "indexedPages": len(pages), "failures": failures}
    status_path = ROOT / ".runtime/docs-sync-status.json"
    status_path.parent.mkdir(parents=True, exist_ok=True)
    status_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if failures or len(pages) < 15:
        raise SystemExit("Incomplete sync; existing snapshot preserved. See .runtime/docs-sync-status.json")
    pages.sort(key=lambda p: p["url"])
    chunks.sort(key=lambda c: c["id"])
    snapshot = {"version": 1, "scope": "迅投官方 /docs/python/ 内置 Python 手册全部可发现 HTML 正文；图片保留链接，未做 OCR；不含外部站点、附件及 MiniQMT 手册。", "seedUrl": SEED, "snapshotId": digest("\n".join(p["contentHash"] for p in pages)), "fetchedAt": fetched_at, "discoveredPages": len(seen), "pages": pages, "chunks": chunks}
    DEST.parent.mkdir(parents=True, exist_ok=True)
    temporary = DEST.with_suffix(".tmp")
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(DEST)
    print(f"Saved {len(pages)} pages, {len(chunks)} chunks: {DEST}")


if __name__ == "__main__":
    main()
