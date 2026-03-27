#!/usr/bin/env python3
"""Append a lesson entry to the meta-knowledge base."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def bullet_lines(values: list[str]) -> list[str]:
    if not values:
        return ["- [TODO]"]
    return [f"- {value}" for value in values]


def build_entry(title: str, timestamp: str, lesson: str, evidence: list[str], targets: list[str], status: str) -> str:
    lines = [
        f"## {title}",
        f"**Timestamp**: {timestamp}",
        "**Evidence**:",
        *bullet_lines(evidence),
        "**Lesson**:",
        lesson,
        "**Targets**:",
        *bullet_lines(targets),
        f"**Status**: {status}",
        "",
        "---",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Append an insight to the meta knowledge base.")
    parser.add_argument("--knowledge-file", required=True, help="Path to knowledge-base.md")
    parser.add_argument("--title", required=True, help="Insight title")
    parser.add_argument("--lesson", required=True, help="Distilled lesson text")
    parser.add_argument("--evidence", action="append", default=[], help="Evidence item, repeatable")
    parser.add_argument("--target", action="append", default=[], help="Target item, repeatable")
    parser.add_argument("--status", default="proposed", help="Insight status")
    parser.add_argument("--timestamp", default=utc_now(), help="ISO 8601 timestamp")
    args = parser.parse_args()

    knowledge_path = Path(args.knowledge_file)
    if not knowledge_path.exists():
        raise FileNotFoundError(f"Knowledge file not found: {knowledge_path}")

    entry = build_entry(args.title, args.timestamp, args.lesson, args.evidence, args.target, args.status)
    with knowledge_path.open("a", encoding="utf-8") as handle:
        existing = knowledge_path.read_text()
        if existing and not existing.endswith("\n"):
            handle.write("\n")
        handle.write(entry)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
