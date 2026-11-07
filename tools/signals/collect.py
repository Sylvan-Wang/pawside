"""Pawside 信号采集器（只采集和清洗，不调用任何 AI 模型）。

参照 ai_companion_signal_agent 的 collect → clean 两步，去掉了 LLM 分析：
分析由每天 20:30（北京）的 Claude 例程按 docs/auto-iteration/SIGNAL_METHOD.md 完成。

数据来源（全部公开、免登录）：
  1. Reddit：先试公开 JSON，失败再试 RSS（old.reddit.com/.rss）
  2. App Store 竞品评论（公开 RSS）
  3. 行业新闻 RSS

每个来源的成败都记在 source_health 里，被封或改版时报告里一眼能看到。

用法：
  python tools/signals/collect.py                 # 采集，写到 tools/signals/out/
  python tools/signals/collect.py --sample        # 用内置样例跑一遍清洗（离线自测）
  python tools/signals/collect.py --out DIR --date 2026-11-08
"""

from __future__ import annotations

import argparse
import calendar
import hashlib
import json
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import yaml

HERE = Path(__file__).parent
UA = "pawside-signals/0.1 (public read-only research; +https://github.com/Sylvan-Wang/pawside)"
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

LOW_SIGNAL = re.compile(r"^(lol|same|cool|this|wow|nice|true|yes|no|agreed?)\W*$", re.I)
BOT_MARKERS = ("i am a bot", "i'm a bot", "this action was performed automatically", "automoderator")
USER_MENTION = re.compile(r"/?u/[A-Za-z0-9_-]+")


# ─── helpers ────────────────────────────────────────────────────────────────

def load_config() -> dict:
    with open(HERE / "config" / "sources.yml", encoding="utf-8") as f:
        return yaml.safe_load(f)


def match_keyword(text: str, keywords: list[str]) -> str | None:
    low = text.lower()
    for kw in keywords:
        if kw.lower() in low:
            return kw
    return None


def strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = re.sub(r"&nbsp;|&#32;", " ", text)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"&quot;", '"', text)
    text = re.sub(r"&#39;", "'", text)
    text = re.sub(r"&lt;", "<", text)
    text = re.sub(r"&gt;", ">", text)
    text = re.sub(r"\s*submitted by\s+/u/\S+.*$", "", text, flags=re.S)
    return re.sub(r"\s+", " ", text).strip()


def anonymize(text: str) -> str:
    return USER_MENTION.sub("[user]", text)


class Health:
    """Per-source success/failure log, shown at the top of every report."""

    def __init__(self) -> None:
        self.rows: list[dict] = []

    def add(self, source: str, target: str, method: str, status: str, items: int) -> None:
        self.rows.append({"source": source, "target": target, "method": method,
                          "status": status, "items": items})


# ─── Reddit ─────────────────────────────────────────────────────────────────

def _reddit_json(session, sub: str) -> list[dict] | None:
    try:
        r = session.get(f"https://www.reddit.com/r/{sub}/new.json",
                        params={"limit": 50, "raw_json": 1},
                        headers={"User-Agent": BROWSER_UA, "Accept": "application/json"}, timeout=15)
    except Exception:
        return None
    if r.status_code != 200:
        return None
    try:
        children = r.json().get("data", {}).get("children", [])
    except ValueError:
        return None
    out = []
    for c in children:
        p = c.get("data", {})
        out.append({
            "id": p.get("id", ""),
            "title": p.get("title", ""),
            "body": p.get("selftext", ""),
            "score": p.get("score"),
            "num_comments": p.get("num_comments"),
            "created": float(p.get("created_utc", 0)),
            "url": "https://reddit.com" + p.get("permalink", ""),
        })
    return out


