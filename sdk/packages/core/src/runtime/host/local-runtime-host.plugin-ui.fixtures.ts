import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type AgentConfig,
	type AgentExtension,
	type AgentExtensionRegistry,
	type AgentResult,
	type AgentTool,
	createContributionRegistry,
	type Message,
} from "@cline/shared";
import { setClineDir, setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, type Mock, vi } from "vitest";
import { FileSessionService } from "../../session/services/file-session-service";
import type { CoreSessionConfig } from "../../types/config";
import type { CoreSessionEvent } from "../../types/events";
import { LocalRuntimeHost as RuntimeHostUnderTest } from "./local-runtime-host";
import { type StartSessionInput, splitCoreSessionConfig } from "./runtime-host";

const distinctId = "test-machine-id";

export function createResult(
	overrides: Partial<AgentResult> = {},
): AgentResult {
	return {
		text: "ok",
		iterations: 1,
		finishReason: "completed",
		usage: {
			inputTokens: 1,
			outputTokens: 2,
			totalCost: 0,
		},
		messages: [],
		toolCalls: [],
		durationMs: 1,
		model: {
			id: "mock-model",
			provider: "mock-provider",
		},
		startedAt: new Date("2026-01-01T00:00:00.000Z"),
		endedAt: new Date("2026-01-01T00:00:01.000Z"),
		...overrides,
	};
}

export function createConfig(
	overrides: Partial<CoreSessionConfig> = {},
): CoreSessionConfig {
	return {
		providerId: "mock-provider",
		modelId: "mock-model",
		cwd: "/tmp/project",
		systemPrompt: "You are a test agent",
		mode: "act",
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
		...overrides,
	};
}

export function normalizeStartInput(
	input: Omit<StartSessionInput, "config" | "localRuntime"> & {
		config: CoreSessionConfig;
	},
): StartSessionInput {
	const split = splitCoreSessionConfig(input.config);
	return {
		...input,
		...split,
	};
}

export function useIsolatedHome(): () => string {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
	};
	let isolatedHomeDir = "";

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "core-session-home-"));
		process.env.HOME = isolatedHomeDir;
		process.env.CLINE_DIR = join(isolatedHomeDir, ".cline");
		delete process.env.CLINE_DATA_DIR;
		setHomeDir(isolatedHomeDir);
		setClineDir(process.env.CLINE_DIR);
	});

	afterEach(() => {
		process.env.HOME = envSnapshot.HOME;
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR;
		if (envSnapshot.CLINE_DATA_DIR === undefined) {
			delete process.env.CLINE_DATA_DIR;
		} else {
			process.env.CLINE_DATA_DIR = envSnapshot.CLINE_DATA_DIR;
		}
		setHomeDir(envSnapshot.HOME ?? "~");
		setClineDir(envSnapshot.CLINE_DIR ?? join("~", ".cline"));
		rmSync(isolatedHomeDir, { recursive: true, force: true });
	});

	return () => isolatedHomeDir;
}

interface SlotAgent {
	extensions: AgentExtension[];
	run: Mock;
	continue: Mock;
	getMessages: Mock;
	getAgentId: Mock;
	getConversationId: Mock;
	abort: Mock;
	subscribeEvents: Mock;
	canStartRun: Mock;
	shutdown: Mock;
	initializeExtensions: Mock<() => Promise<void>>;
	getExtensionRegistry: () => AgentExtensionRegistry<AgentTool, Message[]>;
}

