import type { AgentRuntimeHooks, AgentTool } from "../agent";
import type { AutomationEventEnvelope } from "../cron";
import type { BasicLogger } from "../logging/logger";
import type { ITelemetryService } from "../services/telemetry";
import type { WorkspaceInfo } from "../session/workspace";
import type { ClientContext, UserContext } from "./context";

export interface AgentExtensionCommand {
	name: string;
	description?: string;
	handler?: (input: string) => Promise<string> | string;
}

export interface AgentExtensionRule {
	id: string;
	content: string | (() => string | Promise<string>);
	source?: string;
}

export interface AgentExtensionMessageBuilder<TMessage = unknown> {
	name: string;
	build: (message: TMessage) => TMessage | Promise<TMessage>;
}

export interface AgentExtensionProvider {
	name: string;
	description?: string;
	metadata?: Record<string, unknown>;
}

export interface AgentExtensionAutomationEventType {
	/** Normalized event type a plugin can emit, e.g. `github.pull_request.opened`. */
	eventType: string;
	/** Normalized source identifier, e.g. `github`, `linear`, or `local`. */
	source: string;
	description?: string;
	attributesSchema?: Record<string, unknown>;
	payloadSchema?: Record<string, unknown>;
	examples?: AutomationEventEnvelope[];
	metadata?: Record<string, unknown>;
}

export interface AgentExtensionAutomationContext {
	/**
	 * Submit a normalized automation event to the host. Raw webhook or connector
	 * payloads should be translated into an `AutomationEventEnvelope` first.
	 */
	ingestEvent: (event: AutomationEventEnvelope) => void | Promise<void>;
}

export interface AgentExtensionSessionContext {
	/** Stable core session id for the root session that loaded the plugin. */
	sessionId?: string;
}

/**
 * API surface passed to an extension's `setup()` method.
 *
 * Use it to register the contributions the extension wants to make — tools,
 * commands, message builders, providers, and automation event types. All
 * registrations accumulate into the `ContributionRegistry` and are available to
 * the host after `setup()` completes.
 */
export interface AgentExtensionApi<TTool = AgentTool, TMessage = unknown> {
	/** Register a tool the agent can invoke during its run. Requires the `tools` capability. */
	registerTool: (tool: TTool) => void;
	/** Register a slash command available in connected chat surfaces. Requires the `commands` capability. */
	registerCommand: (command: AgentExtensionCommand) => void;
	/** Register prompt rules included in the runtime system prompt. Requires the `rules` capability. */
	registerRule: (rule: AgentExtensionRule) => void;
	/** Register a named message builder for transforming messages before they are sent. Requires the `messageBuilders` capability. */
	registerMessageBuilder: (
		builder: AgentExtensionMessageBuilder<TMessage>,
	) => void;
	/** Register a provider contribution (e.g. a custom model provider). Requires the `providers` capability. */
	registerProvider: (provider: AgentExtensionProvider) => void;
	/** Register a normalized automation event type the plugin can emit. Requires the `automationEvents` capability. */
	registerAutomationEventType: (
		eventType: AgentExtensionAutomationEventType,
	) => void;
}

export type AgentExtensionHooks = Partial<AgentRuntimeHooks>;

/**
 * Session-scoped workspace context passed as the second argument to an
 * extension's `setup(api, ctx)` method.
 *
 * These values are always sourced from the host session config — never from
 * `process.cwd()`. Use them to resolve paths or build workspace-aware tool
 * schemas at registration time.
 *
 * All fields are optional so `setup()` callers that do not have host context
 * (e.g. unit tests) can omit them without breaking plugins.
 */
