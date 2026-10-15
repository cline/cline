import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	AgentConfig,
	AgentExtensionMessageBuilder,
	AgentExtensionRule,
	AgentExtensionUiSlot,
	AgentTool,
	AgentToolContext,
	Message,
	PluginUiAction,
	PluginUiActionContext,
} from "@cline/shared";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	CLINE_PLUGIN_BOOTSTRAP_PATH_ENV,
	CLINE_PLUGIN_IDLE_TIMEOUT_MS_ENV,
	loadSandboxedPlugins,
	type PluginSandboxOptions,
	type UiStateEvent,
} from "./plugin-sandbox";

function createApiCapture() {
	const tools: AgentTool[] = [];
	const rules: AgentExtensionRule[] = [];
	const messageBuilders: AgentExtensionMessageBuilder<Message[]>[] = [];
	const automationEventTypes: unknown[] = [];
	const uiSlots: AgentExtensionUiSlot[] = [];
	const api = {
		registerTool: (tool: AgentTool) => tools.push(tool),
		registerCommand: () => {},
		registerMessageBuilder: (
			builder: AgentExtensionMessageBuilder<Message[]>,
		) => messageBuilders.push(builder),
		registerRule: (rule: AgentExtensionRule) => rules.push(rule),
		registerProvider: () => {},
		registerAutomationEventType: (eventType: unknown) =>
			automationEventTypes.push(eventType),
		registerMcpServer: () => {},
		registerUiSlot: (slot: AgentExtensionUiSlot) => uiSlots.push(slot),
	};
	return { tools, rules, messageBuilders, automationEventTypes, uiSlots, api };
}

function makeSnapshot() {
	return {
		agentId: "agent-1",
		status: "running" as const,
		iteration: 1,
		messages: [],
		pendingToolCalls: [],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
	};
}

