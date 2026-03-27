#!/usr/bin/env python3
"""Append an improvement item to the meta backlog, or reconcile completed work."""

from __future__ import annotations

import argparse
import re
import subprocess
from datetime import datetime
from pathlib import Path


def _parse_open_items(text: str) -> list[dict]:
    """Extract uncompleted backlog items."""
    items = []
    for line in text.splitlines():
        m = re.match(r"^- \[ \] \[.*?\]\s+\*\*(\S+)\*\*:\s+(.+)$", line)
        if m:
            items.append({"id": m.group(1), "desc": m.group(2), "line": line})
    return items


def _recent_files(days: int = 7) -> list[str]:
    """Get files modified within N days via git or filesystem."""
    try:
        out = subprocess.check_output(
            ["git", "log", f"--since={days} days ago", "--diff-filter=ACM",
             "--name-only", "--pretty=format:"],
            text=True, stderr=subprocess.DEVNULL,
        )
        return [f for f in out.splitlines() if f.strip()]
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []


def _score(item_desc: str, filepath: str) -> float:
    """Simple keyword overlap score between item description and file path."""
    words = set(re.findall(r"[a-z]{3,}", item_desc.lower()))
    path_words = set(re.findall(r"[a-z]{3,}", filepath.lower()))
    if not words:
        return 0.0
    return len(words & path_words) / len(words)


def reconcile(backlog_path: Path, days: int, threshold: float) -> int:
    text = backlog_path.read_text(encoding="utf-8")
    open_items = _parse_open_items(text)
    if not open_items:
        print("✅ No open backlog items found.")
        return 0

    recent = _recent_files(days)
    if not recent:
        print("ℹ️  No recently modified files found.")
        return 0

    matches = []
    for item in open_items:
        best_file, best_score = "", 0.0
        for f in recent:
            s = _score(item["desc"], f)
            if s > best_score:
                best_score, best_file = s, f
        if best_score >= threshold:
            matches.append({**item, "file": best_file, "score": best_score})

    if not matches:
        print("✅ No potential matches found between open items and recent files.")
        return 0

    print(f"🔍 Potential matches found ({len(matches)}):\n")
    for m in matches:
        print(f"  {m['id']} \"{m['desc'][:60]}...\"")
        print(f"    ↔ {m['file']} (score: {m['score']:.2f})")
        ans = input("  Mark as complete? [y/N] ").strip().lower()
        if ans == "y":
            today = datetime.now().strftime("%Y-%m-%d")
            old = m["line"]
            new = old.replace("- [ ]", "- [x]", 1).rstrip()
            new += f" (reconciled {today})"
            text = text.replace(old, new, 1)
            print(f"    ✅ {m['id']} marked complete.\n")
        else:
            print(f"    ⏭️  Skipped.\n")

    backlog_path.write_text(text, encoding="utf-8")
    return 0


def append(backlog_path: Path, category: str, target: str, summary: str) -> int:
    if not backlog_path.exists():
        raise FileNotFoundError(f"Backlog file not found: {backlog_path}")
    line = f"- [ ] [{category}] `{target}`: {summary}\n"
    with backlog_path.open("a", encoding="utf-8") as handle:
        existing = backlog_path.read_text()
        if existing and not existing.endswith("\n"):
            handle.write("\n")
        handle.write(line)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage improvement-backlog.md items.")
    sub = parser.add_subparsers(dest="command")

    # append subcommand (original behavior)
    ap = sub.add_parser("append", help="Append an item to the backlog.")
    ap.add_argument("--backlog-file", required=True)
    ap.add_argument("--category", required=True)
    ap.add_argument("--target", required=True)
    ap.add_argument("--summary", required=True)

    # reconcile subcommand
    rp = sub.add_parser("reconcile", help="Find open items matching recent work.")
    rp.add_argument("--backlog-file", required=True)
    rp.add_argument("--days", type=int, default=7, help="Look back N days (default: 7)")
    rp.add_argument("--threshold", type=float, default=0.25, help="Min match score (default: 0.25)")

    # backward compat: flat --backlog-file --category --target --summary
    parser.add_argument("--backlog-file", dest="compat_backlog", help=argparse.SUPPRESS)
    parser.add_argument("--category", dest="compat_category", help=argparse.SUPPRESS)
    parser.add_argument("--target", dest="compat_target", help=argparse.SUPPRESS)
    parser.add_argument("--summary", dest="compat_summary", help=argparse.SUPPRESS)
    parser.add_argument("--reconcile", action="store_true", help="Shortcut for reconcile subcommand")

    args = parser.parse_args()

    # --reconcile flag shortcut
    if args.reconcile:
        bf = args.compat_backlog or "aidlc-docs/meta-knowledge/improvement-backlog.md"
        return reconcile(Path(bf), days=7, threshold=0.25)

    if args.command == "reconcile":
        return reconcile(Path(args.backlog_file), args.days, args.threshold)

    if args.command == "append":
        return append(Path(args.backlog_file), args.category, args.target, args.summary)

    # backward compat: no subcommand, flat args
    if args.compat_backlog and args.compat_category:
        return append(Path(args.compat_backlog), args.compat_category,
                       args.compat_target, args.compat_summary)

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