def _reddit_rss(sub: str) -> list[dict] | None:
    import feedparser
    for host in ("https://old.reddit.com", "https://www.reddit.com"):
        feed = feedparser.parse(f"{host}/r/{sub}/new/.rss", request_headers={"User-Agent": UA})
        status = getattr(feed, "status", 0)
        if status == 200 and feed.entries:
            out = []
            for e in feed.entries:
                t = e.get("updated_parsed") or e.get("published_parsed")
                body = ""
                if e.get("content"):
                    body = e["content"][0].get("value", "")
                out.append({
                    "id": (e.get("id") or e.get("link", "")).split("/")[-1] or e.get("link", ""),
                    "title": e.get("title", ""),
                    "body": strip_html(body or e.get("summary", "")),
                    "score": None,          # RSS 不带分数
                    "num_comments": None,
                    "created": calendar.timegm(t) if t else 0,
                    "url": e.get("link", ""),
                })
            return out
    return None


def collect_reddit(cfg: dict, health: Health, cutoff: float) -> list[dict]:
    import requests
    session = requests.Session()
    exclusions = cfg.get("exclusion_keywords", [])
    cache: dict[str, tuple[str, list[dict]]] = {}
    posts: dict[str, dict] = {}

    for track, tcfg in cfg["tracks"].items():
        for sub in tcfg["subreddits"]:
            if sub not in cache:
                raw = _reddit_json(session, sub)
                method = "json"
                if raw is None:
                    time.sleep(1.0)
                    raw = _reddit_rss(sub)
                    method = "rss"
                if raw is None:
                    health.add("reddit", f"r/{sub}", "json+rss", "blocked_or_failed", 0)
                    cache[sub] = ("failed", [])
                else:
                    health.add("reddit", f"r/{sub}", method, "ok", len(raw))
                    cache[sub] = (method, raw)
                time.sleep(2.0)   # be polite
            method, raw = cache[sub]
            for p in raw:
                if p["created"] and p["created"] < cutoff:
                    continue
                text = f"{p['title']} {p['body']}"
                kw = match_keyword(text, tcfg["keywords"])
                if not kw or match_keyword(text, exclusions):
                    continue
                key = f"reddit:{p['id']}"
                if key in posts:
                    if track not in posts[key]["tracks"]:
                        posts[key]["tracks"].append(track)
                    continue
                posts[key] = {
                    "id": key, "source": "reddit", "where": f"r/{sub}", "via": method,
                    "tracks": [track], "matched": kw,
                    "title": p["title"], "body": p["body"],
                    "score": p["score"], "num_comments": p["num_comments"],
                    "created_utc": datetime.fromtimestamp(p["created"], tz=timezone.utc).isoformat() if p["created"] else None,
                    "url": p["url"],
                }
    return list(posts.values())


# ─── App Store reviews ──────────────────────────────────────────────────────

def collect_app_reviews(cfg: dict, health: Health) -> list[dict]:
    import requests
    out = []
    for app in cfg.get("app_store_apps", []):
        url = f"https://itunes.apple.com/us/rss/customerreviews/id={app['apple_id']}/sortBy=mostRecent/json"
        try:
            r = requests.get(url, headers={"User-Agent": UA}, timeout=15)
            entries = r.json().get("feed", {}).get("entry", []) if r.status_code == 200 else []
        except Exception:
            entries = []
        if isinstance(entries, dict):
            entries = [entries]
        reviews = [e for e in entries if "im:rating" in e]
        health.add("app_store", app["name"], "rss", "ok" if reviews else "empty_or_failed", len(reviews))
        for e in reviews[:30]:
            rid = e.get("id", {}).get("label", "")
            out.append({
                "id": f"appstore:{app['name']}:{rid}", "source": "app_store", "where": app["name"],
                "via": "rss", "tracks": ["apps_and_pricing"], "matched": app["name"],
                "title": e.get("title", {}).get("label", ""),
                "body": e.get("content", {}).get("label", ""),
                "score": int(e.get("im:rating", {}).get("label", 0) or 0),  # 星级 1–5
                "num_comments": None,
                "created_utc": e.get("updated", {}).get("label"),
                "url": f"https://apps.apple.com/us/app/id{app['apple_id']}",
            })
        time.sleep(0.5)
    return out


