import "opentui-spinner/react";
import { isUserRunMessage, type MessageWithMetadata } from "@cline/core";
import type { SessionReplayIteration } from "@cline/session";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	formatReplayDecision,
	formatReplayDuration,
	formatReplayEventTimeline,
	formatReplayIterationTitle,
	formatReplayModelCall,
	formatReplayUsage,
	type LoadedSessionReplay,
	replayDecisionEvents,
	replayDelayMs,
	summarizeReplayIterations,
} from "../../session/replay";
import { formatUsd } from "../../utils/output";
import { ChatEntryView } from "../components/chat-entry";
import { useTheme } from "../hooks/use-theme";
import { getThemeModeAccent } from "../themes";
import type { ChatEntry } from "../types";
import { hydrateSessionMessages } from "../utils/hydrate-messages";

/** Shortest pause between iterations in timed playback, at speed 1. */
const MIN_STEP_MS = 600;

export function replayStepDelayMs(
	iteration: SessionReplayIteration,
	speed: number,
): number {
	if (!(speed > 0)) {
		return 0;
	}
	return Math.max(
		Math.round(MIN_STEP_MS / speed),
		replayDelayMs(iteration, speed),
	);
}

/** Runtime-injected user-role messages; shown as system notes, not prompts. */
function isInjectedUserMessage(message: MessageWithMetadata): boolean {
	if (message.role !== "user" || isUserRunMessage(message)) {
		return false;
	}
	return (
		typeof message.content === "string" ||
		!message.content.some((block) => block.type === "tool_result")
	);
}

function ReplayIterationView(props: {
	replay: LoadedSessionReplay;
	iteration: SessionReplayIteration;
}) {
	const theme = useTheme();
	const { iteration, replay } = props;
	const entries = useMemo(
		() =>
			hydrateSessionMessages(
				replay.session.transcript.messages
					.slice(iteration.messageRange.start, iteration.messageRange.end)
					.filter((message) => !isInjectedUserMessage(message)),
			),
		[replay, iteration],
	);
	const usage = formatReplayUsage(iteration);
	const timeline = formatReplayEventTimeline(iteration);
	const decisions = replayDecisionEvents(iteration);
	const toolTimings = iteration.toolCalls
		.filter((call) => call.durationMs !== undefined)
		.map(
			(call) => `${call.name} ${formatReplayDuration(call.durationMs ?? 0)}`,
		);
	const promptCount = entries.findIndex(
		(entry) => entry.kind !== "user" && entry.kind !== "user_submitted",
	);
	const notesAt = promptCount < 0 ? entries.length : promptCount;
	const renderEntry = (entry: ChatEntry, index: number) => {
		const mode = entry.mode ?? "act";
		return (
			<ChatEntryView
				key={`${iteration.index}:${index}:${entry.kind}`}
				entry={entry}
				accent={getThemeModeAccent(theme, mode)}
				mode={mode === "plan" ? "plan" : "act"}
				theme={theme}
			/>
		);
	};
	return (
		<box flexDirection="column" gap={1}>
			<text fg={theme.accents.act}>
				{`── ${formatReplayIterationTitle(iteration, replay.total)} ──`}
			</text>
			{entries.slice(0, notesAt).map(renderEntry)}
			{(iteration.injected ?? []).map((note) => (
				<text key={`note:${note.ts ?? ""}:${note.text}`} fg="gray">
					{`system: ${note.text}`}
				</text>
			))}
			{entries
				.slice(notesAt)
				.map((entry, offset) => renderEntry(entry, notesAt + offset))}
			<box flexDirection="column">
				{decisions.map((event) => (
					<text key={`decision:${event.index}`} fg="yellow">
						{`decision: ${formatReplayDecision(iteration, event)}`}
					</text>
				))}
				{usage && <text fg="gray">{`usage: ${usage}`}</text>}
				{(iteration.modelCalls ?? []).map((call) => (
					<text key={`model-call:${call.callIndex}`} fg="gray">
						{`model call: ${formatReplayModelCall(call)}`}
					</text>
				))}
				{toolTimings.length > 0 && (
					<text fg="gray">{`tool time: ${toolTimings.join(", ")}`}</text>
				)}
				{timeline.length > 0 && (
					<text fg="gray">{`events: ${timeline.join(", ")}`}</text>
				)}
			</box>
		</box>
	);
}