describe.each([
	"subprocess",
	"worker",
] as const)("plugin-sandbox (%s)", (transport) => {
	let dir = "";
	let sharedSandbox:
		| Awaited<ReturnType<typeof loadSandboxedPlugins>>
		| undefined;
	let sharedExtensions = new Map<
		string,
		NonNullable<AgentConfig["extensions"]>[number]
	>();
	const forwardedEvents: Array<{ name: string; payload?: unknown }> = [];

	// Allow generous time for jiti transpilation of multiple TS plugins in CI.
	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), "core-plugin-sandbox-"));

		await writeFile(
			join(dir, "plugin.mjs"),
			[
				"export default {",
				"  name: 'sandbox-test',",
				"  manifest: { capabilities: ['hooks','tools'] },",
				"  setup(api) {",
				"    api.registerTool({",
				"      name: 'sandbox_echo',",
				"      description: 'echo',",
				"      inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },",
				"      execute: async (input) => ({ echoed: input.value }),",
				"    });",
				"  },",
				"  hooks: { beforeRun() { return { reason: 'sandbox-before-run' }; } },",
				"};",
			].join("\n"),
			"utf8",
		);

		await writeFile(
			join(dir, "plugin-events.mjs"),
			[
				"export default {",
				"  name: 'sandbox-events',",
				"  manifest: { capabilities: ['tools'] },",
				"  setup(api) {",
				"    api.registerTool({",
				"      name: 'emit_event',",
				"      description: 'emit host event',",
				"      inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },",
				"      execute: async (input) => {",
				"        globalThis.__clinePluginHost?.emitEvent?.('test_event', { value: input.value });",
				"        return { ok: true };",
				"      },",
				"    });",
				"  },",
				"};",
			].join("\n"),
			"utf8",
		);

		await writeFile(
			join(dir, "plugin-run-end.mjs"),
			[
				"export default {",
				"  name: 'sandbox-run-end',",
				"  manifest: { capabilities: ['hooks'] },",
				"  hooks: { afterRun(ctx) {",
				"    globalThis.__clinePluginHost?.emitEvent?.('run_end_hook', {",
				"      finishReason: ctx.result?.status,",
				"      iterations: ctx.result?.iterations,",
				"    });",
				"  } },",
				"};",
			].join("\n"),
			"utf8",
		);

		await writeFile(
			join(dir, "plugin-message-builder.mjs"),
			[
				"export default {",
				"  name: 'sandbox-message-builder',",
				"  manifest: { capabilities: ['messageBuilders'] },",
				"  setup(api) {",
				"    api.registerMessageBuilder({",
				"      name: 'append-system-context',",
				"      build: async (messages) => messages.concat([{ role: 'user', content: [{ type: 'text', text: 'from sandbox builder' }] }]),",
				"    });",
				"  },",
				"};",
			].join("\n"),
			"utf8",
		);

		await writeFile(
			join(dir, "plugin-rules.mjs"),
			[
				"let resolveCount = 0;",
				"export default {",
				"  name: 'sandbox-rules',",
				"  manifest: { capabilities: ['rules'] },",
				"  setup(api) {",
				"    api.registerRule({",
				"      id: 'sandbox-rules:static',",
				"      source: 'sandbox-rules',",
				"      content: 'Static sandbox rule',",
				"    });",
				"    api.registerRule({",
				"      id: 'sandbox-rules:lazy',",
				"      source: 'sandbox-rules',",
				"      content: async () => {",
				"        resolveCount += 1;",
				"        return 'Lazy sandbox rule ' + resolveCount;",
				"      },",
				"    });",
				"  },",
				"};",
			].join("\n"),
			"utf8",
		);

		await writeFile(
			join(dir, "plugin-automation-events.mjs"),
			[
				"export default {",
				"  name: 'sandbox-automation-events',",
				"  manifest: { capabilities: ['automationEvents','tools'] },",
				"  setup(api, ctx) {",
				"    api.registerAutomationEventType({",
				"      eventType: 'local.plugin_event',",
				"      source: 'local-plugin',",
				"      description: 'Local event emitted by a sandbox plugin',",
				"      attributesSchema: { type: 'object', properties: { topic: { type: 'string' } } },",
				"    });",
				"    api.registerTool({",
				"      name: 'emit_automation_event',",
				"      description: 'emit automation event',",
				"      inputSchema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },",
				"      execute: async (input) => {",
				"        await ctx.automation?.ingestEvent?.({",
				"          eventId: 'plugin-' + input.topic,",
				"          eventType: 'local.plugin_event',",
				"          source: 'local-plugin',",
				"          subject: input.topic,",
				"          occurredAt: '2026-04-24T10:00:00.000Z',",
				"          attributes: { topic: input.topic },",
				"        });",
				"        return { ok: true };",
				"      },",
				"    });",
				"  },",
				"};",
			].join("\n"),
			"utf8",
		);

		await writeFile(
			join(dir, "plugin-telemetry.mjs"),
			[
				"export default {",
				"  name: 'sandbox-telemetry',",
				"  manifest: { capabilities: ['tools'] },",
				"  setup(api, ctx) {",
				"    api.registerTool({",
				"      name: 'emit_plugin_telemetry',",
				"      description: 'emit plugin telemetry',",
				"      inputSchema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },",
				"      execute: async (input) => {",
				"        ctx.telemetry?.capture({",
				"          event: 'sandbox_topic_used',",
				"          properties: { topic: input.topic },",
				"        });",
				"        ctx.telemetry?.recordCounter('sandbox_topics', 1, { topic: input.topic });",
				"        return { enabled: ctx.telemetry?.isEnabled() ?? false };",
				"      },",
				"    });",
				"  },",
				"};",
			].join("\n"),
			"utf8",
		);

		await writeFile(
			join(dir, "plugin-ts.ts"),
			[
				"const TOOL_NAME: string = 'sandbox_ts_echo';",
				"export default {",
				"  name: 'sandbox-ts',",
				"  manifest: { capabilities: ['tools'] },",
				"  setup(api) {",
				"    api.registerTool({",
				"      name: TOOL_NAME,",
				"      description: 'echo',",
				"      inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },",
				"      execute: async (input) => ({ echoed: input.value }),",
				"    });",
				"  },",
				"};",
			].join("\n"),
			"utf8",
		);

		const localDepDir = join(dir, "node_modules", "sandbox-local-dep");
		await mkdir(localDepDir, { recursive: true });
		await writeFile(
			join(localDepDir, "package.json"),
			JSON.stringify({
				name: "sandbox-local-dep",
				type: "module",
				exports: "./index.js",
			}),
			"utf8",
		);
		await writeFile(
			join(localDepDir, "index.js"),
			"export const depName = 'sandbox-local-dep';\n",
			"utf8",
		);
		await writeFile(
			join(dir, "plugin-dep.ts"),
			[
				"import { depName } from 'sandbox-local-dep';",
				"export default {",
				"  name: depName,",
				"  manifest: { capabilities: ['tools'] },",
				"};",
			].join("\n"),
			"utf8",
		);

		const sdkDepDir = join(dir, "node_modules", "@cline", "shared");
		await mkdir(sdkDepDir, { recursive: true });
		await writeFile(
			join(sdkDepDir, "package.json"),
			JSON.stringify({
				name: "@cline/shared",
				type: "module",
				exports: "./index.js",
			}),
			"utf8",
		);
		await writeFile(
			join(sdkDepDir, "index.js"),
			"export const sdkMarker = 'sandbox-plugin-installed-sdk';\n",
			"utf8",
		);
		await writeFile(
			join(dir, "plugin-sdk.ts"),
			[
				"import { sdkMarker } from '@cline/shared';",
				"export default {",
				"  name: sdkMarker,",
				"  manifest: { capabilities: ['tools'] },",
				"};",
			].join("\n"),
			"utf8",
		);

		await writeFile(
			join(dir, "plugin-host-dep.ts"),
			[
				"import { resolveClineDataDir } from '@cline/shared/storage';",
				"import YAML from 'yaml';",
				"export default {",
				"  name: YAML.stringify({ host: !!resolveClineDataDir() }).trim(),",
				"  manifest: { capabilities: ['tools'] },",
				"};",
			].join("\n"),
			"utf8",
		);

		await writeFile(
			join(dir, "plugin-create-tool.ts"),
			[
				"import { createTool } from '@cline/agents';",
				"export default {",
				"  name: 'sandbox-create-tool',",
				"  manifest: { capabilities: ['tools'] },",
				"  setup(api) {",
				"    api.registerTool(createTool({",
				"      name: 'created_tool',",
				"      description: 'created via agents export',",
				"      inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },",
				"      execute: async (input) => ({ echoed: input.value }),",
				"    }));",
				"  },",
				"};",
			].join("\n"),
			"utf8",
		);

		await writeFile(
			join(dir, "plugin-broken-setup.mjs"),
			[
				"export default {",
				"  name: 'sandbox-broken-setup',",
				"  manifest: { capabilities: ['tools'] },",
				"  async setup() {",
				"    throw new Error('broken setup');",
				"  },",
				"};",
			].join("\n"),
			"utf8",
		);

		await writeFile(
			join(dir, "plugin-duplicate-a.mjs"),
			"export default { name: 'sandbox-duplicate', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);
		await writeFile(
			join(dir, "plugin-duplicate-b.mjs"),
			"export default { name: 'sandbox-duplicate', manifest: { capabilities: ['commands'] } };",
			"utf8",
		);
		await writeFile(
			join(dir, "plugin-targeted.mjs"),
			[
				"export default {",
				"  name: 'sandbox-targeted',",
				"  manifest: { capabilities: ['tools'], providerIds: ['openai'], modelIds: ['gpt-5.4'] },",
				"};",
			].join("\n"),
			"utf8",
		);

		sharedSandbox = await loadSandboxedPlugins({
			transport,
			pluginPaths: [
				join(dir, "plugin.mjs"),
				join(dir, "plugin-events.mjs"),
				join(dir, "plugin-run-end.mjs"),
				join(dir, "plugin-automation-events.mjs"),
				join(dir, "plugin-telemetry.mjs"),
				join(dir, "plugin-message-builder.mjs"),
				join(dir, "plugin-rules.mjs"),
				join(dir, "plugin-ts.ts"),
				join(dir, "plugin-dep.ts"),
				join(dir, "plugin-sdk.ts"),
				join(dir, "plugin-host-dep.ts"),
				join(dir, "plugin-create-tool.ts"),
			],
			// CI environments are significantly slower for jiti transpilation;
			// the default 4 000 ms is too tight for 7 plugins.
			importTimeoutMs: 30_000,
			telemetryAvailable: true,
			onEvent: (event) => {
				forwardedEvents.push(event);
			},
		});
		sharedExtensions = new Map(
			(sharedSandbox.extensions ?? []).map((extension) => [
				extension.name,
				extension,
			]),
		);
	}, 60_000);

	beforeEach(() => {
		forwardedEvents.length = 0;
	});

	afterAll(async () => {
		await sharedSandbox?.shutdown();
		if (dir) {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("runs plugin hooks and tool contributions in sandbox process", async () => {
		expect(sharedSandbox?.extensions).toBeDefined();
		const extension = sharedExtensions.get("sandbox-test");
		expect(extension?.name).toBe("sandbox-test");
		const control = await extension?.hooks?.beforeRun?.({
			snapshot: makeSnapshot(),
		});
		expect(control?.reason).toBe("sandbox-before-run");

		const { tools, api } = createApiCapture();
		await extension?.setup?.(api, {});
		expect(tools.map((tool) => tool.name)).toContain("sandbox_echo");
		const echoTool = tools.find((tool) => tool.name === "sandbox_echo");
		expect(echoTool).toBeDefined();
		const result = await echoTool?.execute({ value: "ok" }, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
		} as AgentToolContext);
		expect(result).toEqual({ echoed: "ok" });
	});

	it("strips non-serializable host values from the tool context before IPC", async () => {
		const extension = sharedExtensions.get("sandbox-test");
		const { tools, api } = createApiCapture();
		await extension?.setup?.(api, {});
		const echoTool = tools.find((tool) => tool.name === "sandbox_echo");
		expect(echoTool).toBeDefined();

		// The production orchestrator attaches the live telemetry service
		// (cyclic: PostHog client) under this metadata key. Without
		// sanitization, child.send() throws and every plugin tool call fails.
		const cyclicTelemetry: Record<string, unknown> = { capture: () => {} };
		cyclicTelemetry.self = cyclicTelemetry;
		const result = await echoTool?.execute({ value: "ok" }, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
			signal: new AbortController().signal,
			emitUpdate: () => {},
			metadata: {
				modelSupportsImages: true,
				__clineInternalTelemetry: cyclicTelemetry,
			},
		} as unknown as AgentToolContext);
		expect(result).toEqual({ echoed: "ok" });
	});

	it("bridges ctx.telemetry calls to the host as plugin_telemetry events", async () => {
		const extension = sharedExtensions.get("sandbox-telemetry");
		const { tools, api } = createApiCapture();
		await extension?.setup?.(api, {});
		const tool = tools.find((t) => t.name === "emit_plugin_telemetry");
		expect(tool).toBeDefined();

		const result = await tool?.execute({ topic: "weather" }, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
		} as AgentToolContext);
		expect(result).toEqual({ enabled: true });

		const telemetryEvents = forwardedEvents.filter(
			(event) => event.name === "plugin_telemetry",
		);
		expect(telemetryEvents).toHaveLength(2);
		expect(telemetryEvents[0]?.payload).toMatchObject({
			pluginName: "sandbox-telemetry",
			kind: "event",
			event: "sandbox_topic_used",
			properties: { topic: "weather" },
		});
		expect(telemetryEvents[1]?.payload).toMatchObject({
			pluginName: "sandbox-telemetry",
			kind: "metric",
			metric: "counter",
			name: "sandbox_topics",
			value: 1,
			attributes: { topic: "weather" },
		});
	});

	it("omits ctx.telemetry when the host reports no telemetry service", async () => {
		const noTelemetryDir = await mkdtemp(
			join(tmpdir(), "core-plugin-sandbox-no-telemetry-"),
		);
		try {
			const pluginPath = join(noTelemetryDir, "plugin-telemetry.mjs");
			await writeFile(
				pluginPath,
				[
					"export default {",
					"  name: 'sandbox-no-telemetry',",
					"  manifest: { capabilities: ['tools'] },",
					"  setup(api, ctx) {",
					"    api.registerTool({",
					"      name: 'probe_telemetry',",
					"      description: 'probe telemetry availability',",
					"      inputSchema: { type: 'object', properties: {}, required: [] },",
					"      execute: async () => ({ present: ctx.telemetry !== undefined }),",
					"    });",
					"  },",
					"};",
				].join("\n"),
				"utf8",
			);
			const events: Array<{ name: string; payload?: unknown }> = [];
			const sandbox = await loadSandboxedPlugins({
				transport,
				pluginPaths: [pluginPath],
				importTimeoutMs: 30_000,
				// telemetryAvailable intentionally omitted: no host service.
				onEvent: (event) => events.push(event),
			});
			try {
				const { tools, api } = createApiCapture();
				await sandbox.extensions?.[0]?.setup?.(api, {});
				const tool = tools.find((t) => t.name === "probe_telemetry");
				const result = await tool?.execute({}, {
					agentId: "agent-1",
					iteration: 1,
				} as AgentToolContext);
				expect(result).toEqual({ present: false });
				expect(
					events.filter((event) => event.name === "plugin_telemetry"),
				).toHaveLength(0);
			} finally {
				await sandbox.shutdown();
			}
		} finally {
			await rm(noTelemetryDir, { recursive: true, force: true });
		}
	}, 60_000);

	it("strips non-serializable tool input via the same fallback", async () => {
		const extension = sharedExtensions.get("sandbox-test");
		const { tools, api } = createApiCapture();
		await extension?.setup?.(api, {});
		const echoTool = tools.find((tool) => tool.name === "sandbox_echo");
		expect(echoTool).toBeDefined();

		// beforeTool hooks and programmatic callers can rewrite the input, so
		// it can carry non-serializable values just like the context can.
		const cyclicInput: Record<string, unknown> = { value: "ok" };
		cyclicInput.self = cyclicInput;
		const result = await echoTool?.execute(cyclicInput, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
		} as AgentToolContext);
		expect(result).toEqual({ echoed: "ok" });

		// BigInts raise a different serialization error message than cycles do
		// in both Bun and Node; the fallback must classify those too.
		const bigintInput: Record<string, unknown> = {
			value: "ok",
			blockNumber: 123n,
		};
		const bigintResult = await echoTool?.execute(bigintInput, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 2,
		} as AgentToolContext);
		expect(bigintResult).toEqual({ echoed: "ok" });
	});

	it("enforces hook timeout and cancels sandbox process", async () => {
		const timeoutDir = await mkdtemp(
			join(tmpdir(), "core-plugin-sandbox-timeout-"),
		);
		try {
			const pluginPath = join(timeoutDir, "plugin-timeout.mjs");
			await writeFile(
				pluginPath,
				[
					"export default {",
					"  name: 'sandbox-timeout',",
					"  manifest: { capabilities: ['hooks'] },",
					"  hooks: { beforeRun() { return new Promise(() => {}); } },",
					"};",
				].join("\n"),
				"utf8",
			);

			const sandboxed = await loadSandboxedPlugins({
				transport,
				pluginPaths: [pluginPath],
				hookTimeoutMs: 50,
			});
			const extension = sandboxed.extensions?.[0];
			await expect(
				extension?.hooks?.beforeRun?.({ snapshot: makeSnapshot() }),
			).rejects.toThrow(/timed out/i);
			await sandboxed.shutdown();
		} finally {
			await rm(timeoutDir, { recursive: true, force: true });
		}
	});

	it("respects CLINE_PLUGIN_IMPORT_TIMEOUT_MS env var when options.importTimeoutMs is unset", async () => {
		const envDir = await mkdtemp(
			join(tmpdir(), "core-plugin-sandbox-import-env-"),
		);
		try {
			const pluginPath = join(envDir, "plugin-import-hang.mjs");
			// Top-level await that never resolves — module import never
			// completes, so the initialize call must hit the timeout.
			await writeFile(
				pluginPath,
				[
					"await new Promise(() => {});",
					"export default {",
					"  name: 'sandbox-import-hang',",
					"  manifest: { capabilities: ['tools'] },",
					"};",
				].join("\n"),
				"utf8",
			);

			// Set env override well below the 4000 ms hardcoded default.
			// If the env var isn't read, this test would block for ~4 s and
			// the per-test timeout (3000 ms below) would fail it.
			vi.stubEnv("CLINE_PLUGIN_IMPORT_TIMEOUT_MS", "150");
			await expect(
				loadSandboxedPlugins({ pluginPaths: [pluginPath], transport }),
			).rejects.toThrow(/timed out/i);
		} finally {
			vi.unstubAllEnvs();
			await rm(envDir, { recursive: true, force: true });
		}
	}, 3000);

	it("reclaims an idle plugin process and reinitializes it on the next call", async () => {
		const idleDir = await mkdtemp(join(tmpdir(), "core-plugin-sandbox-idle-"));
		let sandboxed: Awaited<ReturnType<typeof loadSandboxedPlugins>> | undefined;
		try {
			const pluginPath = join(idleDir, "plugin-idle.mjs");
			await writeFile(
				pluginPath,
				[
					"import { threadId } from 'node:worker_threads';",
					"export default {",
					"  name: 'sandbox-idle',",
					"  manifest: { capabilities: ['tools'] },",
					"  setup(api) {",
					"    api.registerTool({",
					"      name: 'sandbox_process_id',",
					"      description: 'return the sandbox process id',",
					"      inputSchema: { type: 'object', properties: {}, required: [] },",
					"      execute: async () => ({ pid: process.pid + ':' + threadId }),",
					"    });",
					"  },",
					"};",
				].join("\n"),
				"utf8",
			);

			vi.stubEnv(CLINE_PLUGIN_IDLE_TIMEOUT_MS_ENV, "1000");
			vi.useFakeTimers();
			sandboxed = await loadSandboxedPlugins({
				transport,
				pluginPaths: [pluginPath],
				importTimeoutMs: 30_000,
			});
			const { tools, api } = createApiCapture();
			await sandboxed.extensions?.[0]?.setup?.(api, {});
			const tool = tools.find((entry) => entry.name === "sandbox_process_id");
			expect(tool).toBeDefined();

			const context = {
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			} as AgentToolContext;
			const first = (await tool?.execute({}, context)) as { pid: string };

			await vi.advanceTimersByTimeAsync(1001);

			const second = (await tool?.execute({}, context)) as { pid: string };
			expect(second.pid).not.toBe(first.pid);
		} finally {
			vi.useRealTimers();
			vi.unstubAllEnvs();
			await sandboxed?.shutdown();
			await rm(idleDir, { recursive: true, force: true });
		}
	}, 60_000);

	it("forwards sandbox plugin events to the host", async () => {
		const extension = sharedExtensions.get("sandbox-events");
		const { tools, api } = createApiCapture();
		await extension?.setup?.(api, {});
		const tool = tools.find((entry) => entry.name === "emit_event");
		await tool?.execute({ value: "hello" }, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
		} as AgentToolContext);
		expect(forwardedEvents).toEqual([
			{
				name: "test_event",
				payload: { value: "hello" },
			},
		]);
	});

	it("selects sibling, then source, then installed bootstrap candidates", async () => {
		const { selectBootstrapCandidate } = await import("./plugin-sandbox");
		const makeExists = (existing: string[]) => (path: string) =>
			existing.includes(path);

		// Compiled bundle: the sibling bootstrap matches the host build.
		expect(
			selectBootstrapCandidate({
				siblingCandidates: ["/dist/extensions/plugin-sandbox-bootstrap.js"],
				sourceBootstrapPath: "/src/plugin-sandbox-bootstrap.ts",
				installedCandidates: ["/wrapper/extensions/bootstrap.js"],
				exists: makeExists([
					"/dist/extensions/plugin-sandbox-bootstrap.js",
					"/wrapper/extensions/bootstrap.js",
				]),
			}),
		).toEqual({ file: "/dist/extensions/plugin-sandbox-bootstrap.js" });

		// Source host: the source bootstrap must win over a separately
		// installed CLI package's compiled bootstrap. A published bootstrap
		// resolves modules against the other installation's layout and
		// silently breaks plugin loading for the source host.
		expect(
			selectBootstrapCandidate({
				siblingCandidates: ["/src/plugin-sandbox-bootstrap.js"],
				sourceBootstrapPath: "/src/plugin-sandbox-bootstrap.ts",
				installedCandidates: ["/wrapper/extensions/bootstrap.js"],
				exists: makeExists([
					"/src/plugin-sandbox-bootstrap.ts",
					"/wrapper/extensions/bootstrap.js",
				]),
			}),
		).toEqual({ sourcePath: "/src/plugin-sandbox-bootstrap.ts" });

		// Compiled binary (bunfs import.meta): nothing exists on disk next to
		// the module, so the installed wrapper bootstrap is the right one.
		expect(
			selectBootstrapCandidate({
				siblingCandidates: ["/$bunfs/root/plugin-sandbox-bootstrap.js"],
				sourceBootstrapPath: "/$bunfs/root/plugin-sandbox-bootstrap.ts",
				installedCandidates: [undefined, "/wrapper/extensions/bootstrap.js"],
				exists: makeExists(["/wrapper/extensions/bootstrap.js"]),
			}),
		).toEqual({ file: "/wrapper/extensions/bootstrap.js" });

		// A host that ships no bootstrap at all: there is no fallback. Plugin
		// code never runs on the host's main thread, so this is a failure.
		expect(
			selectBootstrapCandidate({
				siblingCandidates: ["/$bunfs/root/plugin-sandbox-bootstrap.js"],
				sourceBootstrapPath: "/$bunfs/root/plugin-sandbox-bootstrap.ts",
				installedCandidates: [undefined, undefined],
				exists: makeExists([]),
			}),
		).toBeUndefined();
	});

	it("ignores the npm wrapper platform package bootstrap when running from source", async () => {
		const previousWrapperPath = process.env.CLINE_WRAPPER_PATH;
		const wrapperRoot = await mkdtemp(
			join(tmpdir(), "core-plugin-sandbox-wrapper-"),
		);
		const platform =
			process.platform === "win32" ? "windows" : process.platform;
		const packageRoot = join(
			wrapperRoot,
			"node_modules",
			"@cline",
			`cli-${platform}-${process.arch}`,
		);
		const wrapperBinDir = join(wrapperRoot, "bin");
		const bootstrapPath = join(
			packageRoot,
			"extensions",
			"plugin-sandbox-bootstrap.js",
		);
		const wrapperPath = join(wrapperBinDir, "cline");
		const events: Array<{ name: string; payload?: unknown }> = [];

		try {
			await mkdir(join(packageRoot, "extensions"), { recursive: true });
			await mkdir(wrapperBinDir, { recursive: true });
			await writeFile(wrapperPath, "#!/usr/bin/env node\n", "utf8");
			await writeFile(
				join(packageRoot, "package.json"),
				JSON.stringify({
					name: `@cline/cli-${platform}-${process.arch}`,
					version: "0.0.0-test",
					type: "module",
				}),
				"utf8",
			);
			await writeFile(
				bootstrapPath,
				[
					"process.on('message', (message) => {",
					"  if (!message || message.type !== 'call') return;",
					"  if (message.method !== 'initialize') throw new Error('Unexpected method: ' + message.method);",
					"  process.send?.({ type: 'event', name: 'wrapper_bootstrap_selected', payload: { ok: true } });",
					"  process.send?.({",
					"    type: 'response',",
					"    id: message.id,",
					"    ok: true,",
					"    result: {",
					"      plugins: [{",
					"        pluginId: 'plugin_1',",
					"        pluginPath: 'wrapper-bootstrap',",
					"        name: 'wrapper-bootstrap',",
					"        manifest: { capabilities: ['tools'] },",
					"        contributions: { tools: [], commands: [], messageBuilders: [], providers: [], automationEventTypes: [] },",
					"      }],",
					"      failures: [],",
					"      warnings: [],",
					"    },",
					"  });",
					"});",
				].join("\n"),
				"utf8",
			);

			process.env.CLINE_WRAPPER_PATH = wrapperPath;
			vi.resetModules();
			const { loadSandboxedPlugins: loadSandboxedPluginsFromWrapper } =
				await import("./plugin-sandbox");
			const sandboxed = await loadSandboxedPluginsFromWrapper({
				pluginPaths: [join(wrapperRoot, "unused-plugin.mjs")],
				onEvent: (event) => events.push(event),
			});

			try {
				// Regression: this host runs from source, so the sandbox must run
				// the source bootstrap, NOT the wrapper package's compiled one. The
				// fake wrapper bootstrap would report a "wrapper-bootstrap" plugin
				// and emit wrapper_bootstrap_selected; with the source bootstrap in
				// charge, the (nonexistent) plugin path simply fails to load.
				expect(
					sandboxed.extensions?.map((extension) => extension.name) ?? [],
				).toEqual([]);
				expect(events).not.toContainEqual({
					name: "wrapper_bootstrap_selected",
					payload: { ok: true },
				});
				expect(sandboxed.failures.length).toBeGreaterThan(0);
			} finally {
				await sandboxed.shutdown();
			}
		} finally {
			if (previousWrapperPath === undefined) {
				delete process.env.CLINE_WRAPPER_PATH;
			} else {
				process.env.CLINE_WRAPPER_PATH = previousWrapperPath;
			}
			vi.resetModules();
			await rm(wrapperRoot, { recursive: true, force: true });
		}
	});

	it("registers automation event types and forwards sandbox automation events", async () => {
		const extension = sharedExtensions.get("sandbox-automation-events");
		const { tools, automationEventTypes, api } = createApiCapture();
		await extension?.setup?.(api, {});
		expect(automationEventTypes).toEqual([
			expect.objectContaining({
				eventType: "local.plugin_event",
				source: "local-plugin",
			}),
		]);

		const tool = tools.find((entry) => entry.name === "emit_automation_event");
		await tool?.execute({ topic: "cron-feature-2" }, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
		} as AgentToolContext);
		expect(forwardedEvents).toEqual([
			{
				name: "automation_event",
				payload: expect.objectContaining({
					eventId: "plugin-cron-feature-2",
					eventType: "local.plugin_event",
					source: "local-plugin",
				}),
			},
		]);
	});

	it("runs run_end hooks in sandbox process", async () => {
		const extension = sharedExtensions.get("sandbox-run-end");
		expect(typeof extension?.hooks?.afterRun).toBe("function");
		await extension?.hooks?.afterRun?.({
			snapshot: makeSnapshot(),
			result: {
				agentId: "agent-1",
				runId: "run-1",
				status: "completed",
				iterations: 2,
				outputText: "done",
				messages: [],
				usage: {
					inputTokens: 1,
					outputTokens: 2,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			},
		});
		expect(forwardedEvents).toEqual([
			{
				name: "run_end_hook",
				payload: { finishReason: "completed", iterations: 2 },
			},
		]);
	});

	it("runs message builders in the sandbox process", async () => {
		const extension = sharedExtensions.get("sandbox-message-builder");
		const { messageBuilders, api } = createApiCapture();
		await extension?.setup?.(api, {});
		expect(messageBuilders).toHaveLength(1);
		const result = await messageBuilders[0]?.build([
			{ role: "user", content: [{ type: "text", text: "original" }] },
		]);
		expect(result).toEqual([
			{ role: "user", content: [{ type: "text", text: "original" }] },
			{
				role: "user",
				content: [{ type: "text", text: "from sandbox builder" }],
			},
		]);
	});

	it("registers prompt rules from sandbox plugins", async () => {
		const extension = sharedExtensions.get("sandbox-rules");
		const { rules, api } = createApiCapture();
		await extension?.setup?.(api, {});

		expect(rules).toHaveLength(2);
		expect(rules[0]).toEqual({
			id: "sandbox-rules:static",
			source: "sandbox-rules",
			content: "Static sandbox rule",
		});
		expect(rules[1]?.id).toBe("sandbox-rules:lazy");
		expect(rules[1]?.source).toBe("sandbox-rules");
		expect(typeof rules[1]?.content).toBe("function");
		if (typeof rules[1]?.content !== "function") {
			throw new Error("Expected lazy sandbox rule content handler");
		}
		const content = await rules[1].content();
		expect(content).toBe("Lazy sandbox rule 1");
	});

	it("loads TypeScript plugins in the sandbox process", async () => {
		const extension = sharedExtensions.get("sandbox-ts");
		expect(extension?.name).toBe("sandbox-ts");
		const { tools, api } = createApiCapture();
		await extension?.setup?.(api, {});
		const tool = tools.find((entry) => entry.name === "sandbox_ts_echo");
		expect(tool).toBeDefined();
		const result = await tool?.execute({ value: "ok" }, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
		} as AgentToolContext);
		expect(result).toEqual({ echoed: "ok" });
	});

	it("continues loading remaining sandbox plugins when one setup fails", async () => {
		const sandboxed = await loadSandboxedPlugins({
			transport,
			pluginPaths: [
				join(dir, "plugin.mjs"),
				join(dir, "plugin-broken-setup.mjs"),
				join(dir, "plugin-events.mjs"),
			],
		});

		try {
			expect(sandboxed.extensions?.map((extension) => extension.name)).toEqual([
				"sandbox-test",
				"sandbox-events",
			]);
			expect(sandboxed.failures).toHaveLength(1);
			expect(sandboxed.failures[0]?.pluginName).toBe("sandbox-broken-setup");
			expect(sandboxed.failures[0]?.phase).toBe("setup");
		} finally {
			await sandboxed.shutdown();
		}
	});

	it("keeps the later duplicate sandbox plugin and reports the override", async () => {
		const sandboxed = await loadSandboxedPlugins({
			transport,
			pluginPaths: [
				join(dir, "plugin-duplicate-a.mjs"),
				join(dir, "plugin-duplicate-b.mjs"),
			],
		});

		try {
			expect(sandboxed.extensions).toHaveLength(1);
			expect(sandboxed.extensions?.[0]?.name).toBe("sandbox-duplicate");
			expect(sandboxed.extensions?.[0]?.manifest.capabilities).toEqual([
				"commands",
			]);
			expect(sandboxed.warnings).toHaveLength(1);
			expect(sandboxed.warnings[0]?.overriddenPluginPath).toBe(
				join(dir, "plugin-duplicate-a.mjs"),
			);
		} finally {
			await sandboxed.shutdown();
		}
	});

	it("resolves plugin-local dependencies in the sandbox process", async () => {
		expect(sharedExtensions.get("sandbox-local-dep")?.name).toBe(
			"sandbox-local-dep",
		);
	});

	it("prefers plugin-installed SDK packages in the sandbox process", async () => {
		expect(sharedExtensions.get("sandbox-plugin-installed-sdk")?.name).toBe(
			"sandbox-plugin-installed-sdk",
		);
	});

	it("allows standalone file plugins to use host runtime dependencies in the sandbox", async () => {
		expect(sharedExtensions.get("host: true")?.name).toBe("host: true");
	});

	it("supports createTool through the agents package export in the sandbox", async () => {
		const extension = sharedExtensions.get("sandbox-create-tool");
		const { tools, api } = createApiCapture();
		await extension?.setup?.(api, {});
		const tool = tools.find((entry) => entry.name === "created_tool");
		expect(tool).toBeDefined();
		const result = await tool?.execute({ value: "ok" }, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
		} as AgentToolContext);
		expect(result).toEqual({ echoed: "ok" });
	});

	it("loads sandbox plugins matching manifest providerIds and modelIds", async () => {
		const matched = await loadSandboxedPlugins({
			transport,
			pluginPaths: [join(dir, "plugin-targeted.mjs")],
			providerId: "openai",
			modelId: "gpt-5.4",
			importTimeoutMs: 30_000,
		});

		try {
			expect(matched.extensions?.map((extension) => extension.name)).toEqual([
				"sandbox-targeted",
			]);
		} finally {
			await matched.shutdown();
		}
	}, 15_000);

	it("filters sandbox plugins with non-matching manifest providerIds and modelIds", async () => {
		const filtered = await loadSandboxedPlugins({
			transport,
			pluginPaths: [join(dir, "plugin-targeted.mjs")],
			providerId: "anthropic",
			modelId: "claude-sonnet-4.5",
			importTimeoutMs: 30_000,
		});

		try {
			expect(filtered.extensions).toEqual([]);
		} finally {
			await filtered.shutdown();
		}
	}, 15_000);
});

