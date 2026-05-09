import { useState } from "react";
import { palette } from "../palette";
import { makeUnifiedDiff } from "../utils/diff";
import { getSyntaxStyle } from "../utils/syntax-style";
import {
	detectLanguage,
	extractFullOutputText,
	parseApplyPatchInput,
	parseEditorInput,
	parseReadFilesInput,
	shortenPath,
} from "../utils/tool-parsing";

const MAX_COLLAPSED_LINES = 5;
const RESULT = "\u23bf";

export interface ToolOutputProps {
	toolName: string;
	outputSummary: string;
	rawOutput?: unknown;
	rawInput?: unknown;
	error?: string;
}

function isAskTool(toolName: string): boolean {
	return toolName === "ask_question" || toolName === "ask_followup_question";
}

function isBashTool(toolName: string): boolean {
	return toolName === "run_commands" || toolName === "bash";
}

function isReadTool(toolName: string): boolean {
	return toolName === "read_files";
}

function isEditTool(toolName: string): boolean {
	return (
		toolName === "editor" ||
		toolName === "edit" ||
		toolName === "write" ||
		toolName === "apply_patch"
	);
}

function BashOutput(props: { fullText: string }) {
	const [expanded, setExpanded] = useState(false);
	const { fullText } = props;
	const trimmed = fullText.trimEnd();
	const lines = trimmed.split("\n");
	const firstLine = lines[0] ?? "";
	const hasMore = lines.length > 1;

	if (!expanded) {
		return (
			<box
				flexDirection="column"
				paddingLeft={2}
				onMouseDown={() => hasMore && setExpanded(true)}
			>
				<text selectable>
					<span fg="gray">
						{RESULT} {firstLine}
					</span>
				</text>
				{hasMore && (
					<text fg="gray">
						{"   "}... {lines.length - 1} more lines
					</text>
				)}
			</box>
		);
	}

	return (
		<box
			flexDirection="column"
			paddingLeft={2}
			onMouseDown={() => setExpanded(false)}
		>
			<text fg="gray">{RESULT} output:</text>
			<box marginLeft={2} marginTop={1} marginBottom={1}>
				<code
					content={fullText}
					filetype="bash"
					syntaxStyle={getSyntaxStyle()}
					selectable
				/>
			</box>
		</box>
	);
}

function ReadOutput(props: { fullText: string; rawInput?: unknown }) {
	const { fullText, rawInput } = props;
	const lines = fullText.split("\n");

	const readInfo = parseReadFilesInput(rawInput);
	const filePath = readInfo?.files[0]?.path;
	const language = filePath ? detectLanguage(filePath) : undefined;

	return (
		<box paddingLeft={2}>
			<text fg="gray">
				{RESULT} {lines.length} lines
				{language ? ` | ${language}` : ""}
			</text>
		</box>
	);
}

function DiffStats(props: {
	added: number;
	removed: number;
	language?: string;
}) {
	const { added, removed, language } = props;
	return (
		<text fg="gray">
			{RESULT}{" "}
			{removed > 0 ? (
				<>
					<span fg={palette.success}>+{added}</span>{" "}
					<span fg="red">-{removed}</span> lines
				</>
			) : (
				<span fg={palette.success}>+{added} lines (new)</span>
			)}
			{language ? ` | ${language}` : ""}
		</text>
	);
}

function EditOutput(props: { rawInput?: unknown; outputSummary: string }) {
	const [expanded, setExpanded] = useState(true);
	const editorInfo = parseEditorInput(props.rawInput);

	if (!editorInfo?.oldText && !editorInfo?.newText) {
		return (
			<box paddingLeft={2}>
				<text fg="gray">
					{"  "} {props.outputSummary || "done"}
				</text>
			</box>
		);
	}

	const oldText = editorInfo.oldText ?? "";
	const newText = editorInfo.newText;
	const language = detectLanguage(editorInfo.path);
	const addedLines = newText.split("\n").length;
	const removedLines = oldText ? oldText.split("\n").length : 0;

	return (
		<box
			flexDirection="column"
			paddingLeft={2}
			onMouseDown={() => setExpanded(!expanded)}
		>
			<DiffStats
				added={addedLines}
				removed={removedLines}
				language={language}
			/>
			{expanded && (
				<box marginLeft={2} marginTop={1} marginBottom={1}>
					<diff
						diff={makeUnifiedDiff(oldText, newText, editorInfo.path)}
						view="unified"
						filetype={language ?? "text"}
						showLineNumbers
						addedLineNumberBg="#1a4d1a"
						removedLineNumberBg="#4d1a1a"
					/>
				</box>
			)}
		</box>
	);
}

