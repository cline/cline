import type { CoreAgentMode } from "../../types/config";
import {
	DEFAULT_MODEL_TOOL_ROUTING_RULES,
	resolveToolRoutingConfig,
} from "./model-tool-routing";
import { resolveToolPresetName, ToolPresets } from "./presets";
import { createSpawnAgentTool } from "./team/spawn-agent-tool";
import { TEAM_TOOL_NAMES } from "./team/team-tools";
import type { DefaultToolsConfig } from "./types";

export interface ToolCatalogEntry {
	id: string;
	description: string;
	defaultEnabled: boolean;
	headlessToolNames: string[];
}

export interface BuiltinToolAvailabilityContext {
	mode?: CoreAgentMode;
	providerId?: string;
	modelId?: string;
	enableSpawnAgent?: boolean;
	enableAgentTeams?: boolean;
	disabledToolIds?: ReadonlySet<string>;
}

type RuntimeToolCatalogEntry = Omit<ToolCatalogEntry, "defaultEnabled">;

const BASE_TOOL_CATALOG: readonly RuntimeToolCatalogEntry[] = [
	{
		id: "read_files",
		description:
			"Read the full content of text or image files at the provided absolute paths, or return only an inclusive one-based line range when start_line/end_line are provided.",
		headlessToolNames: ["read_files"],
	},
	{
		id: "search_codebase",
		description:
			"Perform regex pattern searches across the codebase for code patterns, definitions, imports, and other text matches.",
		headlessToolNames: ["search_codebase"],
	},
	{
		id: "run_commands",
		description:
			"Run shell commands from the root of the workspace for listing files, checking git status, builds, tests, and similar tasks.",
		headlessToolNames: ["run_commands"],
	},
	{
		id: "editor",
		description:
			"Make controlled filesystem edits on text files with create, replace, and insert operations.",
		headlessToolNames: ["editor"],
	},
	{
		id: "fetch_web_content",
		description:
			"Fetch URL content and analyze it with a prompt describing what to extract.",
		headlessToolNames: ["fetch_web_content"],
	},
	{
		id: "skills",
		description:
			"Execute a configured skill within the main conversation when a matching skill exists for the task.",
		headlessToolNames: ["skills"],
	},
	{
		id: "ask_question",
		description:
			"Ask the user a single clarifying question with 2-5 selectable options.",
		headlessToolNames: ["ask_question"],
	},
	{
		id: "spawn_agent",
		description: createSpawnAgentTool({ configProvider: {} as never })
			.description,
		headlessToolNames: ["spawn_agent"],
	},
	{
		id: "teams",
		description:
			"Enable team collaboration tools for teammate management, task coordination, mailbox messaging, mission logs, and outcomes.",
		headlessToolNames: [...TEAM_TOOL_NAMES],
	},
] as const;

const TOOL_NAME_TO_FLAG: Partial<
	Record<
		string,
		keyof Pick<
			DefaultToolsConfig,
			| "enableReadFiles"
			| "enableSearch"
			| "enableBash"
			| "enableWebFetch"
			| "enableApplyPatch"
			| "enableEditor"
			| "enableSkills"
			| "enableAskQuestion"
			| "enableSubmitAndExit"
		>
	>
> = {
	read_files: "enableReadFiles",
	search_codebase: "enableSearch",
	run_commands: "enableBash",
	fetch_web_content: "enableWebFetch",
	apply_patch: "enableApplyPatch",
	editor: "enableEditor",
	skills: "enableSkills",
	ask_question: "enableAskQuestion",
};

function resolveContextMode(
	mode?: BuiltinToolAvailabilityContext["mode"],
): CoreAgentMode {
	return mode === "plan" || mode === "yolo" ? mode : "act";
}

type ResolvedToolFlags = Pick<
	DefaultToolsConfig,
	| "enableReadFiles"
	| "enableSearch"
	| "enableBash"
	| "enableWebFetch"
	| "enableApplyPatch"
	| "enableEditor"
	| "enableSkills"
	| "enableAskQuestion"
	| "enableSubmitAndExit"
> & {
	enableSpawnAgent?: boolean;
	enableAgentTeams?: boolean;
};

