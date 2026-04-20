#!/usr/bin/env python3

"""
Aggregate task activity metrics across a tasks root directory.

This script reuses scripts/task_activity_report.py to analyze every task directory
under a given root and sorts the tasks by a chosen horizon metric.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from zoneinfo import ZoneInfo

from task_activity_report import analyze_task_directory, human_duration


SORT_KEYS = {
	"conservative": "totalConservativeAgentBusyMs",
	"agent-busy": "totalAgentBusyMs",
	"session-span": "totalSessionSpanMs",
}


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(description="Roll up Cline task activity across a tasks directory")
	parser.add_argument("tasks_root", help="Directory containing per-task subdirectories")
	parser.add_argument("--threshold-minutes", type=float, default=15.0)
	parser.add_argument("--min-session-minutes", type=float, default=2.0)
	parser.add_argument("--conservative-gap-cap-seconds", type=float, default=10.0)
	parser.add_argument("--timezone", default="America/Los_Angeles")
	parser.add_argument(
		"--sort-by",
		choices=sorted(SORT_KEYS.keys()),
		default="conservative",
		help="Metric used to rank longest-horizon tasks (default: conservative)",
	)
	parser.add_argument("--limit", type=int, default=25, help="Maximum number of tasks to print")
	parser.add_argument("--json", action="store_true", help="Emit JSON instead of text")
	return parser.parse_args()


def is_task_dir(path: Path) -> bool:
	return (path / "ui_messages.json").exists() and (path / "api_conversation_history.json").exists()


def summarize_prompt(task_analysis: dict) -> str:
	for session in task_analysis.get("sessions", []):
		if session.get("kept") and session.get("initiating_prompt"):
			return session["initiating_prompt"]
	return "(no prompt found)"


def render_text(results: list[dict], sort_by: str, limit: int) -> str:
	metric_key = SORT_KEYS[sort_by]
	lines = [
		f"Tasks ranked by {sort_by} ({metric_key})",
		"",
	]
	for idx, result in enumerate(results[:limit], start=1):
		lines.extend(
			[
				f"{idx}. {Path(result['taskDir']).name}",
				f"   conservative: {result['totalConservativeAgentBusyHuman']} ({result['totalConservativeAgentBusyMs']} ms)",
				f"   agent busy:   {result['totalAgentBusyHuman']} ({result['totalAgentBusyMs']} ms)",
				f"   session span: {result['totalSessionSpanHuman']} ({result['totalSessionSpanMs']} ms)",
				f"   retained sessions: {result['keptSessionCount']}",
				f"   retained span: {result.get('retainedSpanStartHuman') or 'n/a'} -> {result.get('retainedSpanEndHuman') or 'n/a'}",
				f"   prompt: {summarize_prompt(result)}",
			]
		)
	return "\n".join(lines)


def main() -> int:
	args = parse_args()
	root = Path(args.tasks_root).expanduser().resolve()
	if not root.exists() or not root.is_dir():
		print(f"Tasks root must be an existing directory: {root}", file=sys.stderr)
		return 1

	try:
		tz = ZoneInfo(args.timezone)
	except Exception as error:
		print(f"Invalid timezone '{args.timezone}': {error}", file=sys.stderr)
		return 1

	results = []
	for child in sorted(root.iterdir()):
		if not child.is_dir() or not is_task_dir(child):
			continue
		try:
			results.append(
				analyze_task_directory(
					task_dir=child,
					threshold_minutes=args.threshold_minutes,
					min_session_minutes=args.min_session_minutes,
					conservative_gap_cap_seconds=args.conservative_gap_cap_seconds,
					tz=tz,
				),
			)
		except Exception as error:
			results.append(
				{
					"taskDir": str(child),
					"error": str(error),
					"totalConservativeAgentBusyMs": -1,
					"totalAgentBusyMs": -1,
					"totalSessionSpanMs": -1,
				},
			)

	metric_key = SORT_KEYS[args.sort_by]
	results.sort(key=lambda item: item.get(metric_key, -1), reverse=True)

	if args.json:
		print(json.dumps(results, indent=2))
	else:
		print(render_text(results, args.sort_by, args.limit))

	return 0


if __name__ == "__main__":
	raise SystemExit(main())