#!/usr/bin/env python3

"""
Generate a dependency-free SVG visualization of task activity over time.

For each task, plot a vertical whisker where:
- bottom = conservative agent busy time
- middle marker = agent busy time
- top = session span

Tasks are laid out chronologically on the x-axis by retained session start time.
"""

from __future__ import annotations

import argparse
import html
import json
import math
import sys
from pathlib import Path
from typing import Any

from zoneinfo import ZoneInfo

from task_activity_report import analyze_task_directory, human_duration


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(description="Plot task activity whiskers over time as an SVG image")
	parser.add_argument("tasks_root", help="Directory containing per-task subdirectories")
	parser.add_argument("--threshold-minutes", type=float, default=15.0)
	parser.add_argument("--min-session-minutes", type=float, default=2.0)
	parser.add_argument("--conservative-gap-cap-seconds", type=float, default=10.0)
	parser.add_argument("--timezone", default="America/Los_Angeles")
	parser.add_argument(
		"--output",
		default="task_activity_whiskers.svg",
		help="Output SVG path (default: task_activity_whiskers.svg)",
	)
	parser.add_argument("--width", type=int, default=1800)
	parser.add_argument("--height", type=int, default=900)
	parser.add_argument("--title", default="Cline Task Activity Over Time")
	return parser.parse_args()


def is_task_dir(path: Path) -> bool:
	return (path / "ui_messages.json").exists() and (path / "api_conversation_history.json").exists()


def svg_text(x: float, y: float, text: str, size: int = 12, anchor: str = "start", fill: str = "#111827", weight: str = "normal", rotate: float | None = None) -> str:
	transform = f' transform="rotate({rotate:.2f} {x:.2f} {y:.2f})"' if rotate is not None else ""
	return (
		f'<text x="{x:.2f}" y="{y:.2f}" font-size="{size}" text-anchor="{anchor}" '
		f'fill="{fill}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-weight="{weight}"{transform}>'
		f"{html.escape(text)}</text>"
	)


def format_hours(ms: int) -> str:
	return f"{ms / 3_600_000:.2f}h"


def summarize_prompt(task_analysis: dict[str, Any]) -> str:
	for session in task_analysis.get("sessions", []):
		if session.get("kept") and session.get("initiating_prompt"):
			return session["initiating_prompt"]
	return "(no prompt found)"


