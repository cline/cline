import type { HookStage } from "../hooks/contracts";
import type { Tool } from "../llms/tools";

export interface AgentExtensionCommand {
	name: string;
	description?: string;
	handler?: (input: string) => Promise<string> | string;
}

export interface AgentExtensionMessageBuilder<TMessage = unknown> {
	name: string;
	build: (message: TMessage) => TMessage;
}

export interface AgentExtensionProvider {
	name: string;
	description?: string;
	metadata?: Record<string, unknown>;
}

/**
 * API surface passed to an extension's `setup()` method.
 *
 * Use it to register the contributions the extension wants to make — tools,
 * commands, message builders, and providers. All registrations accumulate into
 * the `ContributionRegistry` and are available to the host after `setup()`
 * completes.
 */
export interface AgentExtensionApi<TTool = Tool, TMessage = unknown> {
	/** Register a tool the agent can invoke during its run. Requires the `tools` capability. */
	registerTool: (tool: TTool) => void;
	/** Register a slash command available in connected chat surfaces. Requires the `commands` capability. */
	registerCommand: (command: AgentExtensionCommand) => void;
	/** Register a named message builder for transforming messages before they are sent. Requires the `messageBuilders` capability. */
	registerMessageBuilder: (
		builder: AgentExtensionMessageBuilder<TMessage>,
	) => void;
	/** Register a provider contribution (e.g. a custom model provider). Requires the `providers` capability. */
	registerProvider: (provider: AgentExtensionProvider) => void;
}

const ExtensionCapabilityOptions = [
	"hooks",
	"tools",
	"commands",
	"messageBuilders",
	"providers",
] as const;

export type AgentExtensionCapability =
	(typeof ExtensionCapabilityOptions)[number];

export type AgentExtensionHookStage = HookStage;

export interface PluginManifest {
	paths?: string[];
	capabilities: AgentExtensionCapability[];
	hookStages?: AgentExtensionHookStage[];
	providerIds?: string[];
	modelIds?: string[];
}

export interface AgentExtensionRegistry<TTool = Tool, TMessage = unknown> {
	tools: TTool[];
	commands: AgentExtensionCommand[];
	messageBuilder: AgentExtensionMessageBuilder<TMessage>[];
	providers: AgentExtensionProvider[];
}

/**
 * Base shape for a plugin or extension that can be loaded into a
 * `ContributionRegistry`.
 *
 * An extension declares what it does through its `manifest` (capabilities and
 * hook stages) and implements the corresponding handler methods. The registry
 * validates at setup time that every declared stage has a matching handler and
 * that no undeclared handlers are present.
 *
 * Hook handler properties are typed `unknown` here so that the generic base
 * interface stays free of agent-specific imports. Concrete extension types
 * (e.g. `AgentExtension` in `@clinebot/agents`) narrow them to the correct
 * context and return types.
 */
