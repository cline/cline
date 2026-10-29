/**
 * Tool-activity presentation helpers (DESIGN_SPEC §4 + §7): the lucide icon for a
 * tool, a human-readable label, a code/output preview and the +N/-N diff counts.
 *
 * Tool names arrive un-normalized from many hosts, so matching is done on a
 * lowercased name with a set of substring aliases rather than an exact map.
 */

import {
	buildToolSummary,
	countDiffLines,
	parseEditorResultDiffCounts,
} from "@cline/ui/components/agent-chat/tool-summary";
import {
	Blocks,
	Box,
	Files,
	Library,
	type LucideIcon,
	MessageCircleQuestionMark,
	PanelsTopLeft,
	Pencil,
	SearchCode,
	SquareArrowRight,
	Terminal,
	User,
	Users,
	Wrench,
} from "lucide-react-native";
import type { ToolApprovalStatus } from "@/session/reducer";
import { isEditTool, normalizeEditorInput, parseToolDiff } from "./diff";

interface IconRule {
	readonly icon: LucideIcon;
	readonly match: readonly string[];
}

// Order matters: the first rule whose alias is a substring of the tool name wins.
const ICON_RULES: readonly IconRule[] = [
	{ icon: Terminal, match: ["run_command", "bash", "shell", "exec"] },
	{
		icon: Pencil,
		match: ["editor", "apply_patch", "edit_file", "edit", "write"],
	},
	{ icon: SearchCode, match: ["search", "grep", "explore"] },
	{ icon: Files, match: ["read_file", "read", "file"] },
	{ icon: PanelsTopLeft, match: ["fetch_web", "web_fetch", "web", "fetch"] },
	{ icon: Library, match: ["skill"] },
	{ icon: Users, match: ["team"] },
	{ icon: User, match: ["spawn_agent", "subagent", "agent"] },
	{ icon: Box, match: ["mcp"] },
	{ icon: Blocks, match: ["plugin"] },
	{ icon: SquareArrowRight, match: ["submit_and_exit", "submit"] },
	{
		icon: MessageCircleQuestionMark,
		match: ["ask_question", "question", "ask"],
	},
];

export function toolIcon(name: string): LucideIcon {
	const normalized = name.toLowerCase();
	for (const rule of ICON_RULES) {
		if (rule.match.some((alias) => normalized.includes(alias))) {
			return rule.icon;
		}
	}
	return Wrench;
}

export interface DiffCounts {
	additions: number;
	deletions: number;
}

/** Best-effort +N/-N from a tool's input/output, or `undefined` when absent. */
export function diffCounts(
	name: string,
	input: unknown,
	output: unknown,
): DiffCounts | undefined {
	// A command can print a patch. That does not mean the command itself edited
	// those lines, so only edit-shaped tools earn transcript diff chips.
	if (!isEditTool(name)) {
		return undefined;
	}
	const typed = parseToolDiff(name, input, output);
	if (typed.length > 0) {
		return typed.reduce(
			(total, file) => ({
				additions: total.additions + file.additions,
				deletions: total.deletions + file.deletions,
			}),
			{ additions: 0, deletions: 0 },
		);
	}
	const fromFields =
		parseEditorResultDiffCounts(output) ??
		countFromFields(input) ??
		countFromFields(output);
	if (fromFields) {
		return fromFields;
	}
	const fromDiff =
		countFromDiff(asString(input)) ?? countFromDiff(asString(output));
	return fromDiff;
}

function countFromFields(value: unknown): DiffCounts | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const additions = numeric(
		record.additions ?? record.linesAdded ?? record.added,
	);
	const deletions = numeric(
		record.deletions ?? record.linesRemoved ?? record.removed,
	);
	if (additions === undefined && deletions === undefined) {
		return undefined;
	}
	return { additions: additions ?? 0, deletions: deletions ?? 0 };
}

function countFromDiff(text: string | undefined): DiffCounts | undefined {
	if (!text || !text.includes("\n")) {
		return undefined;
	}
	const { additions, deletions } = countDiffLines(text);
	return additions === 0 && deletions === 0
		? undefined
		: { additions, deletions };
}

function numeric(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

/** Desktop's shared label, with native failure status kept explicit. */
export function toolLabel(
	name: string,
	state: "running" | "completed" | "failed",
	input: unknown,
	approvalStatus?: ToolApprovalStatus,
): string {
	let summaryInput = input;
	if (isEditTool(name) && !name.toLowerCase().includes("patch")) {
		const editor = normalizeEditorInput(input);
		if (editor) {
			// Labels need the edit shape/path, not a quadratic comparison of full
			// file bodies. Empty strings preserve create/replace/insert semantics.
			summaryInput = {
				...editor,
				...(typeof editor.old_text === "string" ? { old_text: "" } : {}),
				...(typeof editor.new_text === "string" ? { new_text: "" } : {}),
			};
		}
	}
	const summary = buildToolSummary({
		toolName: name,
		input: summaryInput,
		inProgress: state === "running",
		isError: state === "failed",
	});
	if (approvalStatus || state === "failed") {
		// A pending/denied/failed tool must not claim it already ran or edited files.
		const action = neutralToolAction(summary);
		const status =
			approvalStatus === "pending"
				? "Waiting for approval"
				: approvalStatus === "denied"
					? "Denied"
					: approvalStatus === "expired"
						? "Approval expired"
						: approvalStatus === "cancelled"
							? "Approval cancelled"
							: "Failed";
		return `${status}: ${action}`;
	}
	return summary.label;
}

function neutralToolAction(
	summary: ReturnType<typeof buildToolSummary>,
): string {
	const details = summary.items.flatMap((item) => {
		switch (item.type) {
			case "command":
				return [item.command];
			case "file":
				return [item.displayPath];
			case "query":
				return [item.query];
			case "url":
				return [item.url];
			default:
				return [];
		}
	});
	const noun =
		summary.kind === "command"
			? "command"
			: summary.kind === "edit"
				? "file change"
				: summary.kind === "read"
					? "file read"
					: summary.kind === "search"
						? "search"
						: summary.kind === "web"
							? "web request"
							: `tool ${summary.toolName}`;
	return `${noun}${details.length ? ` ${details.join("; ")}` : ""}`;
}

/** The command/output body shown when a tool card is expanded. */
export function toolPreview(
	input: unknown,
	output: unknown,
): string | undefined {
	const command = commandFrom(input);
	const out = asString(output);
	if (command && out) {
		return `$ ${command}\n${out}`;
	}
	if (command) {
		return `$ ${command}`;
	}
	if (out) {
		return out;
	}
	return asString(input);
}

function commandFrom(input: unknown): string | undefined {
	if (typeof input === "string") {
		return input;
	}
	if (typeof input !== "object" || input === null) {
		return undefined;
	}
	const record = input as Record<string, unknown>;
	const candidate =
		record.command ?? record.cmd ?? record.query ?? record.script;
	if (typeof candidate === "string") {
		return candidate;
	}
	if (Array.isArray(candidate)) {
		return candidate.filter((part) => typeof part === "string").join(" ");
	}
	return undefined;
}

function asString(value: unknown): string | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value === "string") {
		return value;
	}
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}
