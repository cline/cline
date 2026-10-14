import {
	PINNED_READ_EVERY_MINUTES,
	PINNED_READS_MAX,
	PINNED_SUMMARY_ITEMS,
	PINNED_SUMMARY_MAX,
} from "../config";
import { type DatedLine, datedFacts, mentionOnlyFacts } from "../context/facts";
import { clip } from "../context/redact";
import type { Facts, SourceEnv, SourceState } from "../context/source";
import type { PinnedRead } from "../settings/settings";
import { isRecord } from "../values";
import type { Access, Connector, ReadScope, Route } from "./connector";

/**
 * Pinned reads: Read on an MCP server or a Composio toolkit
 * runs only tools the person pinned, each with fixed arguments, in the
 * background. Neither MCP descriptors nor Composio schemas say whether a tool
 * has side effects, so a tool is pinnable only when its name reads as a
 * lookup and contains no write verb anywhere. The person's pin is the second
 * key.
 *
 * Results never reach the planner raw: each becomes one bounded, redacted
 * line (a count and a few names for lists, a clipped first line for text).
 */

const READ_VERBS: ReadonlySet<string> = new Set([
	"get",
	"list",
	"search",
	"read",
	"fetch",
	"find",
	"query",
	"describe",
	"show",
	"view",
	"count",
	"lookup",
	"retrieve",
]);
const WRITE_VERBS: ReadonlySet<string> = new Set([
	"create",
	"update",
	"delete",
	"remove",
	"write",
	"post",
	"send",
	"merge",
	"push",
	"close",
	"reopen",
	"approve",
	"assign",
	"comment",
	"add",
	"set",
	"edit",
	"patch",
	"put",
	"execute",
	"trigger",
	"cancel",
	"archive",
	"move",
	"rename",
	"upload",
	"invite",
	"reply",
	"star",
	"fork",
	"lock",
	"dispatch",
	"mark",
	"submit",
	"resolve",
	"dismiss",
	"transfer",
]);

/** `listIssues`, `list_issues` and `list-issues` all read as ["list", "issues"]. */
function toolWords(name: string): string[] {
	return name
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.split(/[\s_\-.:/]+/)
		.map((word) => word.toLowerCase())
		.filter(Boolean);
}

/** A tool's name without its namespace (`linear_list_issues` → `list_issues` for toolkit `linear`). */
function bareToolName(tool: string, namespace?: string): string {
	const prefix = namespace ? `${namespace.toLowerCase()}_` : "";
	return prefix && tool.toLowerCase().startsWith(prefix)
		? tool.slice(prefix.length)
		: tool;
}

/** Starts with a read verb and has no write verb as any word: `list_comments` yes, `add_comment` and `get_and_close_issue` no. */
export function readOnlyToolName(tool: string, namespace?: string): boolean {
	const words = toolWords(bareToolName(tool, namespace));
	return (
		READ_VERBS.has(words[0] ?? "") &&
		!words.some((word) => WRITE_VERBS.has(word))
	);
}

export type ToolDescriptor = {
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
};
export type Pinnable = { name: string; pinnable: boolean; reason?: string };

/** The settings page's tool list for a server or toolkit: which tools may be pinned, and why not. */
export function pinnableTools(
	tools: readonly ToolDescriptor[],
	namespace?: string,
): Pinnable[] {
	return tools.map((tool) =>
		readOnlyToolName(tool.name, namespace)
			? { name: tool.name, pinnable: true }
			: {
					name: tool.name,
					pinnable: false,
					reason:
						"Its name does not read as a lookup, so it may change something",
				},
	);
}

/** Required arguments the pin leaves out, from the tool's JSON schema. */
export function missingArguments(
	schema: Record<string, unknown> | undefined,
	args: Record<string, unknown>,
): string[] {
	const required = Array.isArray(schema?.required)
		? schema.required.filter((key): key is string => typeof key === "string")
		: [];
	return required.filter((key) => !(key in args));
}

const LABEL_FIELDS = [
	"title",
	"name",
	"summary",
	"subject",
	"key",
	"identifier",
	"number",
	"id",
] as const;

function itemLabel(item: unknown): string | undefined {
	if (typeof item === "string" || typeof item === "number") return String(item);
	if (!isRecord(item)) return undefined;
	for (const field of LABEL_FIELDS) {
		const value = item[field];
		if (typeof value === "string" || typeof value === "number")
			return String(value);
	}
	return undefined;
}

