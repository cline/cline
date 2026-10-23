import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
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