# ─── News ───────────────────────────────────────────────────────────────────

def collect_news(cfg: dict, health: Health, cutoff: float) -> list[dict]:
    import feedparser
    out = []
    kws = cfg.get("news_keywords", [])
    for feed_cfg in cfg.get("news_feeds", []):
        feed = feedparser.parse(feed_cfg["url"], request_headers={"User-Agent": UA})
        ok = bool(feed.entries)
        kept = 0
        for e in feed.entries:
            t = e.get("published_parsed") or e.get("updated_parsed")
            ts = calendar.timegm(t) if t else 0
            if ts and ts < cutoff:
                continue
            text = f"{e.get('title', '')} {strip_html(e.get('summary', ''))}"
            kw = match_keyword(text, kws)
            if not kw:
                continue
            kept += 1
            out.append({
                "id": "news:" + hashlib.sha1(e.get("link", "").encode()).hexdigest()[:12],
                "source": "news", "where": feed_cfg["name"], "via": "rss",
                "tracks": ["industry_news"], "matched": kw,
                "title": e.get("title", ""), "body": strip_html(e.get("summary", "")),
                "score": None, "num_comments": None,
                "created_utc": datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts else None,
                "url": e.get("link", ""),
            })
        health.add("news", feed_cfg["name"], "rss", "ok" if ok else "failed", kept)
    return out


# ─── Clean ──────────────────────────────────────────────────────────────────

def clean(items: list[dict], cfg: dict) -> tuple[list[dict], dict]:
    max_chars = cfg.get("max_body_chars", 1200)
    min_chars = cfg.get("min_text_chars", 60)
    stats = {"raw": len(items), "duplicate": 0, "deleted": 0, "bot": 0, "too_short": 0, "low_signal": 0}
    seen_text: set[str] = set()
    kept = []
    for it in items:
        body = (it.get("body") or "").strip()
        title = (it.get("title") or "").strip()
        if body in ("[deleted]", "[removed]") and not title:
            stats["deleted"] += 1
            continue
        text = f"{title} {body}".strip()
        low = text.lower()
        if any(m in low for m in BOT_MARKERS):
            stats["bot"] += 1
            continue
        if LOW_SIGNAL.match(body or title):
            stats["low_signal"] += 1
            continue
        if len(text) < min_chars:
            stats["too_short"] += 1
            continue
        fp = hashlib.sha1(re.sub(r"\W+", "", low)[:300].encode()).hexdigest()
        if fp in seen_text:
            stats["duplicate"] += 1
            continue
        seen_text.add(fp)
        it = dict(it)
        it["title"] = anonymize(title)
        it["body"] = anonymize(body)[:max_chars]
        kept.append(it)
    stats["kept"] = len(kept)
    return kept, stats


# ─── Output ─────────────────────────────────────────────────────────────────

