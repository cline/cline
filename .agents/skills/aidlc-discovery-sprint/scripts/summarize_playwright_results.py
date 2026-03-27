#!/usr/bin/env python3
"""Summarize a Playwright JSON report into a markdown note."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


STATUSES = ("passed", "failed", "timedOut", "skipped", "interrupted")


def load_report(path: Path) -> dict:
    return json.loads(path.read_text())


def resolve_status(test: dict) -> str:
    results = test.get("results", [])
    statuses = [result.get("status") for result in results if result.get("status")]
    for preferred in ("failed", "timedOut", "interrupted", "passed", "skipped"):
        if preferred in statuses:
            return preferred
    return test.get("status") or "unknown"


def collect_specs(suite: dict, file_label: str | None = None) -> list[dict]:
    collected: list[dict] = []
    current_file = suite.get("file") or file_label
    for spec in suite.get("specs", []):
        title = " > ".join(part for part in [spec.get("title")] if part)
        for test in spec.get("tests", []):
            collected.append(
                {
                    "file": current_file or "unknown",
                    "title": title or "unknown",
                    "status": resolve_status(test),
                }
            )
    for child in suite.get("suites", []):
        collected.extend(collect_specs(child, current_file))
    return collected


def render_markdown(specs: list[dict], source: str) -> str:
    counts = {status: 0 for status in STATUSES}
    failures: list[dict] = []
    for spec in specs:
        status = spec["status"]
        if status in counts:
            counts[status] += 1
        if status in {"failed", "timedOut", "interrupted"}:
            failures.append(spec)

    lines = [
        "# Playwright Summary",
        "",
        f"- Source: `{source}`",
        f"- Passed: {counts['passed']}",
        f"- Failed: {counts['failed']}",
        f"- Timed out: {counts['timedOut']}",
        f"- Skipped: {counts['skipped']}",
        f"- Interrupted: {counts['interrupted']}",
        "",
        "## Failing Or Blocked Specs",
    ]

    if not failures:
        lines.extend(["- None", ""])
    else:
        lines.append("")
        lines.extend(f"- `{item['file']}` :: {item['title']} [{item['status']}]" for item in failures)
        lines.append("")

    lines.extend(
        [
            "## Notes",
            "",
            "- Use this summary as an input to the discovery sprint review.",
            "- If no JSON report exists yet, run Playwright with a JSON reporter before using this script.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Summarize a Playwright JSON report.")
    parser.add_argument("--json-file", required=True, help="Path to Playwright JSON report")
    parser.add_argument("--output", help="Optional markdown output path")
    args = parser.parse_args()

    json_path = Path(args.json_file)
    report = load_report(json_path)
    suites = report.get("suites", [])
    specs: list[dict] = []
    for suite in suites:
        specs.extend(collect_specs(suite))

    markdown = render_markdown(specs, str(json_path))

    if args.output:
        Path(args.output).write_text(markdown)
    else:
        print(markdown)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