export interface PluginSetupContext {
	/**
	 * Core session metadata known before the first agent run starts.
	 * Agent-level ids such as `agentId` and `conversationId` are available on
	 * lifecycle hook contexts once SessionRuntime creates them.
	 */
	session?: AgentExtensionSessionContext;
	/** Host/client identity such as `cline-cli`, `cline-vscode`, or an SDK app. */
	client?: ClientContext;
	/** Authenticated user or organization identity when the host provides it. */
	user?: UserContext;
	/**
	 * Structured workspace and git metadata for the session. Contains
	 * `rootPath`, `hint`, `associatedRemoteUrls`, `latestGitCommitHash`, and
	 * `latestGitBranchName`. Use `rootPath` for workspace-relative paths and
	 * the git fields for branch-aware registration or commit attribution at
	 * setup time.
	 */
	workspaceInfo?: WorkspaceInfo;
	/**
	 * Automation ingress made available by hosts that enable ClineCore
	 * automation. Plugins should feature-detect this property so the same plugin
	 * can run in hosts that do not enable automation.
	 */
	automation?: AgentExtensionAutomationContext;
	/** Host-provided logger scoped to this session/plugin setup. */
	logger?: BasicLogger;
	/**
	 * Host-provided telemetry service when available in the current process.
	 *
	 * This service is intentionally not serialized across plugin sandbox process
	 * boundaries; sandboxed plugins should feature-detect this property and expect
	 * it to be undefined unless a future host adds an explicit telemetry bridge.
	 */
	telemetry?: ITelemetryService;
}

const ExtensionCapabilityOptions = [
	"hooks",
	"tools",
	"commands",
	"rules",
	"messageBuilders",
	"providers",
	"automationEvents",
] as const;

export type AgentExtensionCapability =
	(typeof ExtensionCapabilityOptions)[number];

export interface PluginManifest {
	paths?: string[];
	capabilities: AgentExtensionCapability[];
	providerIds?: string[];
	modelIds?: string[];
}

