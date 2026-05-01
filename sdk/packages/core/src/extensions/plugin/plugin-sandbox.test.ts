import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentConfig,
	AgentExtensionMessageBuilder,
	Message,
	Tool,
	ToolContext,
} from "@clinebot/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadSandboxedPlugins } from "./plugin-sandbox";

function createApiCapture() {
	const tools: Tool[] = [];
	const messageBuilders: AgentExtensionMessageBuilder<Message[]>[] = [];
	const automationEventTypes: unknown[] = [];
	const api = {
		registerTool: (tool: Tool) => tools.push(tool),
		registerCommand: () => {},
		registerMessageBuilder: (
			builder: AgentExtensionMessageBuilder<Message[]>,
		) => messageBuilders.push(builder),
		registerRule: () => {},
		registerProvider: () => {},
		registerAutomationEventType: (eventType: unknown) =>
			automationEventTypes.push(eventType),
	};
	return { tools, messageBuilders, automationEventTypes, api };
}

describe("plugin-sandbox", () => {
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
				"  manifest: { capabilities: ['hooks','tools'], hookStages: ['input'] },",
				"  setup(api) {",
				"    api.registerTool({",
				"      name: 'sandbox_echo',",
				"      description: 'echo',",
				"      inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },",
				"      execute: async (input) => ({ echoed: input.value }),",
				"    });",
				"  },",
				"  onInput(ctx) { return { overrideInput: String(ctx.input || '').toUpperCase() }; }",
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
				"  manifest: { capabilities: ['hooks'], hookStages: ['run_end'] },",
				"  onRunEnd(ctx) {",
				"    globalThis.__clinePluginHost?.emitEvent?.('run_end_hook', {",
				"      finishReason: ctx.result?.finishReason,",
				"      iterations: ctx.result?.iterations,",
				"    });",
				"  },",
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

		const sdkDepDir = join(dir, "node_modules", "@clinebot", "shared");
		await mkdir(sdkDepDir, { recursive: true });
		await writeFile(
			join(sdkDepDir, "package.json"),
			JSON.stringify({
				name: "@clinebot/shared",
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
				"import { sdkMarker } from '@clinebot/shared';",
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
				"import { resolveClineDataDir } from '@clinebot/shared/storage';",
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
				"import { createTool } from '@clinebot/agents';",
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
			pluginPaths: [
				join(dir, "plugin.mjs"),
				join(dir, "plugin-events.mjs"),
				join(dir, "plugin-run-end.mjs"),
				join(dir, "plugin-automation-events.mjs"),
				join(dir, "plugin-message-builder.mjs"),
				join(dir, "plugin-ts.ts"),
				join(dir, "plugin-dep.ts"),
				join(dir, "plugin-sdk.ts"),
				join(dir, "plugin-host-dep.ts"),
				join(dir, "plugin-create-tool.ts"),
			],
			// CI environments are significantly slower for jiti transpilation;
			// the default 4 000 ms is too tight for 7 plugins.
			importTimeoutMs: 30_000,
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
		type AgentExtensionInputContext = Parameters<
			NonNullable<NonNullable<AgentConfig["extensions"]>[number]["onInput"]>
		>[0];
		const inputContext: AgentExtensionInputContext = {
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			mode: "run",
			input: "hello",
		};
		const control = await extension?.onInput?.(inputContext);
		expect(control?.overrideInput).toBe("HELLO");

		const { tools, api } = createApiCapture();
		await extension?.setup?.(api, {});
		expect(tools.map((tool) => tool.name)).toContain("sandbox_echo");
		const echoTool = tools.find((tool) => tool.name === "sandbox_echo");
		expect(echoTool).toBeDefined();
		const result = await echoTool?.execute({ value: "ok" }, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
		} as ToolContext);
		expect(result).toEqual({ echoed: "ok" });
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
					"  manifest: { capabilities: ['hooks'], hookStages: ['input'] },",
					"  onInput() { return new Promise(() => {}); }",
					"};",
				].join("\n"),
				"utf8",
			);

			const sandboxed = await loadSandboxedPlugins({
				pluginPaths: [pluginPath],
				hookTimeoutMs: 50,
			});
			const extension = sandboxed.extensions?.[0];
			await expect(
				extension?.onInput?.({
					agentId: "agent-1",
					conversationId: "conv-1",
					parentAgentId: null,
					mode: "run",
					input: "hello",
				}),
			).rejects.toThrow(/timed out/i);
			await sandboxed.shutdown();
		} finally {
			await rm(timeoutDir, { recursive: true, force: true });
		}
	});

	it("forwards sandbox plugin events to the host", async () => {
		const extension = sharedExtensions.get("sandbox-events");
		const { tools, api } = createApiCapture();
		await extension?.setup?.(api, {});
		const tool = tools.find((entry) => entry.name === "emit_event");
		await tool?.execute({ value: "hello" }, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
		} as ToolContext);
		expect(forwardedEvents).toEqual([
			{
				name: "test_event",
				payload: { value: "hello" },
			},
		]);
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
		} as ToolContext);
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
		expect(typeof extension?.onRunEnd).toBe("function");
		await extension?.onRunEnd?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			result: {
				text: "done",
				usage: { inputTokens: 1, outputTokens: 2 },
				messages: [],
				toolCalls: [],
				iterations: 2,
				finishReason: "completed",
				model: { id: "test-model", provider: "test-provider" },
				startedAt: new Date("2026-04-25T00:00:00.000Z"),
				endedAt: new Date("2026-04-25T00:00:01.000Z"),
				durationMs: 1000,
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
		} as ToolContext);
		expect(result).toEqual({ echoed: "ok" });
	});

	it("continues loading remaining sandbox plugins when one setup fails", async () => {
		const sandboxed = await loadSandboxedPlugins({
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
		} as ToolContext);
		expect(result).toEqual({ echoed: "ok" });
	});

	it("loads sandbox plugins matching manifest providerIds and modelIds", async () => {
		const matched = await loadSandboxedPlugins({
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