export interface ContributionRegistryExtension<TTool = Tool> {
	/** Unique identifier for this extension, used in error messages and hook handler names. */
	name: string;
	/** Declares what capabilities and hook stages this extension uses. Validated before `setup()` runs. */
	manifest: PluginManifest;
	/** Indicates whether this extension is disabled. Disabled extensions are ignored during setup. */
	disabled?: boolean;
	/** Called once during registry setup to register tools, commands, and other contributions. */
	setup?: (api: AgentExtensionApi<TTool, any>) => void | Promise<void>;
	/** Handler for the `input` stage — fired when the user submits input. */
	onInput?: unknown;
	/** Handler for the `runtime_event` stage — fired on every agent event emitted during a run. */
	onRuntimeEvent?: unknown;
	/** Handler for the `session_start` stage — fired once when the session is initialized. */
	onSessionStart?: unknown;
	/** Handler for the `run_start` stage — fired once per `run()` / `continue()` before the first iteration. */
	onRunStart?: unknown;
	/** Handler for the `iteration_start` stage — fired at the top of every loop iteration. */
	onIterationStart?: unknown;
	/** Handler for the `turn_start` stage — fired after iteration setup, before prompt preparation. */
	onTurnStart?: unknown;
	/** Handler for the `before_agent_start` stage — fired immediately before the model call; last chance to modify the system prompt or messages. */
	onBeforeAgentStart?: unknown;
	/** Handler for the `tool_call_before` stage — fired before each individual tool executes. */
	onToolCall?: unknown;
	/** Handler for the `tool_call_after` stage — fired after each individual tool executes. */
	onToolResult?: unknown;
	/** Handler for the `turn_end` stage — fired after the model responds, before tool calls execute. */
	onTurnEnd?: unknown;
	/** Handler for the `stop_error` stage — fired when a turn error stops forward progress. */
	onAgentError?: unknown;
	/** Handler for the `iteration_end` stage — fired at the end of a loop iteration, after all tool calls complete. */
	onIterationEnd?: unknown;
	/** Handler for the `run_end` stage — fired once after the agent loop finishes. */
	onRunEnd?: unknown;
	/** Handler for the `session_shutdown` stage — fired when the session is shutting down. */
	onSessionShutdown?: unknown;
	/** Handler for the `error` stage — fired when an unhandled error is thrown in the agent loop. */
	onError?: unknown;
}

export interface ContributionRegistryOptions<
	TExtension extends ContributionRegistryExtension<TTool>,
	TTool = Tool,
> {
	extensions?: TExtension[];
}

interface NormalizedExtension<
	TExtension extends ContributionRegistryExtension<TTool>,
	TTool,
> {
	extension: TExtension;
	order: number;
	manifest: {
		capabilities: Set<AgentExtensionCapability>;
		hookStages: Set<AgentExtensionHookStage>;
		raw: PluginManifest;
	};
}

const ALLOWED_CAPABILITIES = new Set<AgentExtensionCapability>(
	ExtensionCapabilityOptions,
);

const ALLOWED_HOOK_STAGES = new Set<AgentExtensionHookStage>([
	"input",
	"runtime_event",
	"session_start",
	"run_start",
	"iteration_start",
	"turn_start",
	"before_agent_start",
	"tool_call_before",
	"tool_call_after",
	"turn_end",
	"stop_error",
	"iteration_end",
	"run_end",
	"session_shutdown",
	"error",
]);

const STAGE_TO_HANDLER: Record<
	AgentExtensionHookStage,
	keyof Pick<
		ContributionRegistryExtension,
		| "onInput"
		| "onRuntimeEvent"
		| "onSessionStart"
		| "onRunStart"
		| "onIterationStart"
		| "onTurnStart"
		| "onBeforeAgentStart"
		| "onToolCall"
		| "onToolResult"
		| "onTurnEnd"
		| "onAgentError"
		| "onIterationEnd"
		| "onRunEnd"
		| "onSessionShutdown"
		| "onError"
	>
> = {
	input: "onInput",
	runtime_event: "onRuntimeEvent",
	session_start: "onSessionStart",
	run_start: "onRunStart",
	iteration_start: "onIterationStart",
	turn_start: "onTurnStart",
	before_agent_start: "onBeforeAgentStart",
	tool_call_before: "onToolCall",
	tool_call_after: "onToolResult",
	turn_end: "onTurnEnd",
	stop_error: "onAgentError",
	iteration_end: "onIterationEnd",
	run_end: "onRunEnd",
	session_shutdown: "onSessionShutdown",
	error: "onError",
};

function asExtensionName(
	extension: ContributionRegistryExtension<any>,
	order: number,
): string {
	return extension.name || `extension_${String(order).padStart(4, "0")}`;
}

function hasValidStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((entry) => typeof entry === "string")
	);
}

function normalizeOptionalStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const normalized = value
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
	return normalized.length > 0 ? normalized : undefined;
}

export function normalizePluginManifest(
	manifest: PluginManifest,
): PluginManifest {
	const providerIds = normalizeOptionalStringArray(manifest.providerIds);
	const modelIds = normalizeOptionalStringArray(manifest.modelIds);
	return {
		...manifest,
		...(providerIds ? { providerIds } : {}),
		...(modelIds ? { modelIds } : {}),
	};
}