function resolvePresetFlags(context: BuiltinToolAvailabilityContext): {
	mode: CoreAgentMode;
	flags: ResolvedToolFlags;
} {
	const mode = resolveContextMode(context.mode);
	const preset = ToolPresets[resolveToolPresetName({ mode })];
	const routed = resolveToolRoutingConfig(
		context.providerId ?? "",
		context.modelId ?? "",
		mode,
		DEFAULT_MODEL_TOOL_ROUTING_RULES,
	);
	return {
		mode,
		flags: {
			...preset,
			...routed,
			...(typeof context.enableSpawnAgent === "boolean"
				? { enableSpawnAgent: context.enableSpawnAgent }
				: {}),
			...(typeof context.enableAgentTeams === "boolean"
				? { enableAgentTeams: context.enableAgentTeams }
				: {}),
		},
	};
}

function isEntryEnabledByDefault(
	entryId: string,
	context: BuiltinToolAvailabilityContext,
): boolean {
	if (context.disabledToolIds?.has(entryId)) {
		return false;
	}

	const { flags } = resolvePresetFlags(context);
	if (entryId === "spawn_agent") {
		return flags.enableSpawnAgent === true;
	}
	if (entryId === "teams") {
		return flags.enableAgentTeams === true;
	}
	if (entryId === "editor") {
		return flags.enableEditor === true || flags.enableApplyPatch === true;
	}

	const flag = TOOL_NAME_TO_FLAG[entryId];
	return flag ? flags[flag] === true : false;
}

function buildCatalogEntry(
	entry: RuntimeToolCatalogEntry,
	context: BuiltinToolAvailabilityContext,
): ToolCatalogEntry {
	if (entry.id === "editor") {
		const { flags } = resolvePresetFlags(context);
		const usesApplyPatch =
			flags.enableApplyPatch === true && flags.enableEditor !== true;
		return {
			...entry,
			defaultEnabled: isEntryEnabledByDefault(entry.id, context),
			headlessToolNames: [usesApplyPatch ? "apply_patch" : "editor"],
		};
	}

	return {
		...entry,
		defaultEnabled: isEntryEnabledByDefault(entry.id, context),
	};
}

export function getCoreBuiltinToolCatalog(
	context: BuiltinToolAvailabilityContext = {},
): ToolCatalogEntry[] {
	return BASE_TOOL_CATALOG.map((entry) => buildCatalogEntry(entry, context));
}

export function getCoreDefaultEnabledToolIds(
	context: BuiltinToolAvailabilityContext = {},
): string[] {
	return getCoreBuiltinToolCatalog(context)
		.filter((entry) => entry.defaultEnabled)
		.map((entry) => entry.id);
}

export function resolveCoreSelectedToolIds(input: {
	enabled: boolean;
	allowlist?: string[];
	availabilityContext?: BuiltinToolAvailabilityContext;
}): Set<string> {
	if (!input.enabled) {
		return new Set();
	}

	const catalog = getCoreBuiltinToolCatalog(input.availabilityContext);
	const known = new Set(catalog.map((entry) => entry.id));
	if (!input.allowlist || input.allowlist.length === 0) {
		return new Set(
			catalog.filter((entry) => entry.defaultEnabled).map((entry) => entry.id),
		);
	}

	for (const id of input.allowlist) {
		if (!known.has(id)) {
			throw new Error(
				`Unknown tool "${id}". Available tools: ${catalog.map((entry) => entry.id).join(", ")}`,
			);
		}
	}
	return new Set(input.allowlist);
}

export function getCoreHeadlessToolNames(
	selectedToolIds: ReadonlySet<string>,
	context: BuiltinToolAvailabilityContext = {},
): string[] {
	return getCoreBuiltinToolCatalog(context)
		.filter((entry) => selectedToolIds.has(entry.id))
		.flatMap((entry) => entry.headlessToolNames);
}

export function getCoreAcpToolNames(
	selectedToolIds: ReadonlySet<string>,
	context: BuiltinToolAvailabilityContext = {},
): string[] {
	return getCoreHeadlessToolNames(selectedToolIds, context);
}
