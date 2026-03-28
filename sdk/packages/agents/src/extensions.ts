import type {
	AgentExtension,
	AgentExtensionApi,
	AgentExtensionCapability,
	AgentExtensionHookStage,
	AgentExtensionRegistry,
	PluginManifest,
	Tool,
} from "./types";

export interface ContributionRegistryOptions {
	extensions?: AgentExtension[];
}

interface NormalizedExtension {
	extension: AgentExtension;
	order: number;
	manifest: {
		capabilities: Set<AgentExtensionCapability>;
		hookStages: Set<AgentExtensionHookStage>;
		raw: PluginManifest;
	};
}

const ALLOWED_CAPABILITIES = new Set<AgentExtensionCapability>([
	"hooks",
	"tools",
	"commands",
	"shortcuts",
	"flags",
	"message_renderers",
	"providers",
]);

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
		AgentExtension,
		| "onInput"
		| "onRuntimeEvent"
		| "onSessionStart"
		| "onRunStart"
		| "onIterationStart"
		| "onTurnStart"
		| "onBeforeAgentStart"
		| "onToolCall"
		| "onToolResult"
		| "onAgentEnd"
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
	turn_end: "onAgentEnd",
	stop_error: "onAgentError",
	iteration_end: "onIterationEnd",
	run_end: "onRunEnd",
	session_shutdown: "onSessionShutdown",
	error: "onError",
};

function asExtensionName(extension: AgentExtension, order: number): string {
	return extension.name || `extension_${String(order).padStart(4, "0")}`;
}

function hasHookHandlers(extension: AgentExtension): boolean {
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
		typeof extension.onAgentEnd === "function" ||
		typeof extension.onAgentError === "function" ||
		typeof extension.onIterationEnd === "function" ||
		typeof extension.onRunEnd === "function" ||
		typeof extension.onSessionShutdown === "function" ||
		typeof extension.onError === "function"
	);
}

function normalizeManifest(
	extension: AgentExtension,
	order: number,
): NormalizedExtension["manifest"] {
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
		raw: manifest,
	};
}

export class ContributionRegistry {
	private readonly extensions: AgentExtension[];
	private readonly registry: AgentExtensionRegistry = {
		tools: [],
		commands: [],
		shortcuts: [],
		flags: [],
		messageRenderers: [],
		providers: [],
	};
	private normalized: NormalizedExtension[] = [];
	private phase: "resolve" | "validate" | "setup" | "activate" | "run" =
		"resolve";

	constructor(options: ContributionRegistryOptions = {}) {
		this.extensions = options.extensions ?? [];
	}

	resolve(): void {
		if (this.phase !== "resolve") {
			return;
		}
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
		if (this.phase === "resolve") {
			this.resolve();
		}
		if (this.phase !== "validate") {
			return;
		}
		this.normalized = this.normalized.map((entry) => ({
			...entry,
			manifest: normalizeManifest(entry.extension, entry.order),
		}));
		this.phase = "setup";
	}

	async setup(): Promise<void> {
		if (this.phase === "resolve") {
			this.resolve();
		}
		if (this.phase === "validate") {
			this.validate();
		}
		if (this.phase !== "setup") {
			return;
		}

		const api: AgentExtensionApi = {
			registerTool: (tool) => this.registry.tools.push(tool),
			registerCommand: (command) => this.registry.commands.push(command),
			registerShortcut: (shortcut) => this.registry.shortcuts.push(shortcut),
			registerFlag: (flag) => this.registry.flags.push(flag),
			registerMessageRenderer: (renderer) =>
				this.registry.messageRenderers.push(renderer),
			registerProvider: (provider) => this.registry.providers.push(provider),
		};

		for (const { extension } of this.normalized) {
			await extension.setup?.(api);
		}
		this.phase = "activate";
	}

	activate(): void {
		if (this.phase === "resolve") {
			this.resolve();
		}
		if (this.phase === "validate") {
			this.validate();
		}
		if (this.phase === "setup") {
			throw new Error(
				"Contribution registry setup must complete before activation",
			);
		}
		if (this.phase !== "activate") {
			return;
		}
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

	getRegistrySnapshot(): AgentExtensionRegistry {
		return {
			tools: [...this.registry.tools],
			commands: [...this.registry.commands],
			shortcuts: [...this.registry.shortcuts],
			flags: [...this.registry.flags],
			messageRenderers: [...this.registry.messageRenderers],
			providers: [...this.registry.providers],
		};
	}

	getRegisteredTools(): Tool[] {
		return [...this.registry.tools];
	}

	getValidatedExtensions(): AgentExtension[] {
		if (this.phase === "resolve") {
			this.resolve();
		}
		if (this.phase === "validate") {
			this.validate();
		}
		return this.normalized
			.slice()
			.sort((a, b) => a.order - b.order)
			.map(({ extension }) => extension);
	}
}

export function createContributionRegistry(
	options: ContributionRegistryOptions = {},
): ContributionRegistry {
	return new ContributionRegistry(options);
}
