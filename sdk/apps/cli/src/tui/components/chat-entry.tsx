import { useTerminalDimensions } from "@opentui/react";
import type React from "react";
import { useState } from "react";
import "opentui-spinner/react";
import { useTerminalBackground } from "../hooks/use-terminal-background";
import {
	getDefaultForeground,
	getModeInputBackground,
	palette,
} from "../palette";
import type { ChatEntry } from "../types";
import { getSyntaxStyle } from "../utils/syntax-style";
import {
	parseApplyPatchInput,
	parseAskQuestionInput,
	parseEditorInput,
	parseReadFilesInput,
	parseRunCommandsInput,
	parseSearchInput,
	parseSpawnAgentInput,
	parseWebFetchInput,
	shortenPath,
} from "../utils/tool-parsing";
import { ToolOutput } from "./tool-output";

function trimLeading(text: string): string {
	return text.replace(/^\n+/, "");
}

function ReasoningBlock(props: { text: string; streaming: boolean }) {
	const [expanded, setExpanded] = useState(false);
	const { width } = useTerminalDimensions();
	const content = trimLeading(props.text);
	if (!content.trim()) {
		if (props.streaming) {
			return (
				<box flexDirection="row" gap={1}>
					<spinner name="dots" color="gray" />
					<text fg="gray">
						<em>Thinking...</em>
					</text>
				</box>
			);
		}
		return null;
	}

	if (props.streaming) {
		const lines = content.split("\n");
		return (
			<box flexDirection="column">
				<box flexDirection="row" gap={1}>
					<spinner name="dots" color="gray" />
					<text fg="gray">
						<em>Thinking...</em>
					</text>
				</box>
				<box flexDirection="column" paddingLeft={2}>
					{lines.map((line) => (
						<text key={line} fg="gray" selectable>
							<em>{line || " "}</em>
						</text>
					))}
				</box>
			</box>
		);
	}

	if (expanded) {
		const lines = content.split("\n");
		return (
			<box flexDirection="column" onMouseDown={() => setExpanded(false)}>
				<text fg="gray">
					{"\u25bc"} <em>Thinking:</em>
				</text>
				<box flexDirection="column" paddingLeft={2}>
					{lines.map((line) => (
						<text key={line} fg="gray" selectable>
							<em>{line || " "}</em>
						</text>
					))}
				</box>
			</box>
		);
	}

	const padding = 4;
	const prefix = "\u25b6 Thinking: ";
	const available = Math.max(10, width - padding - prefix.length - 3);
	const flat = content.replace(/\n/g, " ").trim();
	const tail =
		flat.length <= available
			? flat
			: `...${flat.slice(flat.length - available)}`;

	return (
		<box onMouseDown={() => setExpanded(true)}>
			<text fg="gray" selectable>
				{"\u25b6"} <em>Thinking: {tail}</em>
			</text>
		</box>
	);
}

function formatToolParams(
	toolName: string,
	rawInput: unknown,
	fallback: string,
): React.ReactNode {
	switch (toolName) {
		case "read_files": {
			const info = parseReadFilesInput(rawInput);
			if (!info?.files.length) return fallback;
			return info.files.map((f, i) => {
				const sl = f.startLine != null ? String(f.startLine) : "undefined";
				const el = f.endLine != null ? String(f.endLine) : "undefined";
				const sep = i > 0 ? "; " : "";
				return (
					<span key={f.path}>
						{sep}
						{shortenPath(f.path)}
						<span fg="gray">
							, start_line={sl}, end_line={el}
						</span>
					</span>
				);
			});
		}
		case "run_commands": {
			const info = parseRunCommandsInput(rawInput);
			if (!info?.commands.length) return fallback;
			return info.commands.join(" && ");
		}
		case "editor":
		case "edit":
		case "write": {
			const info = parseEditorInput(rawInput);
			if (!info) return fallback;
			return shortenPath(info.path);
		}
		case "apply_patch": {
			const patchInfo = parseApplyPatchInput(rawInput);
			if (!patchInfo?.files.length) return fallback;
			return patchInfo.files.map((f) => shortenPath(f)).join(", ");
		}
		case "search_codebase": {
			const info = parseSearchInput(rawInput);
			if (!info?.queries.length) return fallback;
			return info.queries.join(", ");
		}
		case "fetch_web_content": {
			const info = parseWebFetchInput(rawInput);
			if (!info?.urls.length) return fallback;
			return info.urls.join(", ");
		}
		case "spawn_agent": {
			const info = parseSpawnAgentInput(rawInput);
			if (!info) return fallback;
			const task =
				info.task.length > 60 ? `${info.task.slice(0, 60)}...` : info.task;
			return task;
		}
		case "ask_question":
		case "ask_followup_question": {
			const info = parseAskQuestionInput(rawInput);
			if (!info) return fallback;
			const q =
				info.question.length > 60
					? `${info.question.slice(0, 60)}...`
					: info.question;
			return q;
		}
		case "switch_to_act_mode":
			return "";
		case "skills": {
			if (rawInput && typeof rawInput === "object" && "skill" in rawInput) {
				const s = String((rawInput as { skill: unknown }).skill);
				const args =
					"args" in rawInput
						? ` ${String((rawInput as { args: unknown }).args)}`
						: "";
				const full = `${s}${args}`;
				return full.length > 70 ? `${full.slice(0, 70)}...` : full;
			}
			return fallback;
		}
		default:
			return fallback;
	}
}