function hasHookHandlers(
	extension: ContributionRegistryExtension<any>,
): boolean {
	return (
		typeof extension.onInput === "function" ||
		typeof extension.onRuntimeEvent === "function" ||
		typeof extension.onSessionStart === "function" ||
		typeof extension.onRunStart === "function" ||
		typeof extension.onIterationStart === "function" ||
		typeof extension.onTurnStart === "function" ||
		typeof extension.onBeforeAgentStart === "function" ||
		typeof extension.onToolCall === "function" ||
		typeof extension.onToolResult === "function" ||
		typeof extension.onTurnEnd === "function" ||
		typeof extension.onAgentError === "function" ||
		typeof extension.onIterationEnd === "function" ||
		typeof extension.onRunEnd === "function" ||
		typeof extension.onSessionShutdown === "function" ||
		typeof extension.onError === "function"
	);
}

function normalizeManifest<
	TExtension extends ContributionRegistryExtension<TTool>,
	TTool,
>(
	extension: TExtension,
	order: number,
): NormalizedExtension<TExtension, TTool>["manifest"] {
	const extensionName = asExtensionName(extension, order);
	const manifest = extension.manifest;
	if (!manifest || typeof manifest !== "object") {
		throw new Error(
			`Invalid manifest for extension "${extensionName}": manifest is required`,
		);
	}
	if (
		!Array.isArray(manifest.capabilities) ||
		manifest.capabilities.length === 0
	) {
		throw new Error(
			`Invalid manifest for extension "${extensionName}": capabilities must be a non-empty array`,
		);
	}

	const capabilities = new Set<AgentExtensionCapability>();
	for (const capability of manifest.capabilities) {
		if (!ALLOWED_CAPABILITIES.has(capability)) {
			throw new Error(
				`Invalid manifest for extension "${extensionName}": unsupported capability "${String(capability)}"`,
			);
		}
		capabilities.add(capability);
	}

	const rawStages = manifest.hookStages ?? [];
	if (!Array.isArray(rawStages)) {
		throw new Error(
			`Invalid manifest for extension "${extensionName}": hookStages must be an array when provided`,
		);
	}
	if (
		Object.hasOwn(manifest, "providerIds") &&
		!hasValidStringArray(manifest.providerIds)
	) {
		throw new Error(
			`Invalid manifest for extension "${extensionName}": providerIds must be a string array when provided`,
		);
	}
	if (
		Object.hasOwn(manifest, "modelIds") &&
		!hasValidStringArray(manifest.modelIds)
	) {
		throw new Error(
			`Invalid manifest for extension "${extensionName}": modelIds must be a string array when provided`,
		);
	}
	const hookStages = new Set<AgentExtensionHookStage>();
	for (const stage of rawStages) {
		if (!ALLOWED_HOOK_STAGES.has(stage)) {
			throw new Error(
				`Invalid manifest for extension "${extensionName}": unsupported hook stage "${String(stage)}"`,
			);
		}
		hookStages.add(stage);
	}

	const hookCapabilityEnabled = capabilities.has("hooks");
	const extensionDefinesHooks = hasHookHandlers(extension);
	if (extensionDefinesHooks && !hookCapabilityEnabled) {
		throw new Error(
			`Invalid manifest for extension "${extensionName}": hook handlers require the "hooks" capability`,
		);
	}
	if (hookCapabilityEnabled && hookStages.size === 0) {
		throw new Error(
			`Invalid manifest for extension "${extensionName}": hooks capability requires at least one hook stage`,
		);
	}

	for (const stage of hookStages) {
		const handler = STAGE_TO_HANDLER[stage];
		if (typeof extension[handler] !== "function") {
			throw new Error(
				`Invalid manifest for extension "${extensionName}": stage "${stage}" is declared but handler "${handler}" is missing`,
			);
		}
	}

	for (const [stage, handler] of Object.entries(STAGE_TO_HANDLER) as Array<
		[
			AgentExtensionHookStage,
			(typeof STAGE_TO_HANDLER)[AgentExtensionHookStage],
		]
	>) {
		if (typeof extension[handler] === "function" && !hookStages.has(stage)) {
			throw new Error(
				`Invalid manifest for extension "${extensionName}": handler "${handler}" must declare stage "${stage}"`,
			);
		}
	}

	return {
		capabilities,
		hookStages,
		raw: normalizePluginManifest(manifest),
	};
}