def render_markdown(run_date: str, items: list[dict], stats: dict, health: Health, cfg: dict) -> str:
    lines = [f"# 信号原始数据 {run_date}", "",
             "由 `tools/signals/collect.py` 生成，只做了采集和清洗，**还没有分析**。"
             "分析方法见 `docs/auto-iteration/SIGNAL_METHOD.md`。", ""]
    ok = sum(1 for r in health.rows if r["status"] == "ok")
    lines += [f"## 来源健康（{ok}/{len(health.rows)} 正常）", "",
              "| 来源 | 目标 | 方式 | 状态 | 条数 |", "|---|---|---|---|---|"]
    for r in health.rows:
        lines.append(f"| {r['source']} | {r['target']} | {r['method']} | {r['status']} | {r['items']} |")
    lines += ["", "## 清洗统计", "", "，".join(f"{k} {v}" for k, v in stats.items()), ""]
    by_track: dict[str, list[dict]] = {}
    for it in items:
        for t in it["tracks"]:
            by_track.setdefault(t, []).append(it)
    lines += ["## 各赛道条数", ""]
    for t in list(cfg["tracks"].keys()) + ["industry_news"]:
        n = len(by_track.get(t, []))
        lines.append(f"- {t}: {n}" + ("  ⚠️ 没有数据" if n == 0 else ""))
    lines += ["", "## 条目", ""]
    for it in items:
        score = "" if it["score"] is None else f" · {'★' if it['source'] == 'app_store' else '↑'}{it['score']}"
        lines.append(f"### [{it['title'][:120] or '(无标题)'}]({it['url']})")
        lines.append(f"{it['where']} · {', '.join(it['tracks'])} · 命中「{it['matched']}」{score}")
        if it["body"]:
            lines.append("")
            lines.append("> " + it["body"][:500].replace("\n", " "))
        lines.append("")
    return "\n".join(lines)


SAMPLE = [
    {"id": "reddit:s1", "source": "reddit", "where": "r/Fitness", "via": "sample", "tracks": ["beginner_consistency"],
     "matched": "consistent", "title": "How do you stay consistent when you don't know what to do at the gym?",
     "body": "I keep starting and stopping. Every time I walk in I spend 10 minutes deciding what to do and then leave. u/someone said get a program but which one?",
     "score": 42, "num_comments": 30, "created_utc": None, "url": "https://reddit.com/r/Fitness/sample1"},
    {"id": "reddit:s2", "source": "reddit", "where": "r/Fitness", "via": "sample", "tracks": ["beginner_consistency"],
     "matched": "consistent", "title": "How do you stay consistent when you don't know what to do at the gym?",
     "body": "I keep starting and stopping. Every time I walk in I spend 10 minutes deciding what to do and then leave. u/someone said get a program but which one?",
     "score": 42, "num_comments": 30, "created_utc": None, "url": "https://reddit.com/r/Fitness/sample1-dupe"},
    {"id": "reddit:s3", "source": "reddit", "where": "r/loseit", "via": "sample", "tracks": ["diet_tracking"],
     "matched": "lol", "title": "lol", "body": "", "score": 1, "num_comments": 0, "created_utc": None, "url": "https://reddit.com/x"},
]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(HERE / "out"))
    ap.add_argument("--date", default=None)
    ap.add_argument("--sample", action="store_true", help="offline self-test on built-in sample")
    args = ap.parse_args(argv)

    cfg = load_config()
    run_date = args.date or datetime.now(timezone(timedelta(hours=8))).date().isoformat()  # 北京日期
    cutoff = time.time() - cfg.get("lookback_hours", 48) * 3600
    health = Health()

    if args.sample:
        raw = SAMPLE
        health.add("sample", "built-in", "none", "ok", len(raw))
    else:
        raw = collect_reddit(cfg, health, cutoff)
        raw += collect_app_reviews(cfg, health)
        raw += collect_news(cfg, health, cutoff)

    items, stats = clean(raw, cfg)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    payload = {"run_date": run_date, "generated_at": datetime.now(timezone.utc).isoformat(),
               "source_health": health.rows, "cleaning": stats, "items": items}
    (out / f"{run_date}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / f"{run_date}.md").write_text(render_markdown(run_date, items, stats, health, cfg), encoding="utf-8")

    ok = sum(1 for r in health.rows if r["status"] == "ok")
    print(f"[signals] {run_date}: kept {stats['kept']}/{stats['raw']} items; sources ok {ok}/{len(health.rows)}")
    if args.sample:
        assert stats["kept"] == 1 and stats["duplicate"] == 1 and stats["low_signal"] + stats["too_short"] == 1, stats
        assert "[user]" in items[0]["body"] and "u/someone" not in items[0]["body"]
        print("[signals] sample self-test passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