function outlineList(items: readonly unknown[]): string {
	const labels = items
		.map(itemLabel)
		.filter((label): label is string => Boolean(label));
	const shown = labels
		.slice(0, PINNED_SUMMARY_ITEMS)
		.map((label) => clip(label, PINNED_SUMMARY_MAX));
	const noun = items.length === 1 ? "item" : "items";
	return shown.length > 0
		? `${items.length} ${noun}: ${shown.join("; ")}${labels.length > shown.length ? "; …" : ""}`
		: `${items.length} ${noun}`;
}

function outline(value: unknown): string {
	if (Array.isArray(value)) return outlineList(value);
	if (isRecord(value)) {
		const list = Object.values(value).find(Array.isArray);
		if (list) return outlineList(list);
		const label = itemLabel(value);
		return label
			? clip(label, PINNED_SUMMARY_MAX)
			: `${Object.keys(value).length} fields`;
	}
	return clip(String(value), PINNED_SUMMARY_MAX);
}

function parsed(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/**
 * One line from a tool result: MCP's `{ content: [{ type: "text", text }], isError,
 * structuredContent }`, Composio's `{ successful, data, error }`, or plain JSON.
 */
export function summarizeResult(result: unknown): string {
	if (isRecord(result)) {
		if (result.isError === true || result.successful === false)
			return "the read failed";
		if (result.structuredContent !== undefined)
			return outline(result.structuredContent);
		if (result.data !== undefined) return outline(result.data);
		if (Array.isArray(result.content)) {
			const text = result.content
				.filter(
					(part): part is Record<string, unknown> =>
						isRecord(part) &&
						part.type === "text" &&
						typeof part.text === "string",
				)
				.map((part) => String(part.text))
				.join("\n");
			const json = parsed(text);
			return json !== undefined
				? outline(json)
				: clip(
						text.split("\n").find((line) => line.trim()) ?? "empty",
						PINNED_SUMMARY_MAX,
					);
		}
	}
	return outline(result);
}

/** Runs one pinned tool through the person's own Cline connection. */
export type ToolRunner = (
	tool: string,
	args: Record<string, unknown>,
) => Promise<unknown>;

/** The runner, or why reading is not possible here: a missing server, or a connection Cline does not expose to plugins. */
export type ResolveRunner = () => Promise<ToolRunner | { reason: string }>;

/** What a pinned-read connector needs from the chat. */
export type PinnedReadDeps = {
	runner: ResolveRunner;
	reads: () => readonly PinnedRead[];
	access: () => Access;
	now?: () => number;
};

type PinnedReadConnectorOptions = PinnedReadDeps & {
	id: string;
	label: string;
	namespace?: string;
	route: Pick<Route, "id" | "label">;
};

export class PinnedReadConnector implements Connector {
	readonly id: string;
	readonly tier = "T3" as const;
	private readonly cache = new Map<string, DatedLine>();

	constructor(private readonly options: PinnedReadConnectorOptions) {
		this.id = options.id;
	}

	private now(): number {
		return (this.options.now ?? Date.now)();
	}

	/** The pins that may run: read-only names, at most `PINNED_READS_MAX`. */
	private pins(): PinnedRead[] {
		return this.options
			.reads()
			.filter((read) => readOnlyToolName(read.tool, this.options.namespace))
			.slice(0, PINNED_READS_MAX);
	}

	get scopes(): readonly ReadScope[] {
		return this.pins().map((read) => ({
			id: read.id,
			label: read.label ?? read.tool,
			everyMinutes: PINNED_READ_EVERY_MINUTES,
		}));
	}

	probe(): SourceState {
		return this.options.access().role === "off" ? "absent" : "present";
	}

	capabilities(): string[] {
		return [this.id];
	}

	async refresh(scope: string): Promise<void> {
		const access = this.options.access();
		const read = this.pins().find((pin) => pin.id === scope);
		if (!access.readAllowed || !access.scopes.includes(scope) || !read) return;
		const runner = await this.options.runner();
		if (typeof runner !== "function") return;
		const fetchedAt = this.now();
		const line = summarizeResult(await runner(read.tool, read.arguments));
		this.cache.set(scope, {
			fetchedAt,
			line: `${clip(read.label ?? read.tool, PINNED_SUMMARY_MAX)}: ${line}`,
		});
	}

	facts(_env: SourceEnv): Facts | "unknown" {
		const { label, route } = this.options;
		const access = this.options.access();
		return access.readAllowed
			? datedFacts(
					label,
					access.scopes.flatMap((scope) => this.cache.get(scope) ?? []),
					this.now(),
				)
			: mentionOnlyFacts(label, "its tools", route.label);
	}
}