export class ContributionRegistry<
	TExtension extends ContributionRegistryExtension<TTool>,
	TTool = Tool,
	TMessage = unknown,
> {
	private readonly extensions: TExtension[];
	private readonly registry: AgentExtensionRegistry<TTool, TMessage> = {
		tools: [],
		commands: [],
		messageBuilder: [],
		providers: [],
	};
	private normalized: NormalizedExtension<TExtension, TTool>[] = [];
	private phase: "resolve" | "validate" | "setup" | "activate" | "run" =
		"resolve";

	constructor(options: ContributionRegistryOptions<TExtension, TTool> = {}) {
		this.extensions = options.extensions ?? [];
	}

	resolve(): void {
		if (this.phase !== "resolve") return;
		this.normalized = this.extensions.map((extension, order) => ({
			extension,
			order,
			manifest: {
				capabilities: new Set(),
				hookStages: new Set(),
				raw: extension.manifest,
			},
		}));
		this.phase = "validate";
	}

	validate(): void {
		if (this.phase === "resolve") this.resolve();
		if (this.phase !== "validate") return;
		this.normalized = this.normalized.map((entry) => ({
			...entry,
			manifest: normalizeManifest<TExtension, TTool>(
				entry.extension,
				entry.order,
			),
		}));
		this.phase = "setup";
	}

	async setup(): Promise<void> {
		if (this.phase === "resolve") this.resolve();
		if (this.phase === "validate") this.validate();
		if (this.phase !== "setup") return;

		const api: AgentExtensionApi<TTool, TMessage> = {
			registerTool: (tool) => this.registry.tools.push(tool),
			registerCommand: (command) => this.registry.commands.push(command),
			registerMessageBuilder: (builder) =>
				this.registry.messageBuilder.push(builder),
			registerProvider: (provider) => this.registry.providers.push(provider),
		};

		for (const { extension } of this.normalized) {
			if (extension.disabled) continue;
			await extension.setup?.(api);
		}
		this.phase = "activate";
	}

	activate(): void {
		if (this.phase === "resolve") this.resolve();
		if (this.phase === "validate") this.validate();
		if (this.phase === "setup") {
			throw new Error(
				"Contribution registry setup must complete before activation",
			);
		}
		if (this.phase !== "activate") return;
		this.phase = "run";
	}

	async initialize(): Promise<void> {
		this.resolve();
		this.validate();
		await this.setup();
		this.activate();
	}

	isActivated(): boolean {
		return this.phase === "run";
	}

	getRegistrySnapshot(): AgentExtensionRegistry<TTool, TMessage> {
		return {
			tools: [...this.registry.tools],
			commands: [...this.registry.commands],
			messageBuilder: [...this.registry.messageBuilder],
			providers: [...this.registry.providers],
		};
	}

	getRegisteredTools(): TTool[] {
		return [...this.registry.tools];
	}

	getValidatedExtensions(): TExtension[] {
		if (this.phase === "resolve") this.resolve();
		if (this.phase === "validate") this.validate();
		return this.normalized
			.slice()
			.sort((a, b) => a.order - b.order)
			.map(({ extension }) => extension);
	}
}

export function createContributionRegistry<
	TExtension extends ContributionRegistryExtension<TTool>,
	TTool = Tool,
	TMessage = unknown,
>(
	options: ContributionRegistryOptions<TExtension, TTool> = {},
): ContributionRegistry<TExtension, TTool, TMessage> {
	return new ContributionRegistry(options);
}