export interface AgentExtensionRegistry<TTool = AgentTool, TMessage = unknown> {
	tools: TTool[];
	commands: AgentExtensionCommand[];
	rules: AgentExtensionRule[];
	messageBuilder: AgentExtensionMessageBuilder<TMessage>[];
	providers: AgentExtensionProvider[];
	automationEventTypes: AgentExtensionAutomationEventType[];
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
export interface ContributionRegistryExtension<
	TTool = AgentTool,
	TMessage = unknown,
> {
	type?: string; // Default to plugin for now.
	/** Unique identifier for this extension, used in error messages and hook handler names. */
	name: string;
	/** Declares what capabilities and hook stages this extension uses. Validated before `setup()` runs. */
	manifest: PluginManifest;
	/** Indicates whether this extension is disabled. Disabled extensions are ignored during setup. */
	disabled?: boolean;
	/** Runtime-native hooks consumed directly by `@clinebot/agents`. */
	hooks?: AgentExtensionHooks;
	/**
	 * Called once during registry setup to register tools, commands, and other
	 * contributions.
	 *
	 * The optional second argument provides workspace context that is always
	 * sourced from the host session config — never from `process.cwd()`. Use
	 * `ctx.workspaceInfo?.rootPath` instead of `process.cwd()` or
	 * `import.meta.url` tricks when you need workspace-relative paths.
	 */
	setup?: (
		api: AgentExtensionApi<TTool, TMessage>,
		ctx: PluginSetupContext,
	) => void | Promise<void>;
}

export interface ContributionRegistryOptions<
	TExtension extends ContributionRegistryExtension<TTool, TMessage>,
	TTool = AgentTool,
	TMessage = unknown,
> {
	extensions?: TExtension[];
	/** Workspace context forwarded to each extension's `setup(api, ctx)` call. */
	setupContext?: PluginSetupContext;
}

interface NormalizedExtension<
	TExtension extends ContributionRegistryExtension<TTool, TMessage>,
	TTool,
	TMessage,
> {
	extension: TExtension;
	order: number;
	manifest: {
		capabilities: Set<AgentExtensionCapability>;
		raw: PluginManifest;
	};
}

const ALLOWED_CAPABILITIES = new Set<AgentExtensionCapability>(
	ExtensionCapabilityOptions,
);

function asExtensionName<TTool, TMessage>(
	extension: ContributionRegistryExtension<TTool, TMessage>,
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

function normalizeManifest<
	TExtension extends ContributionRegistryExtension<TTool, TMessage>,
	TTool,
	TMessage,
>(
	extension: TExtension,
	order: number,
): NormalizedExtension<TExtension, TTool, TMessage>["manifest"] {
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
	const hookCapabilityEnabled = capabilities.has("hooks");
	const extensionDefinesHooks = extension.hooks !== undefined;
	if (extensionDefinesHooks && !hookCapabilityEnabled) {
		throw new Error(
			`Invalid manifest for extension "${extensionName}": runtime hooks require the "hooks" capability`,
		);
	}

	return {
		capabilities,
		raw: normalizePluginManifest(manifest),
	};
}

function normalizeAutomationEventType(
	input: AgentExtensionAutomationEventType,
	extensionName: string,
): AgentExtensionAutomationEventType {
	if (!input || typeof input !== "object") {
		throw new Error(
			`Invalid automation event contribution for extension "${extensionName}": expected object`,
		);
	}
	const eventType =
		typeof input.eventType === "string" ? input.eventType.trim() : "";
	const source = typeof input.source === "string" ? input.source.trim() : "";
	if (!eventType) {
		throw new Error(
			`Invalid automation event contribution for extension "${extensionName}": eventType is required`,
		);
	}
	if (!source) {
		throw new Error(
			`Invalid automation event contribution for extension "${extensionName}": source is required`,
		);
	}
	return {
		...input,
		eventType,
		source,
		examples: input.examples ? [...input.examples] : undefined,
		metadata: input.metadata ? { ...input.metadata } : undefined,
	};
}

export class ContributionRegistry<
	TExtension extends ContributionRegistryExtension<TTool, TMessage>,
	TTool = AgentTool,
	TMessage = unknown,
> {
	private readonly extensions: TExtension[];
	private readonly registry: AgentExtensionRegistry<TTool, TMessage> = {
		tools: [],
		commands: [],
		rules: [],
		messageBuilder: [],
		providers: [],
		automationEventTypes: [],
	};
	private normalized: NormalizedExtension<TExtension, TTool, TMessage>[] = [];
	private phase: "resolve" | "validate" | "setup" | "activate" | "run" =
		"resolve";
	private readonly setupContext: PluginSetupContext;

	constructor(
		options: ContributionRegistryOptions<TExtension, TTool, TMessage> = {},
	) {
		this.extensions = options.extensions ?? [];
		this.setupContext = options.setupContext ?? {};
	}

	resolve(): void {
		if (this.phase !== "resolve") return;
		this.normalized = this.extensions.map((extension, order) => ({
			extension,
			order,
			manifest: {
				capabilities: new Set(),
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
			manifest: normalizeManifest<TExtension, TTool, TMessage>(
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

		for (const entry of this.normalized) {
			const { extension } = entry;
			if (extension.disabled) continue;
			const extensionName = asExtensionName(extension, entry.order);
			const api: AgentExtensionApi<TTool, TMessage> = {
				registerTool: (tool) => this.registry.tools.push(tool),
				registerCommand: (command) => this.registry.commands.push(command),
				registerRule: (rule) => {
					if (!entry.manifest.capabilities.has("rules")) {
						throw new Error(
							`Invalid setup for extension "${extensionName}": registerRule requires the "rules" capability`,
						);
					}
					this.registry.rules.push(rule);
				},
				registerMessageBuilder: (builder) =>
					this.registry.messageBuilder.push(builder),
				registerProvider: (provider) => this.registry.providers.push(provider),
				registerAutomationEventType: (eventType) => {
					if (!entry.manifest.capabilities.has("automationEvents")) {
						throw new Error(
							`Invalid setup for extension "${extensionName}": registerAutomationEventType requires the "automationEvents" capability`,
						);
					}
					this.registry.automationEventTypes.push(
						normalizeAutomationEventType(eventType, extensionName),
					);
				},
			};
			const setupContext = entry.manifest.capabilities.has("automationEvents")
				? this.setupContext
				: {
						...this.setupContext,
						automation: undefined,
					};
			await extension.setup?.(api, setupContext);
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
			rules: [...this.registry.rules],
			messageBuilder: [...this.registry.messageBuilder],
			providers: [...this.registry.providers],
			automationEventTypes: [...this.registry.automationEventTypes],
		};
	}

	getRegisteredTools(): TTool[] {
		return [...this.registry.tools];
	}

	getRegisteredRules(): AgentExtensionRule[] {
		return [...this.registry.rules];
	}

	getRegisteredAutomationEventTypes(): AgentExtensionAutomationEventType[] {
		return [...this.registry.automationEventTypes];
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
	TExtension extends ContributionRegistryExtension<TTool, TMessage>,
	TTool = AgentTool,
	TMessage = unknown,
>(
	options: ContributionRegistryOptions<TExtension, TTool, TMessage> = {},
): ContributionRegistry<TExtension, TTool, TMessage> {
	return new ContributionRegistry(options);
}