describe("plugin-sandbox (worker only)", () => {
	let dir = "";
	const context = {
		agentId: "agent-1",
		conversationId: "conv-1",
		iteration: 1,
	} as AgentToolContext;

	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), "core-plugin-worker-"));
	});

	afterAll(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	async function loadToolPlugin(
		name: string,
		executeBody: string,
		options: { cwd?: string; contributionTimeoutMs?: number } = {},
	) {
		const pluginPath = join(dir, `${name}.mjs`);
		await writeFile(
			pluginPath,
			[
				"export default {",
				`  name: '${name}',`,
				"  manifest: { capabilities: ['tools'] },",
				"  setup(api) {",
				"    api.registerTool({",
				`      name: '${name}',`,
				"      description: 'test tool',",
				"      inputSchema: { type: 'object', properties: {} },",
				`      execute: async (input) => { ${executeBody} },`,
				"    });",
				"  },",
				"};",
			].join("\n"),
			"utf8",
		);
		const sandboxed = await loadSandboxedPlugins({
			transport: "worker",
			pluginPaths: [pluginPath],
			...options,
		});
		const { tools, api } = createApiCapture();
		await sandboxed.extensions?.[0]?.setup?.(api, {});
		const tool = tools.find((entry) => entry.name === name);
		if (!tool) throw new Error(`tool ${name} not registered`);
		return { sandboxed, tool };
	}

	it("terminates a plugin stuck in a synchronous loop and recovers", async () => {
		const { sandboxed, tool } = await loadToolPlugin(
			"worker_spin",
			"if (input.spin) { for (;;) {} } return 'ok';",
			// The recovery call boots a fresh worker and re-imports the plugin
			// within this same limit, so leave room for slow CI machines.
			{ contributionTimeoutMs: 3000 },
		);
		try {
			await expect(tool.execute({ spin: true }, context)).rejects.toThrow(
				/timed out/i,
			);
			// The host event loop kept running, and the next call gets a fresh
			// worker that re-imports the plugin.
			await expect(tool.execute({ spin: false }, context)).resolves.toBe("ok");
		} finally {
			await sandboxed.shutdown();
		}
	}, 20_000);

	it("reports the session cwd without changing the host cwd", async () => {
		const hostCwd = process.cwd();
		const { sandboxed, tool } = await loadToolPlugin(
			"worker_cwd",
			"return process.cwd();",
			{ cwd: dir },
		);
		try {
			await expect(tool.execute({}, context)).resolves.toBe(dir);
			expect(process.cwd()).toBe(hostCwd);
		} finally {
			await sandboxed.shutdown();
		}
	});

	it("does not need a JavaScript runtime executable", async () => {
		vi.stubEnv("CLINE_JS_RUNTIME_PATH", join(dir, "missing-node"));
		try {
			const { sandboxed, tool } = await loadToolPlugin(
				"worker_no_runtime",
				"return 'ran';",
			);
			try {
				await expect(tool.execute({}, context)).resolves.toBe("ran");
			} finally {
				await sandboxed.shutdown();
			}
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("contains a stray throw from a plugin timer", async () => {
		const { sandboxed, tool } = await loadToolPlugin(
			"worker_stray",
			"if (input.boom) { setTimeout(() => { throw new Error('stray boom'); }, 0); return new Promise(() => {}); } return 'alive';",
		);
		try {
			await expect(tool.execute({ boom: true }, context)).rejects.toThrow(
				/stray boom/,
			);
			await expect(tool.execute({}, context)).resolves.toBe("alive");
		} finally {
			await sandboxed.shutdown();
		}
	}, 20_000);

	it("ends only the worker when a plugin calls process.exit", async () => {
		const { sandboxed, tool } = await loadToolPlugin(
			"worker_exit",
			"if (input.exit) { process.exit(7); } return 'alive';",
		);
		try {
			await expect(tool.execute({ exit: true }, context)).rejects.toThrow(
				/exited \(code=7\)/,
			);
			await expect(tool.execute({}, context)).resolves.toBe("alive");
		} finally {
			await sandboxed.shutdown();
		}
	}, 20_000);

	it("discards plugin stdout but completes write callbacks", async () => {
		const { sandboxed, tool } = await loadToolPlugin(
			"worker_stdout",
			[
				"console.log('discarded');",
				"await new Promise((resolve) => process.stdout.write('a', resolve));",
				"await new Promise((resolve) => process.stdout.write('b', 'utf8', resolve));",
				"return process.stdout.write('c');",
			].join(" "),
		);
		try {
			await expect(tool.execute({}, context)).resolves.toBe(true);
		} finally {
			await sandboxed.shutdown();
		}
	});

	it("drops functions from results like the JSON IPC does", async () => {
		const { sandboxed, tool } = await loadToolPlugin(
			"worker_uncloneable",
			"return { value: 1, fn: () => 2 };",
		);
		try {
			await expect(tool.execute({}, context)).resolves.toEqual({ value: 1 });
		} finally {
			await sandboxed.shutdown();
		}
	});
});

const SLOT = "composer.suggestions";
const FIXTURE_PLUGIN_PATH = fileURLToPath(
	new URL(
		"../../../../../examples/plugins/composer-suggestions.ts",
		import.meta.url,
	),
);
const actionContext: PluginUiActionContext = {
	sessionId: "session-1",
	viewer: { id: "local" },
	viewers: 1,
};

function revisionOf(event: UiStateEvent | undefined): unknown {
	return (event?.state as { revision?: unknown } | null | undefined)?.revision;
}

function pluginLogReasons(events: Array<{ name: string; payload?: unknown }>) {
	return events
		.filter((event) => event.name === "plugin_log")
		.map(
			(event) =>
				(event.payload as { metadata?: { reason?: string } }).metadata?.reason,
		)
		.filter(Boolean);
}

function refusedEventLogs(events: Array<{ name: string; payload?: unknown }>) {
	return events
		.filter((event) => event.name === "plugin_log")
		.map((event) => (event.payload as { message?: string }).message ?? "")
		.filter((message) => message.startsWith("Refused to emit"));
}

function afterRunPayload() {
	return {
		snapshot: makeSnapshot(),
		result: {
			agentId: "agent-1",
			runId: "run-1",
			status: "failed" as const,
			iterations: 1,
			outputText: "",
			messages: [],
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		},
	};
}

/**
 * Pushes `r<n>` in setup and a new revision on every action, noting the verb
 * and viewer count, and clears the slot from its `ctx.onDispose` cleanup.
 */
function roundTripPlugin(name: string) {
	return [
		"let ui;",
		"let n = 1;",
		"let note;",
		"const state = () => ({ status: 'ready', title: 'T', revision: 'r' + n, items: [], canRefresh: true, ...(note ? { note } : {}) });",
		"export default {",
		`  name: '${name}',`,
		"  manifest: { capabilities: ['hooks'] },",
		"  setup(api, ctx) {",
		"    ui = ctx.ui;",
		"    api.registerUiSlot({",
		"      slot: 'composer.suggestions',",
		"      onAction(action, context) {",
		"        n += 1;",
		"        note = action.verb + ':' + context.viewers;",
		"        ui.update('composer.suggestions', state());",
		"        return { outcome: 'ok' };",
		"      },",
		"    });",
		"    ctx.onDispose(() => {",
		"      ctx.emitEvent('disposing');",
		"      ui.update('composer.suggestions', null);",
		"    });",
		"    ui.update('composer.suggestions', state());",
		"  },",
		"};",
	].join("\n");
}

describe.each([
	"subprocess",
	"worker",
] as const)("plugin-sandbox UI slots (%s)", (transport) => {
	let dir = "";
	const loaded: Array<Awaited<ReturnType<typeof loadSandboxedPlugins>>> = [];

	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), "core-plugin-ui-slots-"));
	});

	afterEach(async () => {
		await Promise.all(loaded.splice(0).map((sandbox) => sandbox.shutdown()));
	});

	afterAll(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	async function loadUiPlugin(
		file: string,
		source: string,
		options: Partial<PluginSandboxOptions> = {},
	) {
		const pluginPath = join(dir, file);
		await writeFile(pluginPath, source, "utf8");
		return await loadWithUi(pluginPath, options);
	}

	async function loadWithUi(
		pluginPath: string,
		options: Partial<PluginSandboxOptions> = {},
	) {
		const states: UiStateEvent[] = [];
		const events: Array<{ name: string; payload?: unknown }> = [];
		const sandbox = await loadSandboxedPlugins({
			transport,
			pluginPaths: [pluginPath],
			importTimeoutMs: 30_000,
			uiSlots: [SLOT],
			onUiState: (event) => states.push(event),
			onEvent: (event) => events.push(event),
			...options,
		});
		loaded.push(sandbox);
		return { sandbox, states, events };
	}

	it("offers registerUiSlot and ctx.ui only with a non-empty catalog and a listener", async () => {
		const probe = [
			"export default {",
			"  name: 'ui-probe',",
			"  manifest: { capabilities: ['hooks'] },",
			"  setup(api, ctx) {",
			"    ctx.emitEvent('probe', { slots: ctx.ui ? ctx.ui.slots : null, registerUiSlot: typeof api.registerUiSlot });",
			"  },",
			"};",
		].join("\n");
		const probed = async (options: Partial<PluginSandboxOptions>) => {
			const { events } = await loadUiPlugin("ui-probe.mjs", probe, options);
			return events.find((event) => event.name === "probe")?.payload;
		};
		const offered = await probed({});
		const emptyCatalog = await probed({ uiSlots: [] });
		const noCatalog = await probed({ uiSlots: undefined });
		const noListener = await probed({ onUiState: undefined });

		expect(offered).toEqual({ slots: [SLOT], registerUiSlot: "function" });
		const withheld = { slots: null, registerUiSlot: "undefined" };
		expect(emptyCatalog).toEqual(withheld);
		expect(noCatalog).toEqual(withheld);
		expect(noListener).toEqual(withheld);
	}, 60_000);

	it("delivers setup-time and handler updates stamped with the plugin's name, and round-trips invokeUiSlot", async () => {
		const { sandbox, states } = await loadUiPlugin(
			"ui-round-trip.mjs",
			roundTripPlugin("ui-round-trip"),
		);
		expect(states).toEqual([
			{
				pluginName: "ui-round-trip",
				slot: SLOT,
				state: expect.objectContaining({ revision: "r1" }),
			},
		]);

		const { uiSlots, api } = createApiCapture();
		await sandbox.extensions?.[0]?.setup?.(api, {});
		expect(uiSlots.map((uiSlot) => uiSlot.slot)).toEqual([SLOT]);
		const refresh: PluginUiAction = {
			verb: "refresh",
			revision: "r1",
			input: "key",
			cause: "new_set",
		};
		await expect(uiSlots[0]?.onAction(refresh, actionContext)).resolves.toEqual(
			{ outcome: "ok" },
		);
		// Updates made while handling an action arrive before its reply.
		expect(states[1]).toEqual({
			pluginName: "ui-round-trip",
			slot: SLOT,
			state: expect.objectContaining({ revision: "r2", note: "refresh:1" }),
		});
	}, 60_000);

	it("drops unregistered, unserializable and oversized updates in the sandbox without throwing into the plugin", async () => {
		const { sandbox, states, events } = await loadUiPlugin(
			"ui-drops.mjs",
			[
				"export default {",
				"  name: 'ui-drops',",
				"  manifest: { capabilities: ['hooks'] },",
				"  setup(api, ctx) {",
				"    const threw = [];",
				"    const attempt = (slot, state) => { try { ctx.ui.update(slot, state); } catch (error) { threw.push(String(error)); } };",
				"    const state = (revision) => ({ status: 'ready', title: 'T', revision, items: [], canRefresh: false });",
				"    attempt('composer.suggestions', state('before-register'));",
				"    api.registerUiSlot({ slot: 'composer.suggestions', onAction: () => ({ outcome: 'ok' }) });",
				"    api.registerUiSlot({ slot: 'composer.elsewhere', onAction: () => ({ outcome: 'ok' }) });",
				"    attempt('composer.elsewhere', state('elsewhere'));",
				"    attempt('composer.suggestions', { ...state('bigint'), big: 1n });",
				"    const cyclic = state('cycle');",
				"    cyclic.self = cyclic;",
				"    attempt('composer.suggestions', cyclic);",
				// 30,000 UTF-16 units but about 90 KB of UTF-8: over the byte limit only.
				"    attempt('composer.suggestions', { ...state('too-large'), note: '\\u4e00'.repeat(30000) });",
				"    attempt('composer.suggestions', state('kept'));",
				"    ctx.emitEvent('attempts', { threw });",
				"  },",
				"};",
			].join("\n"),
		);

		expect(states.map(revisionOf)).toEqual(["kept"]);
		expect(pluginLogReasons(events)).toEqual([
			"unregistered",
			"unregistered",
			"unserializable",
			"unserializable",
			"too_large",
		]);
		expect(events.find((event) => event.name === "attempts")?.payload).toEqual({
			threw: [],
		});
		const { uiSlots, api } = createApiCapture();
		await sandbox.extensions?.[0]?.setup?.(api, {});
		expect(uiSlots.map((uiSlot) => uiSlot.slot)).toEqual([SLOT]);
	}, 60_000);

	it("refuses reserved event names on every emitter a plugin reaches", async () => {
		const setupStarted: string[] = [];
		const { sandbox, states, events } = await loadUiPlugin(
			"ui-reserved.mjs",
			[
				"const forged = (revision) => ({ pluginName: 'ui-reserved', slot: 'composer.suggestions', state: { status: 'ready', title: 'T', revision, items: [], canRefresh: false } });",
				"export default {",
				"  name: 'ui-reserved',",
				"  manifest: { capabilities: ['tools'] },",
				"  setup(api, ctx) {",
				"    api.registerUiSlot({ slot: 'composer.suggestions', onAction: () => ({ outcome: 'ok' }) });",
				"    ctx.emitEvent('__cline_ui_state', forged('setup-context'));",
				"    ctx.emitEvent('__cline_setup_started', { pluginPath: 'forged' });",
				"    globalThis.__clinePluginHost.emitEvent('__cline_ui_state', forged('global-shim'));",
				"    api.registerTool({",
				"      name: 'forge',",
				"      description: 'forge internal events',",
				"      inputSchema: { type: 'object', properties: {} },",
				"      execute: async (_input, context) => {",
				"        context.emitEvent('__cline_tool_update', { callId: 'any', update: 'forged' });",
				"        context.emitEvent('__cline_ui_state', forged('tool-context'));",
				"        context.emitUpdate({ step: 1 });",
				"        return 'done';",
				"      },",
				"    });",
				"  },",
				"};",
			].join("\n"),
			{ onSetupStarted: (pluginPath) => setupStarted.push(pluginPath) },
		);
		const { tools, api } = createApiCapture();
		await sandbox.extensions?.[0]?.setup?.(api, {});
		const updates: unknown[] = [];
		await expect(
			tools[0]?.execute({}, {
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
				emitUpdate: (update: unknown) => updates.push(update),
			} as AgentToolContext),
		).resolves.toBe("done");

		expect(states).toEqual([]);
		expect(setupStarted).toEqual([join(dir, "ui-reserved.mjs")]);
		expect(updates).toEqual([{ step: 1 }]);
		expect(refusedEventLogs(events)).toEqual([
			'Refused to emit the reserved event "__cline_ui_state"',
			'Refused to emit the reserved event "__cline_setup_started"',
			'Refused to emit the reserved event "__cline_ui_state"',
			'Refused to emit the reserved event "__cline_tool_update"',
			'Refused to emit the reserved event "__cline_ui_state"',
		]);
	}, 60_000);

	it("trusts the descriptor, not the payload, for whose state a raw post is", async () => {
		const { states } = await loadUiPlugin(
			"ui-raw.mjs",
			[
				"import { parentPort } from 'node:worker_threads';",
				"export default {",
				"  name: 'ui-raw',",
				"  manifest: { capabilities: ['hooks'] },",
				"  setup(api) {",
				"    api.registerUiSlot({ slot: 'composer.suggestions', onAction: () => ({ outcome: 'ok' }) });",
				"    const message = { type: 'event', name: '__cline_ui_state', payload: { pluginName: 'impostor', slot: 'composer.suggestions', state: { revision: 'raw' } } };",
				"    if (parentPort) parentPort.postMessage(message); else process.send(message);",
				"  },",
				"};",
			].join("\n"),
		);
		// A worker runs one plugin, so its posts are that plugin's. The
		// subprocess can only match the claimed name, and no plugin has it.
		expect(states).toEqual(
			transport === "worker"
				? [{ pluginName: "ui-raw", slot: SLOT, state: { revision: "raw" } }]
				: [],
		);
	}, 60_000);

	it("drops UI state from a bootstrap whose descriptors register no slots", async () => {
		const bootstrapPath = join(dir, "old-bootstrap.mjs");
		await writeFile(
			bootstrapPath,
			[
				"import { parentPort } from 'node:worker_threads';",
				"const post = (message) => (parentPort ? parentPort.postMessage(message) : process.send(message));",
				"const forged = { type: 'event', name: '__cline_ui_state', payload: { pluginName: 'old-plugin', slot: 'composer.suggestions', state: { revision: 'old' } } };",
				"const onMessage = (message) => {",
				"  if (!message || message.type !== 'call') return;",
				"  post(forged);",
				"  const result = message.method !== 'initialize' ? undefined : {",
				"    plugins: [{",
				"      pluginId: 'plugin_1',",
				"      pluginPath: 'old-plugin',",
				"      name: 'old-plugin',",
				"      manifest: { capabilities: ['hooks'] },",
				"      hooks: ['afterRun'],",
				"      contributions: { tools: [], commands: [], messageBuilders: [], providers: [], automationEventTypes: [] },",
				"    }],",
				"    failures: [],",
				"    warnings: [],",
				"  };",
				"  post({ type: 'response', id: message.id, ok: true, result });",
				"};",
				"if (parentPort) {",
				"  parentPort.on('message', onMessage);",
				"  post({ type: 'ready' });",
				"} else {",
				"  process.on('message', onMessage);",
				"}",
			].join("\n"),
			"utf8",
		);
		vi.stubEnv(CLINE_PLUGIN_BOOTSTRAP_PATH_ENV, bootstrapPath);
		vi.resetModules();
		try {
			const { loadSandboxedPlugins: loadWithOldBootstrap } = await import(
				"./plugin-sandbox"
			);
			const states: UiStateEvent[] = [];
			const sandbox = await loadWithOldBootstrap({
				transport,
				pluginPaths: [join(dir, "unused-plugin.mjs")],
				uiSlots: [SLOT],
				onUiState: (event) => states.push(event),
			});
			loaded.push(sandbox);
			await sandbox.extensions?.[0]?.hooks?.afterRun?.(afterRunPayload());

			expect(sandbox.extensions?.map((extension) => extension.name)).toEqual([
				"old-plugin",
			]);
			expect(states).toEqual([]);
		} finally {
			vi.unstubAllEnvs();
			vi.resetModules();
		}
	}, 60_000);

	it("keeps the slot through idle reclaim: cleanup cannot clear it, setup re-delivers it, and the invoke is answered", async () => {
		vi.stubEnv(CLINE_PLUGIN_IDLE_TIMEOUT_MS_ENV, "1000");
		vi.useFakeTimers();
		try {
			const { sandbox, states, events } = await loadUiPlugin(
				"ui-idle.mjs",
				roundTripPlugin("ui-idle"),
			);
			const { uiSlots, api } = createApiCapture();
			await sandbox.extensions?.[0]?.setup?.(api, {});
			expect(states.map(revisionOf)).toEqual(["r1"]);

			await vi.advanceTimersByTimeAsync(1001);

			await expect(
				uiSlots[0]?.onAction(
					{ verb: "refresh", revision: "r1", input: "key", cause: "more" },
					actionContext,
				),
			).resolves.toEqual({ outcome: "ok" });
			// Only the worker transport runs cleanup before an idle reclaim.
			const cleanedUp = transport === "worker";
			expect(events.some((event) => event.name === "disposing")).toBe(
				cleanedUp,
			);
			expect(pluginLogReasons(events)).toEqual(cleanedUp ? ["disposing"] : []);
			// The fresh worker's setup publishes again, then the retried action.
			expect(states.map(revisionOf)).toEqual(["r1", "r1", "r2"]);
			expect(new Set(states.map((event) => event.pluginName))).toEqual(
				new Set(["ui-idle"]),
			);
		} finally {
			vi.useRealTimers();
			vi.unstubAllEnvs();
		}
	}, 60_000);

	it("runs the composer-suggestions fixture: its setup state on load, its verbs, and a new set after every run", async () => {
		const { sandbox, states } = await loadWithUi(FIXTURE_PLUGIN_PATH);
		const itemIds = (event: UiStateEvent | undefined) =>
			(event?.state as { items: Array<{ id: string }> }).items.map(
				(item) => item.id,
			);
		expect(states).toEqual([
			{
				pluginName: "composer-suggestions-demo",
				slot: SLOT,
				state: expect.objectContaining({
					status: "ready",
					title: "Demo",
					command: "demo",
					revision: "r1",
				}),
			},
		]);
		expect(itemIds(states[0])).toEqual(["verify", "commit"]);

		const extension = sandbox.extensions?.[0];
		const { uiSlots, api } = createApiCapture();
		await extension?.setup?.(api, {});
		await extension?.hooks?.afterRun?.(afterRunPayload());
		expect(revisionOf(states[1])).toBe("r2");
		expect(itemIds(states[1])).toEqual(["verify", "commit"]);

		const skip: PluginUiAction = {
			verb: "skip",
			revision: "r2",
			itemId: "verify",
			input: "key",
		};
		await expect(uiSlots[0]?.onAction(skip, actionContext)).resolves.toEqual({
			outcome: "ok",
		});
		expect(revisionOf(states[2])).toBe("r3");
		expect(itemIds(states[2])).toEqual(["commit"]);
		await expect(uiSlots[0]?.onAction(skip, actionContext)).resolves.toEqual({
			outcome: "refused",
			reason: "stale",
		});

		await extension?.hooks?.afterRun?.(afterRunPayload());
		expect(revisionOf(states[3])).toBe("r4");
		expect(itemIds(states[3])).toEqual(["verify", "commit"]);
	}, 60_000);

	it("runs the composer-suggestions fixture as an ordinary plugin when the session has no slots", async () => {
		const { sandbox, states } = await loadWithUi(FIXTURE_PLUGIN_PATH, {
			uiSlots: [],
		});
		const extension = sandbox.extensions?.[0];
		expect(extension?.name).toBe("composer-suggestions-demo");
		const { uiSlots, api } = createApiCapture();
		await extension?.setup?.(api, {});
		await extension?.hooks?.afterRun?.(afterRunPayload());
		expect(uiSlots).toEqual([]);
		expect(states).toEqual([]);
	}, 60_000);
});