export function pluginUiSlotHelpers(homeDir: () => string) {
	const SLOT = "composer.suggestions";
	const FIXTURE = "composer-suggestions-demo";
	const fixturePath = fileURLToPath(
		new URL(
			"../../../../../examples/plugins/composer-suggestions.ts",
			import.meta.url,
		),
	);
	const attach = {
		sessionId: "",
		slot: SLOT,
		action: { verb: "attach", surface: "desktop" },
	} as const;

	/** A session agent whose extensions set up through a real contribution registry, like `SessionRuntime`. */
	function createSlotAgent(config: AgentConfig): SlotAgent {
		const registry = createContributionRegistry<
			AgentExtension,
			AgentTool,
			Message[]
		>({
			extensions: config.extensions ?? [],
		});
		let initialization: Promise<void> | undefined;
		return {
			extensions: config.extensions ?? [],
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-fixture"),
			getConversationId: vi.fn().mockReturnValue("conv-fixture"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
			initializeExtensions: vi.fn(() => {
				initialization ??= registry.initialize({ tolerateSetupErrors: true });
				return initialization;
			}),
			getExtensionRegistry: () => registry.getRegistrySnapshot(),
		};
	}

	function createSlotHost(
		options: Partial<
			ConstructorParameters<typeof RuntimeHostUnderTest>[0]
		> = {},
	) {
		const agents: Array<ReturnType<typeof createSlotAgent>> = [];
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: new FileSessionService(join(homeDir(), "sessions")),
			runtimeBuilder: {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn().mockResolvedValue(undefined),
				}),
			} as never,
			createAgent: (config) => {
				const agent = createSlotAgent(config);
				agents.push(agent);
				return agent as never;
			},
			...options,
		});
		const service = Reflect.get(manager, "pluginUiService") as {
			begin(sessionId: string, slots: readonly string[]): number;
			record(
				sessionId: string,
				epoch: number,
				push: { plugin: string; slot: string; state: unknown },
			): void;
			closeSession(sessionId: string, epoch: number): Promise<void>;
			store: { epoch(sessionId: string): number | undefined };
			chains: Map<string, unknown>;
		};
		const isResident = (sessionId: string) =>
			(Reflect.get(manager, "sessions") as Map<string, unknown>).has(sessionId);
		return { manager, agents, service, isResident };
	}

	function startFixtureSession(
		manager: RuntimeHostUnderTest,
		sessionId: string,
		uiSlots?: string[],
		pluginPath = fixturePath,
	) {
		return manager.startSession({
			...normalizeStartInput({
				config: createConfig({
					sessionId,
					cwd: homeDir(),
					enableSpawnAgent: false,
					enableAgentTeams: false,
				}),
				interactive: true,
			}),
			localRuntime: { pluginPaths: [pluginPath] } as never,
			...(uiSlots ? { uiSlots } : {}),
		});
	}

	const HANGING_PLUGIN = "hanging-slot-plugin";
	const use = {
		verb: "use",
		input: "key",
		revision: "r1",
		itemId: "verify",
	} as const;

	/** Answers presence at once and never answers any other verb or its `slow` command. */
	function writeHangingSlotPlugin(): string {
		const pluginPath = join(homeDir(), `${HANGING_PLUGIN}.ts`);
		writeFileSync(
			pluginPath,
			[
				"export default {",
				`  name: "${HANGING_PLUGIN}",`,
				"  manifest: { capabilities: ['commands'] },",
				"  setup(api, ctx) {",
				"    api.registerCommand({ name: 'slow', handler: () => new Promise(() => {}) });",
				"    if (!api.registerUiSlot || !ctx.ui) return;",
				"    api.registerUiSlot({",
				`      slot: "${SLOT}",`,
				"      onAction: (action) =>",
				"        action.verb === 'attach' || action.verb === 'detach'",
				"          ? { outcome: 'ok' }",
				"          : new Promise(() => {}),",
				"    });",
				"  },",
				"};",
			].join("\n"),
			"utf8",
		);
		return pluginPath;
	}

	function uiStates(events: CoreSessionEvent[]) {
		return events.flatMap((event) =>
			event.type === "plugin_ui_state" ? [event.payload] : [],
		);
	}

	return {
		SLOT,
		FIXTURE,
		fixturePath,
		attach,
		use,
		createSlotHost,
		startFixtureSession,
		writeHangingSlotPlugin,
		uiStates,
	} as const;
}