function ApplyPatchOutput(props: {
	rawInput?: unknown;
	outputSummary: string;
}) {
	const [expanded, setExpanded] = useState(true);
	const info = parseApplyPatchInput(props.rawInput);

	if (!info) {
		return (
			<box paddingLeft={2}>
				<text fg="gray">
					{"  "} {props.outputSummary || "done"}
				</text>
			</box>
		);
	}

	const fileLabel = info.files.map((f) => shortenPath(f, 40)).join(", ");
	const language = detectLanguage(info.files[0] ?? "");

	return (
		<box
			flexDirection="column"
			paddingLeft={2}
			onMouseDown={() => setExpanded(!expanded)}
		>
			<DiffStats
				added={info.additions}
				removed={info.deletions}
				language={fileLabel}
			/>
			{expanded && (
				<box marginLeft={2} marginTop={1} marginBottom={1}>
					<diff
						diff={info.diff}
						view="unified"
						filetype={language ?? "text"}
						showLineNumbers
						addedLineNumberBg="#1a4d1a"
						removedLineNumberBg="#4d1a1a"
					/>
				</box>
			)}
		</box>
	);
}

function GenericOutput(props: { outputSummary: string; fullText?: string }) {
	const [expanded, setExpanded] = useState(false);
	const displayText = props.fullText || props.outputSummary;
	const lines = displayText.split("\n");
	const isLong = lines.length > MAX_COLLAPSED_LINES;

	if (!displayText.trim()) return null;

	if (!expanded) {
		const collapsedText = isLong
			? `${lines.slice(0, MAX_COLLAPSED_LINES).join("\n")}\n... ${lines.length - MAX_COLLAPSED_LINES} more lines`
			: displayText;

		return (
			<box
				flexDirection="column"
				paddingLeft={2}
				onMouseDown={() => isLong && setExpanded(true)}
			>
				<text selectable>
					<span fg="gray">
						{isLong ? RESULT : " "} {collapsedText}
					</span>
				</text>
			</box>
		);
	}

	return (
		<box
			flexDirection="column"
			paddingLeft={2}
			onMouseDown={() => setExpanded(false)}
		>
			<text fg="gray">{RESULT}</text>
			<box marginLeft={2} marginBottom={1}>
				<text fg="gray" selectable>
					{displayText}
				</text>
			</box>
		</box>
	);
}

export function ToolOutput(props: ToolOutputProps) {
	const { toolName, outputSummary, rawOutput, rawInput, error } = props;

	if (error) {
		return (
			<box paddingLeft={2}>
				<text fg="red" selectable>
					{"  "} Error: {error}
				</text>
			</box>
		);
	}

	if (toolName === "switch_to_act_mode") return null;
	if (!outputSummary.trim() && !rawOutput) return null;

	const fullText = rawOutput ? extractFullOutputText(rawOutput) : undefined;

	if (isAskTool(toolName)) {
		const answer = (fullText || outputSummary).trim();
		if (!answer) return null;
		return (
			<box paddingLeft={2}>
				<text fg="gray" selectable>
					{RESULT} {answer}
				</text>
			</box>
		);
	}

	if (isBashTool(toolName)) {
		return <BashOutput fullText={fullText || outputSummary} />;
	}

	if (isReadTool(toolName)) {
		return (
			<ReadOutput fullText={fullText || outputSummary} rawInput={rawInput} />
		);
	}

	if (toolName === "apply_patch") {
		return (
			<ApplyPatchOutput rawInput={rawInput} outputSummary={outputSummary} />
		);
	}

	if (isEditTool(toolName)) {
		return <EditOutput rawInput={rawInput} outputSummary={outputSummary} />;
	}

	return <GenericOutput outputSummary={outputSummary} fullText={fullText} />;
}