export function ReplayView(props: {
	replay: LoadedSessionReplay;
	speed: number;
	step: boolean;
	onExit: () => void;
}) {
	const theme = useTheme();
	const { replay } = props;
	const { iterations } = replay;
	const { entry } = replay.session;
	const scrollboxRef = useRef<ScrollBoxRenderable | null>(null);
	const [shown, setShown] = useState(() =>
		!props.step && !(props.speed > 0)
			? iterations.length
			: Math.min(1, iterations.length),
	);
	const [paused, setPaused] = useState(props.step);
	const finished = shown >= iterations.length;

	useEffect(() => {
		if (paused || finished) {
			return;
		}
		const next = iterations[shown];
		if (!next) {
			return;
		}
		const timer = setTimeout(
			() => setShown((count) => Math.min(iterations.length, count + 1)),
			replayStepDelayMs(next, props.speed),
		);
		return () => clearTimeout(timer);
	}, [paused, finished, iterations, shown, props.speed]);

	useEffect(() => {
		const scrollbox = scrollboxRef.current;
		if (!scrollbox || shown === 0) {
			return;
		}
		const timer = setTimeout(
			() => scrollbox.scrollTo(scrollbox.scrollHeight),
			0,
		);
		return () => clearTimeout(timer);
	}, [shown]);

	useKeyboard((key) => {
		const scrollbox = scrollboxRef.current;
		if (
			key.name === "q" ||
			key.name === "escape" ||
			(key.ctrl && key.name === "c")
		) {
			props.onExit();
			return;
		}
		if (key.name === "space") {
			setPaused((value) => !value);
			return;
		}
		if (key.name === "right" || key.name === "n" || key.name === "return") {
			setShown((count) => Math.min(iterations.length, count + 1));
			return;
		}
		if (key.name === "left" || key.name === "p") {
			setShown((count) => Math.max(Math.min(1, iterations.length), count - 1));
			return;
		}
		if (key.name === "e") {
			setShown(iterations.length);
			return;
		}
		if (!scrollbox) {
			return;
		}
		if (key.name === "pageup") scrollbox.scrollBy(-scrollbox.height / 2);
		else if (key.name === "pagedown") scrollbox.scrollBy(scrollbox.height / 2);
		else if (key.name === "up") scrollbox.scrollBy(-1);
		else if (key.name === "down") scrollbox.scrollBy(1);
		else if (key.name === "home") scrollbox.scrollTo(0);
		else if (key.name === "end") scrollbox.scrollTo(scrollbox.scrollHeight);
	});

	const visible = iterations.slice(0, shown);
	const summary = summarizeReplayIterations(visible);
	const state = finished
		? "finished"
		: paused
			? "paused"
			: props.speed > 0
				? `playing ${props.speed}x`
				: "playing";
	const position =
		iterations.length > 0
			? `${visible.at(-1)?.index ?? 0}/${replay.total}`
			: "0/0";

	return (
		<box flexDirection="column" flexGrow={1}>
			<box flexDirection="column" paddingX={1} flexShrink={0}>
				<text fg={theme.accents.act}>
					{`Session replay · ${entry.sessionId}${entry.title ? ` · ${entry.title}` : ""}`}
				</text>
				<text fg="gray">
					{`${entry.model || "unknown model"}${entry.provider ? ` (${entry.provider})` : ""} · ${entry.status}${entry.exitCode !== null ? ` (exit ${entry.exitCode})` : ""} · started ${entry.startedAt}`}
				</text>
			</box>
			<scrollbox ref={scrollboxRef} flexGrow={1}>
				<box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
					{iterations.length === 0 && (
						<text fg="gray">This session has no iterations to replay.</text>
					)}
					{visible.map((iteration) => (
						<ReplayIterationView
							key={iteration.index}
							replay={replay}
							iteration={iteration}
						/>
					))}
					{finished && iterations.length > 0 && (
						<text fg={theme.accents.act}>
							{`── End of replay · ${summary.toolCalls} tool calls · ${summary.inputTokens} in / ${summary.outputTokens} out · ${formatUsd(summary.cost)}${summary.wallMs !== undefined ? ` · ${formatReplayDuration(summary.wallMs)} wall time` : ""} ──`}
						</text>
					)}
				</box>
			</scrollbox>
			<box flexDirection="row" paddingX={1} gap={2} flexShrink={0}>
				<text fg={theme.accents.act}>{`${position} · ${state}`}</text>
				<text fg="gray">
					space pause · →/n next · ←/p back · e end · ↑↓ PgUp/PgDn scroll · q
					quit
				</text>
			</box>
		</box>
	);
}
