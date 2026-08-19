import type { ITelemetryService } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSettings } from "../types/provider-settings";

function createProviderSettingsManager(settings?: ProviderSettings) {
	return {
		getProviderSettings: vi.fn(() => settings),
	};
}

function createStartInput() {
	return {
		config: {
			providerId: "cline",
			modelId: "anthropic/claude-haiku-4.5",
			apiKey: "test-key",
			cwd: "/tmp/project-startup",
			workspaceRoot: "/tmp/project-startup",
			systemPrompt: "system",
			mode: "act" as const,
			enableTools: true,
			enableSpawnAgent: true,
			enableAgentTeams: true,
		},
	};
}

function createSpawnTool() {
	return {
		name: "spawn",
		description: "",
		inputSchema: {},
		execute: vi.fn(),
	};
}

function createTelemetryStub() {
	const captureRequired = vi.fn();
	const capture = vi.fn();
	const telemetry = {
		capture,
		captureRequired,
		setDistinctId: vi.fn(),
		updateCommonProperties: vi.fn(),
		identify: vi.fn(),
	} as unknown as ITelemetryService;
	return { telemetry, capture, captureRequired };
}

function findCapturedEvents(
	capture: ReturnType<typeof vi.fn>,
	event: string,
): { event: string; properties: Record<string, unknown> }[] {
	return capture.mock.calls
		.map(
			([arg]) => arg as { event: string; properties?: Record<string, unknown> },
		)
		.filter((arg) => arg.event === event)
		.map((arg) => ({ event: arg.event, properties: arg.properties ?? {} }));
}

// These tests assert that prepareLocalRuntimeBootstrap drives the workspace
// lifecycle telemetry funnel through the telemetry service it is given,
// covering the wire-up that core-events.test.ts and workspace-telemetry.test.ts
// only verify in isolation.
describe("prepareLocalRuntimeBootstrap startup telemetry", () => {
	beforeEach(async () => {
		// Each test imports prepareLocalRuntimeBootstrap fresh after vi.resetModules
		// so the workspace-telemetry de-duplication set is reset along with it.
	});

	afterEach(() => {
		vi.resetModules();
		vi.doUnmock("./workspace/workspace-manifest");
	});

	it("emits workspace.initialized via the provided telemetry service exactly once per process", async () => {
		// Stub the manifest so the test does not depend on a real git repo.
		vi.doMock("./workspace/workspace-manifest", () => ({
			buildWorkspaceMetadataWithInfo: vi.fn(async (rootPath: string) => ({
				workspaceInfo: {
					rootPath,
					git: undefined,
					remotes: [],
					branch: undefined,
					commit: undefined,
				},
				workspaceMetadata: "",
				durationMs: 12.5,
				vcsType: "none" as const,
				initError: undefined,
			})),
		}));

		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);

		const { telemetry, capture, captureRequired } = createTelemetryStub();

		await prepareLocalRuntimeBootstrap({
			input: createStartInput(),
			sessionId: "sess-startup-1",
			providerSettingsManager: createProviderSettingsManager() as never,
			defaultTelemetry: telemetry,
			defaultToolPolicies: undefined,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});

		// Workspace lifecycle telemetry now goes through normal `capture` so
		// it respects the user's telemetry opt-out setting.
		expect(captureRequired).not.toHaveBeenCalled();

		const initializedCalls = findCapturedEvents(
			capture,
			"workspace.initialized",
		);
		expect(initializedCalls).toHaveLength(1);
		const firstInitialized = initializedCalls[0];
		if (!firstInitialized) {
			throw new Error("missing workspace.initialized capture");
		}
		const props = firstInitialized.properties;
		expect(props).toMatchObject({
			root_count: 1,
			vcs_types: ["none"],
			is_multi_root: false,
			has_git: false,
			has_mercurial: false,
			feature_flag_enabled: true,
		});
		expect(typeof props.init_duration_ms).toBe("number");

		// No diagnostics error in this scenario, so init_error must not fire.
		const initErrorCalls = findCapturedEvents(capture, "workspace.init_error");
		expect(initErrorCalls).toHaveLength(0);
	});

	it("emits workspace.init_error when workspace diagnostics report a failure", async () => {
		vi.doMock("./workspace/workspace-manifest", () => ({
			buildWorkspaceMetadataWithInfo: vi.fn(async (rootPath: string) => ({
				workspaceInfo: {
					rootPath,
					git: undefined,
					remotes: [],
					branch: undefined,
					commit: undefined,
				},
				workspaceMetadata: "",
				durationMs: 7.25,
				vcsType: "git" as const,
				initError: {
					errorType: "WorkspaceSetupError",
					message: "git index unreadable",
				},
			})),
		}));

		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);
		const { telemetry, capture, captureRequired } = createTelemetryStub();

		const input = createStartInput();
		// Use a different workspace path so the workspace-telemetry dedupe set
		// (re-initialized by vi.resetModules) does not need to be cleared
		// across describe blocks.
		input.config.cwd = "/tmp/project-startup-error";
		input.config.workspaceRoot = "/tmp/project-startup-error";

		await prepareLocalRuntimeBootstrap({
			input,
			sessionId: "sess-startup-error",
			providerSettingsManager: createProviderSettingsManager() as never,
			defaultTelemetry: telemetry,
			defaultToolPolicies: undefined,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});

		// Workspace lifecycle telemetry now goes through normal `capture` so
		// it respects the user's telemetry opt-out setting.
		expect(captureRequired).not.toHaveBeenCalled();

		const initializedCalls = findCapturedEvents(
			capture,
			"workspace.initialized",
		);
		expect(initializedCalls).toHaveLength(1);

		const initErrorCalls = findCapturedEvents(capture, "workspace.init_error");
		expect(initErrorCalls).toHaveLength(1);
		const firstInitError = initErrorCalls[0];
		if (!firstInitError) {
			throw new Error("missing workspace.init_error capture");
		}
		const props = firstInitError.properties;
		expect(props).toMatchObject({
			error_type: "WorkspaceSetupError",
			error_message: "git index unreadable",
			fallback_to_single_root: true,
			workspace_count: 1,
		});
	});

	it("does not throw and emits no telemetry when no telemetry service is provided", async () => {
		vi.doMock("./workspace/workspace-manifest", () => ({
			buildWorkspaceMetadataWithInfo: vi.fn(async (rootPath: string) => ({
				workspaceInfo: {
					rootPath,
					git: undefined,
					remotes: [],
					branch: undefined,
					commit: undefined,
				},
				workspaceMetadata: "",
				durationMs: 1,
				vcsType: "none" as const,
				initError: undefined,
			})),
		}));

		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);

		await expect(
			prepareLocalRuntimeBootstrap({
				input: createStartInput(),
				sessionId: "sess-startup-no-telemetry",
				providerSettingsManager: createProviderSettingsManager() as never,
				defaultTelemetry: undefined,
				defaultToolPolicies: undefined,
				onPluginEvent: () => {},
				onTeamEvent: () => {},
				createSpawnTool,
				readSessionMetadata: async () => undefined,
				writeSessionMetadata: async () => {},
			}),
		).resolves.toBeDefined();
	});
});
