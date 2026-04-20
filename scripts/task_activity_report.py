#!/usr/bin/env python3

"""
Report active work sessions for a Cline task directory.

This script derives human-legible activity windows from a task directory by:
1. Loading ui_messages.json and splitting sessions on large inactivity gaps.
2. Filtering out tiny retry/error-only fragments.
3. Mapping each retained session to the most relevant initiating user prompt
   from api_conversation_history.json.

Example:
    python3 scripts/task_activity_report.py \
      "/Users/evekillaby/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/tasks/1776446048390"

    python3 scripts/task_activity_report.py /path/to/task --json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Any

try:
	from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
	print("This script requires Python 3.9+ (zoneinfo module).", file=sys.stderr)
	sys.exit(1)


SUBSTANTIVE_KINDS = {
	"tool",
	"text",
	"reasoning",
	"command",
	"task_progress",
	"completion_result",
	"attempt_completion",
}

RETRY_ONLY_KINDS = {"api_req_failed", "api_req_retried", "error_retry"}
HUMAN_WAIT_ASK_KINDS = {
	"command_output",
	"completion_result",
	"followup",
	"resume_task",
	"resume_completed_task",
	"mistake_limit_reached",
	"tool",
	"command",
	"browser_action_launch",
	"use_mcp_server",
	"new_task",
	"api_req_failed",
	"condense",
	"summarize_task",
	"report_bug",
	"use_subagents",
}


@dataclass
class Session:
	index: int
	start_ts_ms: int
	end_ts_ms: int
	duration_ms: int
	gap_after_ms: int
	message_count: int
	substantive_message_count: int
	initiating_prompt: str
	prompt_source_ts_ms: int | None
	prompt_source_role: str | None
	kept: bool


@dataclass
class WorkSegment:
	index: int
	session_index: int
	start_ts_ms: int
	end_ts_ms: int
	duration_ms: int
	conservative_duration_ms: int
	initiating_prompt: str
	prompt_source_ts_ms: int | None
	prompt_source_role: str | None


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(description="Report active work sessions for a Cline task directory")
	parser.add_argument("task_dir", help="Path to a task directory containing ui_messages.json and api_conversation_history.json")
	parser.add_argument(
		"--threshold-minutes",
		type=float,
		default=15.0,
		help="Split sessions when inactivity exceeds this many minutes (default: 15)",
	)
	parser.add_argument(
		"--min-session-minutes",
		type=float,
		default=2.0,
		help="Always keep sessions at or above this duration, even if small (default: 2)",
	)
	parser.add_argument(
		"--timezone",
		default="America/Los_Angeles",
		help="IANA timezone for human-readable output (default: America/Los_Angeles)",
	)
	parser.add_argument(
		"--conservative-gap-cap-seconds",
		type=float,
		default=10.0,
		help="Cap credited time between successive in-run-loop events for a conservative lower-bound metric (default: 10)",
	)
	parser.add_argument("--json", action="store_true", help="Emit JSON instead of text")
	return parser.parse_args()


def load_json(path: Path) -> Any:
	with path.open("r", encoding="utf-8") as f:
		return json.load(f)


def kind(message: dict[str, Any]) -> str:
	return (message.get("ask") or message.get("say") or "").strip()


def message_ts(message: dict[str, Any]) -> int | None:
	ts = message.get("ts")
	return ts if isinstance(ts, int) else None


def human_ts(ts_ms: int, tz: ZoneInfo) -> str:
	return datetime.fromtimestamp(ts_ms / 1000, tz=tz).strftime("%Y-%m-%d %I:%M:%S.%f %p %Z")


def human_duration(ms: int) -> str:
	seconds_total = ms / 1000
	hours = int(seconds_total // 3600)
	seconds_total -= hours * 3600
	minutes = int(seconds_total // 60)
	seconds_total -= minutes * 60
	return f"{hours}h {minutes}m {seconds_total:.3f}s"


def text_blocks_from_api_message(message: dict[str, Any]) -> list[str]:
	content = message.get("content")
	if isinstance(content, str):
		return [content]
	if isinstance(content, list):
		return [
			block.get("text", "")
			for block in content
			if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str)
		]
	return []


def clean_whitespace(text: str) -> str:
	return re.sub(r"\s+", " ", text).strip()


def extract_prompt_from_text(text: str) -> str | None:
	user_message_match = re.search(r"<user_message>\s*(.*?)\s*</user_message>", text, re.DOTALL)
	if user_message_match:
		value = clean_whitespace(user_message_match.group(1))
		if value:
			return value

	task_match = re.search(r"<task>\s*(.*?)\s*</task>", text, re.DOTALL)
	if task_match:
		value = clean_whitespace(task_match.group(1))
		if value:
			return value

	if text.startswith("[TASK RESUMPTION]"):
		return clean_whitespace(text)

	if "<environment_details>" in text:
		return None

	value = clean_whitespace(text)
	return value or None


def extract_prompt_from_api_message(message: dict[str, Any]) -> str | None:
	for text in text_blocks_from_api_message(message):
		prompt = extract_prompt_from_text(text)
		if prompt:
			return prompt
	return None


def choose_prompt_for_session(
	api_messages: list[dict[str, Any]],
	session_start_ms: int,
	session_end_ms: int,
	is_first_session: bool,
) -> tuple[str, int | None, str | None]:
	# Prefer a user prompt inside the session, allowing a small lead-in buffer so the
	# user prompt can precede the first UI event in the retained session by a moment.
	window_start = session_start_ms - 60_000
	for message in api_messages:
		if message.get("role") != "user":
			continue
		ts = message_ts(message)
		if ts is None or ts < window_start or ts > session_end_ms:
			continue
		prompt = extract_prompt_from_api_message(message)
		if prompt:
			return prompt, ts, str(message.get("role"))

	# For the first session, fall back to the task's initial prompt if needed.
	if is_first_session:
		for message in api_messages:
			if message.get("role") != "user":
				continue
			prompt = extract_prompt_from_api_message(message)
			ts = message_ts(message)
			if prompt:
				return prompt, ts, str(message.get("role"))

	return "(no new user prompt for this session; continuation of prior task state)", None, None


def build_sessions(
	ui_messages: list[dict[str, Any]],
	api_messages: list[dict[str, Any]],
	threshold_minutes: float,
	min_session_minutes: float,
) -> list[Session]:
	threshold_ms = int(threshold_minutes * 60 * 1000)
	min_session_ms = int(min_session_minutes * 60 * 1000)

	ui = [m for m in ui_messages if message_ts(m) is not None]
	ui.sort(key=lambda m: message_ts(m) or 0)

	if not ui:
		return []

	raw_segments: list[tuple[int, int, int, int, int]] = []
	start_index = 0
	prev_ts = message_ts(ui[0]) or 0

	for i, message in enumerate(ui[1:], start=1):
		ts = message_ts(message) or 0
		if ts - prev_ts > threshold_ms:
			raw_segments.append((
				start_index,
				i - 1,
				message_ts(ui[start_index]) or 0,
				message_ts(ui[i - 1]) or 0,
				ts - prev_ts,
			))
			start_index = i
		prev_ts = ts

	raw_segments.append((
		start_index,
		len(ui) - 1,
		message_ts(ui[start_index]) or 0,
		message_ts(ui[-1]) or 0,
		0,
	))

	sessions: list[Session] = []
	for index, (i0, i1, start_ms, end_ms, gap_after_ms) in enumerate(raw_segments, start=1):
		segment_messages = ui[i0 : i1 + 1]
		segment_kinds = [kind(m) for m in segment_messages]
		substantive_count = sum(1 for k in segment_kinds if k in SUBSTANTIVE_KINDS)
		only_retryish = bool(segment_kinds) and all(k in RETRY_ONLY_KINDS for k in segment_kinds)
		duration_ms = max(0, end_ms - start_ms)
		keep = duration_ms >= min_session_ms or (substantive_count >= 3 and not only_retryish)
		prompt, prompt_ts_ms, prompt_role = choose_prompt_for_session(
			api_messages,
			start_ms,
			end_ms,
			is_first_session=(index == 1),
		)
		sessions.append(
			Session(
				index=index,
				start_ts_ms=start_ms,
				end_ts_ms=end_ms,
				duration_ms=duration_ms,
				gap_after_ms=gap_after_ms,
				message_count=len(segment_messages),
				substantive_message_count=substantive_count,
				initiating_prompt=prompt,
				prompt_source_ts_ms=prompt_ts_ms,
				prompt_source_role=prompt_role,
				kept=keep,
			)
		)

	return sessions


def build_work_segments(
	ui_messages: list[dict[str, Any]],
	api_messages: list[dict[str, Any]],
	sessions: list[Session],
	conservative_gap_cap_seconds: float,
) -> list[WorkSegment]:
	ui = [m for m in ui_messages if message_ts(m) is not None]
	ui.sort(key=lambda m: message_ts(m) or 0)
	cap_ms = max(0, int(conservative_gap_cap_seconds * 1000))

	segments: list[WorkSegment] = []
	work_index = 1

	for session in sessions:
		if not session.kept:
			continue

		session_messages = [
			message
			for message in ui
			if session.start_ts_ms <= (message_ts(message) or 0) <= session.end_ts_ms
		]
		if not session_messages:
			continue

		current_start: int | None = None
		last_active_ts: int | None = None
		conservative_duration_ms = 0
		prev_ts_in_segment: int | None = None

		for message in session_messages:
			ts = message_ts(message)
			if ts is None:
				continue

			message_kind = kind(message)
			is_user_feedback = message.get("type") == "say" and message_kind == "user_feedback"

			if is_user_feedback:
				if current_start is not None and last_active_ts is not None and last_active_ts >= current_start:
					prompt, prompt_ts_ms, prompt_role = choose_prompt_for_session(
						api_messages,
						current_start,
						last_active_ts,
						is_first_session=(len(segments) == 0),
					)
					segments.append(
						WorkSegment(
							index=work_index,
							session_index=session.index,
							start_ts_ms=current_start,
							end_ts_ms=last_active_ts,
							duration_ms=last_active_ts - current_start,
							conservative_duration_ms=conservative_duration_ms,
							initiating_prompt=prompt,
							prompt_source_ts_ms=prompt_ts_ms,
							prompt_source_role=prompt_role,
						),
					)
					work_index += 1
				current_start = None
				last_active_ts = None
				conservative_duration_ms = 0
				prev_ts_in_segment = None
				continue

			if current_start is None:
				current_start = ts
				prev_ts_in_segment = ts
			else:
				if prev_ts_in_segment is not None:
					conservative_duration_ms += min(ts - prev_ts_in_segment, cap_ms)
				prev_ts_in_segment = ts

			last_active_ts = ts

			if message.get("type") == "ask" and message_kind in HUMAN_WAIT_ASK_KINDS:
				prompt, prompt_ts_ms, prompt_role = choose_prompt_for_session(
					api_messages,
					current_start,
					ts,
					is_first_session=(len(segments) == 0),
				)
				segments.append(
					WorkSegment(
						index=work_index,
						session_index=session.index,
						start_ts_ms=current_start,
						end_ts_ms=ts,
						duration_ms=ts - current_start,
						conservative_duration_ms=conservative_duration_ms,
						initiating_prompt=prompt,
						prompt_source_ts_ms=prompt_ts_ms,
						prompt_source_role=prompt_role,
					),
				)
				work_index += 1
				current_start = None
				last_active_ts = None
				conservative_duration_ms = 0
				prev_ts_in_segment = None

		if current_start is not None and last_active_ts is not None and last_active_ts >= current_start:
			prompt, prompt_ts_ms, prompt_role = choose_prompt_for_session(
				api_messages,
				current_start,
				last_active_ts,
				is_first_session=(len(segments) == 0),
			)
			segments.append(
				WorkSegment(
					index=work_index,
					session_index=session.index,
					start_ts_ms=current_start,
					end_ts_ms=last_active_ts,
					duration_ms=last_active_ts - current_start,
					conservative_duration_ms=conservative_duration_ms,
					initiating_prompt=prompt,
					prompt_source_ts_ms=prompt_ts_ms,
					prompt_source_role=prompt_role,
				),
			)
			work_index += 1

	return segments


def render_text(
	task_dir: Path,
	sessions: list[Session],
	work_segments: list[WorkSegment],
	tz: ZoneInfo,
	threshold_minutes: float,
	min_session_minutes: float,
	conservative_gap_cap_seconds: float,
) -> str:
	kept = [session for session in sessions if session.kept]
	dropped = [session for session in sessions if not session.kept]
	total_session_span_ms = sum(session.duration_ms for session in kept)
	total_work_ms = sum(segment.duration_ms for segment in work_segments)
	total_conservative_work_ms = sum(segment.conservative_duration_ms for segment in work_segments)
	if kept:
		first_start = min(session.start_ts_ms for session in kept)
		last_end = max(session.end_ts_ms for session in kept)
	else:
		first_start = None
		last_end = None

	lines = [
		f"Task directory: {task_dir}",
		f"Inactivity threshold: {threshold_minutes:.2f} minutes",
		f"Minimum kept session: {min_session_minutes:.2f} minutes (unless substantively active)",
		f"Retained sessions: {len(kept)} / {len(sessions)}",
		f"Total session span: {total_session_span_ms} ms ({human_duration(total_session_span_ms)})",
		f"Total agent busy time: {total_work_ms} ms ({human_duration(total_work_ms)})",
		f"Total conservative agent busy time: {total_conservative_work_ms} ms ({human_duration(total_conservative_work_ms)})",
		f"Conservative gap cap: {conservative_gap_cap_seconds:.2f} seconds between successive in-run-loop events",
		"Note: session span includes time inside retained sessions; agent busy time excludes explicit human-wait boundaries such as completion/resume/tool approval asks.",
		"The conservative metric is a lower-bound estimate that also caps credited time between successive events inside a work segment.",
	]

	if first_start is not None and last_end is not None:
		lines.extend(
			[
				f"Retained sessions span: {human_ts(first_start, tz)} -> {human_ts(last_end, tz)}",
				f"Retained session span unix ms: {first_start} -> {last_end}",
				"Note: this span is not continuous; rely on the individual sessions below for actual active windows.",
			],
		)

	lines.append("")
	lines.append("Sessions:")
	for session in kept:
		lines.extend(
			[
				f"- Session {session.index}",
				f"  Start: {human_ts(session.start_ts_ms, tz)} ({session.start_ts_ms})",
				f"  End:   {human_ts(session.end_ts_ms, tz)} ({session.end_ts_ms})",
				f"  Duration: {session.duration_ms} ms ({human_duration(session.duration_ms)})",
				f"  Gap after: {session.gap_after_ms} ms ({human_duration(session.gap_after_ms)})",
				f"  Messages: {session.message_count}, substantive: {session.substantive_message_count}",
				f"  Prompt source ts: {session.prompt_source_ts_ms if session.prompt_source_ts_ms is not None else 'n/a'}",
				f"  Prompt: {session.initiating_prompt}",
			],
		)

	if dropped:
		lines.append("")
		lines.append("Dropped sessions:")
		for session in dropped:
			lines.append(
				f"- Session {session.index}: {human_ts(session.start_ts_ms, tz)} -> {human_ts(session.end_ts_ms, tz)} | {human_duration(session.duration_ms)} | messages={session.message_count} | substantive={session.substantive_message_count}",
			)

	lines.append("")
	lines.append("Work segments (stricter agent-busy windows):")
	for segment in work_segments:
		lines.extend(
			[
				f"- Work segment {segment.index} (from session {segment.session_index})",
				f"  Start: {human_ts(segment.start_ts_ms, tz)} ({segment.start_ts_ms})",
				f"  End:   {human_ts(segment.end_ts_ms, tz)} ({segment.end_ts_ms})",
				f"  Duration: {segment.duration_ms} ms ({human_duration(segment.duration_ms)})",
				f"  Conservative duration: {segment.conservative_duration_ms} ms ({human_duration(segment.conservative_duration_ms)})",
				f"  Prompt source ts: {segment.prompt_source_ts_ms if segment.prompt_source_ts_ms is not None else 'n/a'}",
				f"  Prompt: {segment.initiating_prompt}",
			],
		)

	return "\n".join(lines)


def render_json(
	task_dir: Path,
	sessions: list[Session],
	work_segments: list[WorkSegment],
	tz: ZoneInfo,
	threshold_minutes: float,
	min_session_minutes: float,
	conservative_gap_cap_seconds: float,
) -> str:
	kept = [session for session in sessions if session.kept]
	total_session_span_ms = sum(session.duration_ms for session in kept)
	total_work_ms = sum(segment.duration_ms for segment in work_segments)
	total_conservative_work_ms = sum(segment.conservative_duration_ms for segment in work_segments)
	output = {
		"taskDir": str(task_dir),
		"thresholdMinutes": threshold_minutes,
		"minSessionMinutes": min_session_minutes,
		"conservativeGapCapSeconds": conservative_gap_cap_seconds,
		"timezone": str(tz),
		"totalSessionSpanMs": total_session_span_ms,
		"totalSessionSpanHuman": human_duration(total_session_span_ms),
		"totalAgentBusyMs": total_work_ms,
		"totalAgentBusyHuman": human_duration(total_work_ms),
		"totalConservativeAgentBusyMs": total_conservative_work_ms,
		"totalConservativeAgentBusyHuman": human_duration(total_conservative_work_ms),
		"keptSessionCount": len(kept),
		"allSessionCount": len(sessions),
		"sessions": [
			{
				**asdict(session),
				"startHuman": human_ts(session.start_ts_ms, tz),
				"endHuman": human_ts(session.end_ts_ms, tz),
				"durationHuman": human_duration(session.duration_ms),
				"gapAfterHuman": human_duration(session.gap_after_ms),
			}
			for session in sessions
		],
		"workSegments": [
			{
				**asdict(segment),
				"startHuman": human_ts(segment.start_ts_ms, tz),
				"endHuman": human_ts(segment.end_ts_ms, tz),
				"durationHuman": human_duration(segment.duration_ms),
				"conservativeDurationHuman": human_duration(segment.conservative_duration_ms),
			}
			for segment in work_segments
		],
	}
	return json.dumps(output, indent=2)


def analyze_task_directory(
	task_dir: Path,
	threshold_minutes: float,
	min_session_minutes: float,
	conservative_gap_cap_seconds: float,
	tz: ZoneInfo,
) -> dict[str, Any]:
	ui_path = task_dir / "ui_messages.json"
	api_path = task_dir / "api_conversation_history.json"

	ui_messages = load_json(ui_path)
	api_messages = load_json(api_path)
	sessions = build_sessions(
		ui_messages=ui_messages,
		api_messages=api_messages,
		threshold_minutes=threshold_minutes,
		min_session_minutes=min_session_minutes,
	)
	work_segments = build_work_segments(
		ui_messages=ui_messages,
		api_messages=api_messages,
		sessions=sessions,
		conservative_gap_cap_seconds=conservative_gap_cap_seconds,
	)

	kept = [session for session in sessions if session.kept]
	total_session_span_ms = sum(session.duration_ms for session in kept)
	total_work_ms = sum(segment.duration_ms for segment in work_segments)
	total_conservative_work_ms = sum(segment.conservative_duration_ms for segment in work_segments)
	first_start = min((session.start_ts_ms for session in kept), default=None)
	last_end = max((session.end_ts_ms for session in kept), default=None)

	return {
		"taskDir": str(task_dir),
		"thresholdMinutes": threshold_minutes,
		"minSessionMinutes": min_session_minutes,
		"conservativeGapCapSeconds": conservative_gap_cap_seconds,
		"timezone": str(tz),
		"totalSessionSpanMs": total_session_span_ms,
		"totalSessionSpanHuman": human_duration(total_session_span_ms),
		"totalAgentBusyMs": total_work_ms,
		"totalAgentBusyHuman": human_duration(total_work_ms),
		"totalConservativeAgentBusyMs": total_conservative_work_ms,
		"totalConservativeAgentBusyHuman": human_duration(total_conservative_work_ms),
		"keptSessionCount": len(kept),
		"allSessionCount": len(sessions),
		"retainedSpanStartTsMs": first_start,
		"retainedSpanEndTsMs": last_end,
		"retainedSpanStartHuman": human_ts(first_start, tz) if first_start is not None else None,
		"retainedSpanEndHuman": human_ts(last_end, tz) if last_end is not None else None,
		"sessions": [
			{
				**asdict(session),
				"startHuman": human_ts(session.start_ts_ms, tz),
				"endHuman": human_ts(session.end_ts_ms, tz),
				"durationHuman": human_duration(session.duration_ms),
				"gapAfterHuman": human_duration(session.gap_after_ms),
			}
			for session in sessions
		],
		"workSegments": [
			{
				**asdict(segment),
				"startHuman": human_ts(segment.start_ts_ms, tz),
				"endHuman": human_ts(segment.end_ts_ms, tz),
				"durationHuman": human_duration(segment.duration_ms),
				"conservativeDurationHuman": human_duration(segment.conservative_duration_ms),
			}
			for segment in work_segments
		],
	}


def main() -> int:
	args = parse_args()
	task_dir = Path(args.task_dir).expanduser().resolve()
	ui_path = task_dir / "ui_messages.json"
	api_path = task_dir / "api_conversation_history.json"

	if not ui_path.exists() or not api_path.exists():
		print(
			f"Task directory must contain both ui_messages.json and api_conversation_history.json: {task_dir}",
			file=sys.stderr,
		)
		return 1

	try:
		tz = ZoneInfo(args.timezone)
	except Exception as error:
		print(f"Invalid timezone '{args.timezone}': {error}", file=sys.stderr)
		return 1

	analysis = analyze_task_directory(
		task_dir=task_dir,
		threshold_minutes=args.threshold_minutes,
		min_session_minutes=args.min_session_minutes,
		conservative_gap_cap_seconds=args.conservative_gap_cap_seconds,
		tz=tz,
	)

	if args.json:
		print(json.dumps(analysis, indent=2))
	else:
		print(
			render_text(
				task_dir,
				[Session(**{k: v for k, v in s.items() if k in Session.__dataclass_fields__}) for s in analysis["sessions"]],
				[
					WorkSegment(**{k: v for k, v in w.items() if k in WorkSegment.__dataclass_fields__})
					for w in analysis["workSegments"]
				],
				tz,
				args.threshold_minutes,
				args.min_session_minutes,
				args.conservative_gap_cap_seconds,
			),
		)

	return 0


if __name__ == "__main__":
	raise SystemExit(main())