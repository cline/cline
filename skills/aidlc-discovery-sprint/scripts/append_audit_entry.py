#!/usr/bin/env python3
"""Append a formatted entry to aidlc-docs/audit.md."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_text(inline_value: str | None, file_value: str | None) -> str:
    if inline_value and file_value:
        raise ValueError("Use either the inline value or the file value, not both.")
    if file_value:
        return Path(file_value).read_text()
    return inline_value or ""


def quote_markdown(value: str) -> str:
    return json.dumps(value, ensure_ascii=True)


def build_entry(section: str, timestamp: str, user_input: str, ai_response: str, context: str) -> str:
    lines = [
        f"## {section}",
        f"**Timestamp**: {timestamp}",
    ]
    if user_input:
        lines.append(f"**User Input**: {quote_markdown(user_input)}")
    lines.extend(
        [
            f"**AI Response**: {ai_response}",
            f"**Context**: {context}",
            "",
            "---",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Append an AIDLC audit log entry.")
    parser.add_argument("--audit-file", required=True, help="Path to audit.md")
    parser.add_argument("--section", required=True, help="Section heading for the entry")
    parser.add_argument("--timestamp", default=utc_now(), help="ISO 8601 timestamp")
    parser.add_argument("--user-input", help="Raw user input to record")
    parser.add_argument("--user-input-file", help="Read raw user input from a file")
    parser.add_argument("--ai-response", required=True, help="AI response or action summary")
    parser.add_argument("--context", required=True, help="Stage or action context")
    args = parser.parse_args()

    user_input = load_text(args.user_input, args.user_input_file)
    entry = build_entry(args.section, args.timestamp, user_input, args.ai_response, args.context)

    audit_path = Path(args.audit_file)
    if not audit_path.exists():
        raise FileNotFoundError(f"Audit file not found: {audit_path}")

    with audit_path.open("a", encoding="utf-8") as handle:
        if audit_path.stat().st_size > 0 and not audit_path.read_text().endswith("\n"):
            handle.write("\n")
        handle.write(entry)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