def create_svg(results: list[dict[str, Any]], width: int, height: int, title: str, tz_name: str) -> str:
	margin = {"top": 80, "right": 40, "bottom": 220, "left": 110}
	plot_x = margin["left"]
	plot_y = margin["top"]
	plot_w = width - margin["left"] - margin["right"]
	plot_h = height - margin["top"] - margin["bottom"]

	max_ms = max((r["totalSessionSpanMs"] for r in results), default=1)
	max_ms = max(max_ms, 1)

	def y_scale(value_ms: int) -> float:
		return plot_y + plot_h - (value_ms / max_ms) * plot_h

	def x_scale(index: int) -> float:
		if len(results) == 1:
			return plot_x + plot_w / 2
		return plot_x + (index / (len(results) - 1)) * plot_w

	parts: list[str] = [
		f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
		'<rect width="100%" height="100%" fill="#ffffff" />',
		svg_text(width / 2, 36, title, size=24, anchor="middle", weight="700"),
		svg_text(width / 2, 58, f"Whisker: conservative → session span, marker: agent busy, timezone: {tz_name}", size=12, anchor="middle", fill="#4b5563"),
	]

	# Grid + y-axis labels
	grid_steps = 6
	for i in range(grid_steps + 1):
		value = int(max_ms * i / grid_steps)
		y = y_scale(value)
		parts.append(f'<line x1="{plot_x}" y1="{y:.2f}" x2="{plot_x + plot_w}" y2="{y:.2f}" stroke="#e5e7eb" stroke-width="1" />')
		parts.append(svg_text(plot_x - 10, y + 4, format_hours(value), size=11, anchor="end", fill="#6b7280"))

	# Axes
	parts.append(f'<line x1="{plot_x}" y1="{plot_y}" x2="{plot_x}" y2="{plot_y + plot_h}" stroke="#111827" stroke-width="1.5" />')
	parts.append(f'<line x1="{plot_x}" y1="{plot_y + plot_h}" x2="{plot_x + plot_w}" y2="{plot_y + plot_h}" stroke="#111827" stroke-width="1.5" />')
	parts.append(svg_text(28, plot_y + plot_h / 2, "Task duration", size=13, anchor="middle", fill="#374151", rotate=-90))
	parts.append(svg_text(plot_x + plot_w / 2, height - 28, "Tasks ordered by retained session start time", size=13, anchor="middle", fill="#374151"))

	# Legend
	legend_x = plot_x + 20
	legend_y = plot_y + 10
	parts.append(f'<line x1="{legend_x}" y1="{legend_y}" x2="{legend_x}" y2="{legend_y + 28}" stroke="#2563eb" stroke-width="2.5" />')
	parts.append(f'<circle cx="{legend_x}" cy="{legend_y + 14}" r="4.5" fill="#dc2626" />')
	parts.append(svg_text(legend_x + 12, legend_y + 5, "whisker = conservative to session span", size=12, fill="#374151"))
	parts.append(svg_text(legend_x + 12, legend_y + 22, "red marker = agent busy", size=12, fill="#374151"))

	# Plot points
	for idx, result in enumerate(results):
		x = x_scale(idx)
		y_low = y_scale(result["totalConservativeAgentBusyMs"])
		y_mid = y_scale(result["totalAgentBusyMs"])
		y_high = y_scale(result["totalSessionSpanMs"])

		prompt = summarize_prompt(result)
		task_id = Path(result["taskDir"]).name
		tooltip = (
			f"Task {task_id}\n"
			f"Conservative: {result['totalConservativeAgentBusyHuman']}\n"
			f"Agent busy: {result['totalAgentBusyHuman']}\n"
			f"Session span: {result['totalSessionSpanHuman']}\n"
			f"Start: {result.get('retainedSpanStartHuman') or 'n/a'}\n"
			f"Prompt: {prompt[:220]}"
		)

		parts.append(f'<g><title>{html.escape(tooltip)}</title>')
		parts.append(f'<line x1="{x:.2f}" y1="{y_low:.2f}" x2="{x:.2f}" y2="{y_high:.2f}" stroke="#2563eb" stroke-width="2.5" />')
		parts.append(f'<line x1="{x - 6:.2f}" y1="{y_low:.2f}" x2="{x + 6:.2f}" y2="{y_low:.2f}" stroke="#2563eb" stroke-width="2" />')
		parts.append(f'<line x1="{x - 6:.2f}" y1="{y_high:.2f}" x2="{x + 6:.2f}" y2="{y_high:.2f}" stroke="#2563eb" stroke-width="2" />')
		parts.append(f'<circle cx="{x:.2f}" cy="{y_mid:.2f}" r="4.5" fill="#dc2626" stroke="#ffffff" stroke-width="1" />')
		parts.append('</g>')

		label = result.get("retainedSpanStartHuman", "")[:10]
		parts.append(svg_text(x, plot_y + plot_h + 20, label, size=10, anchor="end", fill="#6b7280", rotate=-50))

	# Top summaries
	if results:
		parts.append(svg_text(plot_x, height - 88, f"Tasks plotted: {len(results)}", size=12, fill="#374151"))
		parts.append(svg_text(plot_x, height - 68, f"Longest conservative horizon: {results[0]['totalConservativeAgentBusyHuman']} ({Path(results[0]['taskDir']).name})", size=12, fill="#374151"))

	parts.append('</svg>')
	return "\n".join(parts)


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

	results: list[dict[str, Any]] = []
	for child in sorted(root.iterdir()):
		if not child.is_dir() or not is_task_dir(child):
			continue
		try:
			analysis = analyze_task_directory(
				task_dir=child,
				threshold_minutes=args.threshold_minutes,
				min_session_minutes=args.min_session_minutes,
				conservative_gap_cap_seconds=args.conservative_gap_cap_seconds,
				tz=tz,
			)
			if analysis["keptSessionCount"] > 0:
				results.append(analysis)
		except Exception as error:
			print(f"Skipping {child.name}: {error}", file=sys.stderr)

	results.sort(key=lambda item: (item.get("retainedSpanStartTsMs") or 0, item.get("taskDir", "")))

	if not results:
		print("No analyzable tasks found.", file=sys.stderr)
		return 1

	svg = create_svg(results, args.width, args.height, args.title, args.timezone)
	output_path = Path(args.output).expanduser().resolve()
	output_path.parent.mkdir(parents=True, exist_ok=True)
	output_path.write_text(svg, encoding="utf-8")

	# Also emit a JSON sidecar for reproducibility.
	json_path = output_path.with_suffix(".json")
	json_path.write_text(json.dumps(results, indent=2), encoding="utf-8")

	print(f"Wrote SVG plot to: {output_path}")
	print(f"Wrote JSON data to: {json_path}")
	print(f"Tasks plotted: {len(results)}")
	print(f"Date range: {results[0].get('retainedSpanStartHuman')} -> {results[-1].get('retainedSpanEndHuman')}")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())