function ToolCallView(props: {
	toolName: string;
	inputSummary: string;
	rawInput?: unknown;
	accent?: string;
	defaultFg?: string;
	streaming: boolean;
	result?: {
		outputSummary: string;
		rawOutput?: unknown;
		error?: string;
	};
}) {
	const {
		toolName,
		inputSummary,
		streaming,
		result,
		accent = palette.act,
		defaultFg,
	} = props;
	const failed = result?.error != null;
	const params = formatToolParams(toolName, props.rawInput, inputSummary);

	return (
		<box flexDirection="column">
			<box flexDirection="row">
				<box width={2}>
					{streaming ? (
						<spinner name="dots" color="gray" />
					) : failed ? (
						<text fg="red">x</text>
					) : (
						<text fg={accent}>*</text>
					)}
				</box>
				<text fg={defaultFg} selectable>
					<span fg={accent}>
						<strong>{toolName}</strong>
					</span>
					<span fg={accent}>
						<strong>(</strong>
					</span>
					<span>{params}</span>
					<span fg={accent}>
						<strong>)</strong>
					</span>
				</text>
			</box>
			{result && (
				<ToolOutput
					toolName={toolName}
					outputSummary={result.outputSummary}
					rawOutput={result.rawOutput}
					rawInput={props.rawInput}
					error={result.error}
				/>
			)}
		</box>
	);
}

export function ChatEntryView(props: { entry: ChatEntry; accent?: string }) {
	const { entry, accent = palette.act } = props;
	const terminalBg = useTerminalBackground();
	const defaultFg = getDefaultForeground(terminalBg);
	const userMsgBg = getModeInputBackground(
		accent === palette.plan ? "plan" : "act",
		terminalBg,
	);

	switch (entry.kind) {
		case "user":
			return (
				<box
					flexDirection="row"
					backgroundColor={userMsgBg}
					marginX={-1}
					paddingLeft={1}
					paddingRight={2}
					paddingY={1}
				>
					<text fg={accent}>{">"} </text>
					<text fg={defaultFg} selectable>
						{entry.text}
					</text>
				</box>
			);

		case "user_submitted":
			return (
				<box
					flexDirection="row"
					backgroundColor={userMsgBg}
					marginX={-1}
					paddingLeft={1}
					paddingRight={2}
					paddingY={1}
				>
					<text fg={accent}>{">"} </text>
					{entry.delivery === "steer" && <text fg="yellow">[steer] </text>}
					{entry.delivery === "queue" && <text fg="gray">[queued] </text>}
					<text fg={defaultFg} selectable>
						{entry.text}
					</text>
				</box>
			);

		case "assistant_text": {
			const content = trimLeading(entry.text);
			if (!content.trim()) return null;
			return (
				<box flexDirection="row">
					<box width={2}>
						{entry.streaming ? (
							<spinner name="dots" color={accent} />
						) : (
							<text fg={accent}>*</text>
						)}
					</box>
					<box flexGrow={1}>
						<markdown
							content={content}
							syntaxStyle={getSyntaxStyle()}
							streaming={entry.streaming}
							fg={defaultFg}
						/>
					</box>
				</box>
			);
		}

		case "reasoning":
			return <ReasoningBlock text={entry.text} streaming={entry.streaming} />;

		case "tool_call":
			return (
				<ToolCallView
					toolName={entry.toolName}
					inputSummary={entry.inputSummary}
					rawInput={entry.rawInput}
					streaming={entry.streaming}
					result={entry.result}
					accent={accent}
					defaultFg={defaultFg}
				/>
			);

		case "error":
			return (
				<box flexDirection="row">
					<text fg="red" content="* " />
					<text fg="red" selectable content={`Error: ${entry.text}`} />
				</box>
			);

		case "status":
			return (
				<box flexDirection="row">
					<text fg="gray" content="* " />
					<text fg="gray" selectable content={entry.text} />
				</box>
			);

		case "team":
			return (
				<box flexDirection="row">
					<text fg="gray" content="* " />
					<text fg="gray" selectable content={entry.text} />
				</box>
			);

		case "done": {
			const parts: string[] = [];
			if (entry.elapsed) parts.push(`${entry.elapsed}s`);
			if (entry.tokens > 0)
				parts.push(`${entry.tokens.toLocaleString()} tokens`);
			if (entry.cost > 0) parts.push(`$${entry.cost.toFixed(3)}`);
			if (entry.iterations > 0)
				parts.push(
					`${entry.iterations} iteration${entry.iterations !== 1 ? "s" : ""}`,
				);
			if (parts.length === 0) return null;
			return <text fg="gray" content={parts.join(" | ")} />;
		}
	}
}
