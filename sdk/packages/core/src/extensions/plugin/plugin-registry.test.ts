import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentExtension,
	AgentExtensionApi,
	AgentTool,
	AgentToolContext,
	Message,
	PluginStatusRecord,
	SessionPluginIssue,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	PluginCallTimeoutError,
	PluginRegistry,
	type PluginSessionLoadInput,
	type PluginSessionLoadResult,
} from "./plugin-registry";
import { setPluginBootstrapUnavailableForTests } from "./plugin-sandbox";

function noopApi(): AgentExtensionApi<AgentTool, Message[]> {
	return {
		registerTool: () => {},
		registerCommand: () => {},
		registerRule: () => {},
		registerMessageBuilder: () => {},
		registerProvider: () => {},
		registerAutomationEventType: () => {},
		registerMcpServer: () => {},
	};
}

async function toolsOf(extension: AgentExtension | undefined) {
	const tools: AgentTool[] = [];
	await extension?.setup?.(
		{ ...noopApi(), registerTool: (tool: AgentTool) => tools.push(tool) },
		{},
	);
	return tools;
}

const toolContext: AgentToolContext = { agentId: "agent", iteration: 1 };

/** A plugin whose tool runs `body` (an async function body taking `input`). */
function toolPlugin(name: string, body = `return "ok from ${name}";`) {
	return `import { isMainThread } from "node:worker_threads";
export default {
	name: ${JSON.stringify(name)},
	manifest: { capabilities: ["tools", "hooks"] },
	hooks: { beforeRun() {} },
	setup(api) {
		api.registerTool({
			name: ${JSON.stringify(`${name}_tool`)},
			description: "test tool",
			inputSchema: { type: "object" },
			execute: async (input) => { ${body} },
		});
	},
};
`;
}

describe("PluginRegistry", () => {
	let root: string;
	let registry: PluginRegistry;
	let statusEvents: PluginStatusRecord[];
	const sessions: PluginSessionLoadResult[] = [];

	const write = async (file: string, source: string) => {
		const path = join(root, file);
		await writeFile(path, source, "utf8");
		return path;
	};

	const load = async (
		input: PluginSessionLoadInput,
	): Promise<PluginSessionLoadResult> => {
		const loaded = await registry.loadForSession(input);
		sessions.push(loaded);
		return loaded;
	};

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "core-plugin-registry-"));
		registry = new PluginRegistry({
			hookTimeoutMs: 2_000,
			toolTimeoutMs: 2_000,
			importTimeoutMs: 15_000,
			failureThreshold: 3,
		});
		statusEvents = [];
		registry.subscribe((status) => statusEvents.push(status));
	});

	afterEach(async () => {
		await Promise.all(sessions.splice(0).map((session) => session.release()));
		await rm(root, { recursive: true, force: true });
	});

	it("runs the plugin off the main thread and reports it ready", async () => {
		const path = await write(
			"thread.mjs",
			toolPlugin("thread", "return { isMainThread };"),
		);
		const session = await load({ sessionId: "s1", pluginPaths: [path] });
		const [tool] = await toolsOf(session.extensions[0]);
		await expect(tool?.execute({}, toolContext)).resolves.toEqual({
			isMainThread: false,
		});
		const [status] = registry.get("thread");
		expect(status).toMatchObject({
			name: "thread",
			state: "ready",
			sessionIds: ["s1"],
			hooks: ["beforeRun"],
		});
		expect(status?.capabilities).toContain("tools");
	}, 30_000);

	it("gives each session its own worker", async () => {
		const path = await write(
			"counter.mjs",
			toolPlugin(
				"counter",
				"globalThis.n = (globalThis.n ?? 0) + 1; return globalThis.n;",
			),
		);
		const first = await load({ sessionId: "a", pluginPaths: [path] });
		const second = await load({ sessionId: "b", pluginPaths: [path] });
		const [toolA] = await toolsOf(first.extensions[0]);
		const [toolB] = await toolsOf(second.extensions[0]);
		await toolA?.execute({}, toolContext);
		await expect(toolA?.execute({}, toolContext)).resolves.toBe(2);
		await expect(toolB?.execute({}, toolContext)).resolves.toBe(1);
	}, 30_000);

	it("applies the session policy", async () => {
		const kept = await write("kept.mjs", toolPlugin("kept"));
		const dropped = await write("dropped.mjs", toolPlugin("dropped"));
		const session = await load({
			sessionId: "s1",
			pluginPaths: [kept, dropped],
			policy: { dropped: { enabled: false } },
		});
		expect(session.extensions.map((extension) => extension.name)).toEqual([
			"kept",
		]);
		expect(session.issues).toContainEqual(
			expect.objectContaining({
				name: "dropped",
				state: "disabled",
				reason: "session_policy",
			}),
		);
	}, 30_000);

	it("marks a plugin that fails to import failed for every session", async () => {
		const broken = await write(
			"broken.mjs",
			"throw new Error('boom at import');\nexport default {};",
		);
		const good = await write("good.mjs", toolPlugin("good"));
		const session = await load({
			sessionId: "s1",
			pluginPaths: [broken, good],
		});
		expect(session.extensions.map((extension) => extension.name)).toEqual([
			"good",
		]);
		expect(session.issues).toContainEqual(
			expect.objectContaining({ name: "broken", state: "failed" }),
		);
		expect(registry.get("broken")[0]?.lastError?.message).toMatch(
			/boom at import/,
		);
		const next = await load({ sessionId: "s2", pluginPaths: [broken] });
		expect(next.extensions).toHaveLength(0);
		expect(next.issues[0]).toMatchObject({ name: "broken", state: "failed" });
	}, 30_000);

	it("fails only the session whose setup threw", async () => {
		const path = await write(
			"flaky.mjs",
			`export default {
	name: "flaky",
	manifest: { capabilities: ["tools"] },
	setup() { if (process.env.FLAKY_FAIL === "1") throw new Error("setup boom"); },
};`,
		);
		process.env.FLAKY_FAIL = "1";
		try {
			const failing = await load({ sessionId: "s1", pluginPaths: [path] });
			expect(failing.issues).toContainEqual(
				expect.objectContaining({ name: "flaky", state: "failed" }),
			);
			expect(registry.get("flaky")[0]?.lastError?.phase).toBe("setup");
		} finally {
			delete process.env.FLAKY_FAIL;
		}
		// Setup failure does not block the plugin: the next session tries again.
		const working = await load({ sessionId: "s2", pluginPaths: [path] });
		expect(working.extensions.map((extension) => extension.name)).toEqual([
			"flaky",
		]);
		expect(registry.get("flaky")[0]?.state).toBe("ready");
	}, 30_000);

	it("degrades on tool failures and turns the plugin off at the threshold", async () => {
		const path = await write(
			"thrower.mjs",
			toolPlugin("thrower", "throw new Error('tool boom');"),
		);
		const issues: SessionPluginIssue[] = [];
		const session = await load({
			sessionId: "s1",
			pluginPaths: [path],
			onIssue: (issue) => issues.push(issue),
		});
		const [tool] = await toolsOf(session.extensions[0]);
		for (let attempt = 0; attempt < 3; attempt++) {
			await expect(tool?.execute({}, toolContext)).rejects.toThrow(/tool boom/);
		}
		expect(registry.get("thrower")[0]?.state).toBe("failed");
		expect(issues.map((issue) => issue.state)).toEqual(["degraded", "failed"]);
		await expect(tool?.execute({}, toolContext)).rejects.toThrow(
			/is unavailable/,
		);
		const next = await load({ sessionId: "s2", pluginPaths: [path] });
		expect(next.extensions).toHaveLength(0);
	}, 30_000);

	it("turns a plugin off when its worker dies, and the host keeps running", async () => {
		const path = await write(
			"crasher.mjs",
			toolPlugin(
				"crasher",
				"setTimeout(() => { Promise.reject(new Error('stray rejection')); }, 0); return 'scheduled';",
			),
		);
		const issues: SessionPluginIssue[] = [];
		const session = await load({
			sessionId: "s1",
			pluginPaths: [path],
			onIssue: (issue) => issues.push(issue),
		});
		const [tool] = await toolsOf(session.extensions[0]);
		await expect(tool?.execute({}, toolContext)).resolves.toBe("scheduled");
		await expect
			.poll(() => registry.get("crasher")[0]?.state, { timeout: 10_000 })
			.toBe("failed");
		expect(registry.get("crasher")[0]?.lastError).toMatchObject({
			phase: "uncaught",
		});
		expect(issues.at(-1)).toMatchObject({ name: "crasher", state: "failed" });
	}, 30_000);

	it("reports process.exit during setup as a failed plugin", async () => {
		const path = await write(
			"exiter.mjs",
			`export default {
	name: "exiter",
	manifest: { capabilities: ["tools"] },
	setup() { process.exit(1); },
};`,
		);
		const session = await load({ sessionId: "s1", pluginPaths: [path] });
		expect(session.extensions).toHaveLength(0);
		expect(registry.get("exiter")[0]?.state).toBe("failed");
		expect(registry.get("exiter")[0]?.lastError).toMatchObject({
			phase: "setup",
			message: expect.stringMatching(/exited \(code=1\)/),
		});
	}, 30_000);

	it("stops a hung tool at its timeout without failing the host", async () => {
		const path = await write(
			"spinner.mjs",
			toolPlugin("spinner", "if (input.spin) { for (;;) {} } return 'ok';"),
		);
		const session = await load({
			sessionId: "s1",
			pluginPaths: [path],
			callTimeoutMs: 500,
		});
		const [tool] = await toolsOf(session.extensions[0]);
		await expect(tool?.execute({ spin: true }, toolContext)).rejects.toThrow(
			/timed out/,
		);
		expect(registry.get("spinner")[0]).toMatchObject({
			state: "degraded",
			timeoutCount: 1,
		});
	}, 30_000);

	it("reloads a fixed plugin and keeps stale copies from turning it off", async () => {
		const path = await write(
			"fixme.mjs",
			toolPlugin("fixme", "throw new Error('old code');"),
		);
		const old = await load({ sessionId: "old", pluginPaths: [path] });
		const [oldTool] = await toolsOf(old.extensions[0]);
		await expect(oldTool?.execute({}, toolContext)).rejects.toThrow(/old code/);

		await write("fixme.mjs", toolPlugin("fixme", "return 'new code';"));
		const [reloaded] = await registry.reload("fixme");
		expect(reloaded).toMatchObject({ state: "ready", errorCount: 0 });

		// The old session's copy keeps failing; that must not count.
		for (let attempt = 0; attempt < 3; attempt++) {
			await expect(oldTool?.execute({}, toolContext)).rejects.toThrow(
				/old code/,
			);
		}
		expect(registry.get("fixme")[0]?.state).toBe("ready");
		const fresh = await load({ sessionId: "new", pluginPaths: [path] });
		const [freshTool] = await toolsOf(fresh.extensions[0]);
		await expect(freshTool?.execute({}, toolContext)).resolves.toBe("new code");
	}, 30_000);

	it("preloads status in throwaway workers", async () => {
		const good = await write("pre-good.mjs", toolPlugin("pre-good"));
		const bad = await write(
			"pre-bad.mjs",
			"throw new Error('nope');\nexport default {};",
		);
		const statuses = await registry.preload({
			pluginPaths: [good, bad],
		});
		expect(
			statuses.map(({ name, state, sessionIds }) => ({
				name,
				state,
				sessionIds,
			})),
		).toEqual([
			{ name: "pre-bad", state: "failed", sessionIds: [] },
			{ name: "pre-good", state: "ready", sessionIds: [] },
		]);
	}, 30_000);

	it("gives setup the session cwd, events, and onDispose cleanup", async () => {
		const marker = join(root, "disposed.txt");
		const path = await write(
			"ctx.mjs",
			`import { writeFileSync } from "node:fs";
export default {
	name: "ctx",
	manifest: { capabilities: ["tools"] },
	setup(api, ctx) {
		ctx.emitEvent("setup_ctx", { cwd: ctx.cwd });
		ctx.onDispose(() => writeFileSync(${JSON.stringify(marker)}, "done"));
		api.registerTool({
			name: "ctx_tool",
			description: "test tool",
			inputSchema: { type: "object" },
			execute: async () => ctx.cwd,
		});
	},
};`,
		);
		const events: Array<{ name: string; payload?: unknown }> = [];
		const session = await load({
			sessionId: "s1",
			pluginPaths: [path],
			cwd: root,
			emitEvent: (event) => events.push(event),
		});
		const [tool] = await toolsOf(session.extensions[0]);
		await expect(tool?.execute({}, toolContext)).resolves.toBe(root);
		expect(events).toContainEqual({
			name: "setup_ctx",
			payload: { cwd: root },
		});
		await session.release();
		await expect(readFile(marker, "utf8")).resolves.toBe("done");
	}, 30_000);

	it("bridges abort, progress updates, and events in the tool context", async () => {
		const path = await write(
			"live.mjs",
			toolPlugin(
				"live",
				`context.emitUpdate({ step: 1 });
		context.emitEvent("tool_event", { from: "tool" });
		if (!input.wait) return "done";
		return await new Promise((resolve) => {
			context.signal.addEventListener("abort", () => resolve("aborted"));
		});`,
			).replace(
				"execute: async (input) =>",
				"execute: async (input, context) =>",
			),
		);
		const events: Array<{ name: string; payload?: unknown }> = [];
		const session = await load({
			sessionId: "s1",
			pluginPaths: [path],
			emitEvent: (event) => events.push(event),
		});
		const [tool] = await toolsOf(session.extensions[0]);
		const updates: unknown[] = [];
		const controller = new AbortController();
		const running = tool?.execute(
			{ wait: true },
			{
				...toolContext,
				signal: controller.signal,
				emitUpdate: (update) => updates.push(update),
			},
		);
		await expect.poll(() => updates.length).toBe(1);
		controller.abort();
		await expect(running).resolves.toBe("aborted");
		expect(updates).toEqual([{ step: 1 }]);
		expect(events).toContainEqual({
			name: "tool_event",
			payload: { from: "tool" },
		});
	}, 30_000);

	it("keeps the tool definition fields the plugin declared", async () => {
		const path = await write(
			"definition.mjs",
			`export default {
	name: "definition",
	manifest: { capabilities: ["tools"] },
	setup(api) {
		api.registerTool({
			name: "finish",
			description: "ends the run",
			inputSchema: { type: "object" },
			lifecycle: { completesRun: true },
			executionMode: "sequential",
			resultPolicy: "cache-oversized",
			maxRetries: 2,
			execute: async () => "ok",
		});
	},
};`,
		);
		const session = await load({ sessionId: "s1", pluginPaths: [path] });
		const [tool] = await toolsOf(session.extensions[0]);
		expect(tool).toMatchObject({
			name: "finish",
			lifecycle: { completesRun: true },
			executionMode: "sequential",
			resultPolicy: "cache-oversized",
			maxRetries: 2,
		});
	}, 30_000);

	it("fails only the session whose setup is too slow", async () => {
		const path = await write(
			"slow.mjs",
			`export default {
	name: "slow",
	manifest: { capabilities: ["tools"] },
	async setup() {
		if (process.env.SLOW_SETUP === "1") await new Promise((r) => setTimeout(r, 5000));
	},
};`,
		);
		const slowRegistry = new PluginRegistry({
			setupTimeoutMs: 300,
			importTimeoutMs: 15_000,
		});
		process.env.SLOW_SETUP = "1";
		let slow: PluginSessionLoadResult | undefined;
		try {
			slow = await slowRegistry.loadForSession({
				sessionId: "s1",
				pluginPaths: [path],
			});
		} finally {
			delete process.env.SLOW_SETUP;
		}
		expect(slow.extensions).toHaveLength(0);
		expect(slowRegistry.get("slow")[0]?.lastError).toMatchObject({
			phase: "setup",
			message: expect.stringMatching(/timed out/),
		});
		const next = await slowRegistry.loadForSession({
			sessionId: "s2",
			pluginPaths: [path],
		});
		expect(next.extensions.map((extension) => extension.name)).toEqual([
			"slow",
		]);
		await Promise.all([slow.release(), next.release()]);
	}, 30_000);

	it("treats a setup that hangs the worker as a setup failure", async () => {
		const path = await write(
			"hang.mjs",
			`export default {
	name: "hang",
	manifest: { capabilities: ["tools"] },
	setup() { if (process.env.HANG_SETUP === "1") { for (;;) {} } },
};`,
		);
		// A synchronous loop blocks the in-worker setup timer, so the host's
		// import + setup deadline is what stops it.
		const hangRegistry = new PluginRegistry({
			setupTimeoutMs: 300,
			importTimeoutMs: 3_000,
		});
		process.env.HANG_SETUP = "1";
		try {
			const hung = await hangRegistry.loadForSession({
				sessionId: "s1",
				pluginPaths: [path],
			});
			expect(hung.extensions).toHaveLength(0);
		} finally {
			delete process.env.HANG_SETUP;
		}
		expect(hangRegistry.get("hang")[0]?.lastError?.phase).toBe("setup");
		const next = await hangRegistry.loadForSession({
			sessionId: "s2",
			pluginPaths: [path],
		});
		expect(next.extensions).toHaveLength(1);
		await next.release();
	}, 60_000);

	it("applies a policy that names the plugin by its exported name", async () => {
		// The file name (kept.mjs) differs from the plugin's own name.
		const path = await write("kept.mjs", toolPlugin("kept-plugin"));
		const session = await load({
			sessionId: "s1",
			pluginPaths: [path],
			policy: { "*": { enabled: false }, "kept-plugin": { enabled: true } },
		});
		expect(session.extensions.map((extension) => extension.name)).toEqual([
			"kept-plugin",
		]);
	}, 30_000);

	it("does not run setup for a plugin the policy turns off by exported name", async () => {
		const marker = join(root, "setup-ran.txt");
		const path = await write(
			"off.mjs",
			`import { writeFileSync } from "node:fs";
export default {
	name: "off-plugin",
	manifest: { capabilities: ["tools"] },
	setup() { writeFileSync(${JSON.stringify(marker)}, "ran"); },
};`,
		);
		const policy = { "off-plugin": { enabled: false } };
		const first = await load({ sessionId: "s1", pluginPaths: [path], policy });
		expect(first.extensions).toHaveLength(0);
		expect(first.issues).toContainEqual(
			expect.objectContaining({
				name: "off-plugin",
				state: "disabled",
				reason: "session_policy",
			}),
		);
		await expect(readFile(marker, "utf8")).rejects.toThrow();
		// Once the name is known, later sessions skip the worker entirely.
		const second = await load({ sessionId: "s2", pluginPaths: [path], policy });
		expect(second.issues[0]).toMatchObject({
			name: "off-plugin",
			reason: "session_policy",
		});
	}, 30_000);

	it("runs a failed setup's onDispose cleanup", async () => {
		const marker = join(root, "cleaned-after-failure.txt");
		const path = await write(
			"fails-after-start.mjs",
			`import { writeFileSync } from "node:fs";
export default {
	name: "fails-after-start",
	manifest: { capabilities: ["tools"] },
	setup(_api, ctx) {
		ctx.onDispose(() => writeFileSync(${JSON.stringify(marker)}, "cleaned"));
		throw new Error("setup failed after starting work");
	},
};`,
		);
		const session = await load({ sessionId: "s1", pluginPaths: [path] });
		expect(session.extensions).toHaveLength(0);
		expect(registry.get("fails-after-start")[0]?.lastError?.phase).toBe(
			"setup",
		);
		await expect(readFile(marker, "utf8")).resolves.toBe("cleaned");
	}, 30_000);

	it("records a rejecting hook, follows hookErrorMode, and stops after repeated failures", async () => {
		const marker = join(root, "hook-calls.txt");
		const path = await write(
			"rejecting-hook.mjs",
			`import { appendFileSync } from "node:fs";
export default {
	name: "rejecting-hook",
	manifest: { capabilities: ["hooks"] },
	hooks: {
		async beforeRun() {
			appendFileSync(${JSON.stringify(marker)}, "x");
			throw new Error("hook rejected");
		},
	},
};`,
		);
		const ignore = await load({ sessionId: "s1", pluginPaths: [path] });
		const strict = await load({
			sessionId: "s2",
			pluginPaths: [path],
			hookErrorMode: "throw",
		});
		const beforeRun = ignore.extensions[0]?.hooks?.beforeRun;
		const strictBeforeRun = strict.extensions[0]?.hooks?.beforeRun;
		const context = { snapshot: {} } as never;

		await expect(beforeRun?.(context)).resolves.toBeUndefined();
		expect(registry.get(path)[0]).toMatchObject({
			state: "degraded",
			errorCount: 1,
			lastError: { phase: "hook:beforeRun", message: "hook rejected" },
		});
		await expect(strictBeforeRun?.(context)).rejects.toThrow("hook rejected");
		await beforeRun?.(context);
		expect(registry.get(path)[0]?.state).toBe("failed");

		// A failed plugin is no longer called.
		const calls = (await readFile(marker, "utf8")).length;
		await beforeRun?.(context);
		expect((await readFile(marker, "utf8")).length).toBe(calls);
		expect(statusEvents.map((event) => event.state)).toContain("degraded");
	}, 30_000);

	it("times out a hook that never resolves and lets the run continue", async () => {
		const path = await write(
			"hanging-hook.mjs",
			`export default {
	name: "hanging-hook",
	manifest: { capabilities: ["hooks"] },
	hooks: { beforeRun: () => new Promise(() => {}) },
};`,
		);
		const session = await load({
			sessionId: "s1",
			pluginPaths: [path],
			hookTimeoutMs: 200,
		});
		await expect(
			session.extensions[0]?.hooks?.beforeRun?.({ snapshot: {} } as never),
		).resolves.toBeUndefined();
		expect(registry.get(path)[0]).toMatchObject({
			state: "degraded",
			timeoutCount: 1,
			lastError: { phase: "hook:beforeRun", timedOut: true },
		});
	}, 30_000);

	it("notifies every session using a plugin when it degrades or fails", async () => {
		const path = await write(
			"flaky-hook.mjs",
			`export default {
	name: "flaky-hook",
	manifest: { capabilities: ["hooks"] },
	hooks: { beforeRun: async () => { throw new Error("flaky"); } },
};`,
		);
		const seen: Array<{ session: string; state: string }> = [];
		const first = await load({
			sessionId: "s1",
			pluginPaths: [path],
			onIssue: (issue) => seen.push({ session: "s1", state: issue.state }),
		});
		await load({
			sessionId: "s2",
			pluginPaths: [path],
			onIssue: (issue) => seen.push({ session: "s2", state: issue.state }),
		});
		const beforeRun = first.extensions[0]?.hooks?.beforeRun;
		for (let attempt = 0; attempt < 3; attempt++) {
			await beforeRun?.({ snapshot: {} } as never);
		}

		// One notice per state change per session, not one per failure.
		expect(seen).toEqual([
			{ session: "s1", state: "degraded" },
			{ session: "s2", state: "degraded" },
			{ session: "s1", state: "failed" },
			{ session: "s2", state: "failed" },
		]);
	}, 30_000);

	it("rejects registrations that need a missing capability", async () => {
		const path = await write(
			"no-rules-capability.mjs",
			`export default {
	name: "no-rules",
	manifest: { capabilities: ["tools"] },
	setup(api) { api.registerRule({ id: "r", content: "x" }); },
};`,
		);
		const session = await load({ sessionId: "s1", pluginPaths: [path] });
		const rules: unknown[] = [];
		await session.extensions[0]?.setup?.(
			{ ...noopApi(), registerRule: (rule) => rules.push(rule) },
			{},
		);
		expect(rules).toEqual([]);
		expect(registry.get(path)[0]?.lastError?.message).toContain(
			'requires the "rules" capability',
		);
	}, 30_000);

	it("reports plugins disabled in settings and paths that could not be resolved", async () => {
		const disabled = await write("off.mjs", toolPlugin("off"));
		const session = await load({
			pluginPaths: [],
			disabledPluginPaths: [disabled],
			discoveryFailures: [
				{ pluginPath: join(root, "missing"), error: new Error("not found") },
			],
		});
		expect(registry.get(disabled)[0]?.state).toBe("disabled");
		expect(registry.get(join(root, "missing"))[0]?.lastError).toMatchObject({
			phase: "discover",
			message: "not found",
		});
		// A session that would have used the settings-disabled plugin is told
		// why it is missing.
		expect(session.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "off", reason: "settings" }),
				expect.objectContaining({ state: "failed", reason: "error" }),
			]),
		);
		const optedOut = await load({
			pluginPaths: [],
			disabledPluginPaths: [disabled],
			policy: { off: { enabled: false } },
		});
		expect(optedOut.issues).toEqual([]);
	}, 30_000);
	it("times out and stops commands, rule content, and message builders", async () => {
		const path = await write(
			"callbacks.mjs",
			`export default {
	name: "callbacks",
	manifest: { capabilities: ["commands", "rules", "messageBuilders"] },
	setup(api) {
		api.registerCommand({ name: "hang", handler: () => new Promise(() => {}) });
		api.registerCommand({ name: "boom", handler: () => { throw new Error("command broke"); } });
		api.registerRule({ id: "slow-rule", content: () => new Promise(() => {}) });
		api.registerMessageBuilder({ name: "bad-builder", build: () => { throw new Error("builder broke"); } });
	},
};`,
		);
		const session = await load({
			sessionId: "s1",
			pluginPaths: [path],
			callTimeoutMs: 200,
		});
		const commands: Array<{
			name: string;
			handler?: (input: string) => unknown;
		}> = [];
		const rules: Array<{ content: unknown }> = [];
		const builders: Array<{ build: (messages: Message[]) => unknown }> = [];
		await session.extensions[0]?.setup?.(
			{
				...noopApi(),
				registerCommand: (command) => commands.push(command),
				registerRule: (rule) => rules.push(rule),
				registerMessageBuilder: (builder) => builders.push(builder),
			},
			{},
		);

		const hang = commands.find((command) => command.name === "hang");
		await expect(hang?.handler?.("")).rejects.toBeInstanceOf(
			PluginCallTimeoutError,
		);
		const content = rules[0]?.content as () => Promise<string>;
		await expect(content()).resolves.toBe("");
		const messages = [{ role: "user", content: "hi" }] as Message[];
		await expect(builders[0]?.build(messages)).resolves.toBe(messages);
		expect(registry.get(path)[0]).toMatchObject({
			state: "failed",
			timeoutCount: 2,
		});

		// Turned off after repeated failures: commands are refused.
		const boom = commands.find((command) => command.name === "boom");
		await expect(boom?.handler?.("")).rejects.toThrow(/is unavailable/);
	}, 30_000);

	it("treats a registration the host rejects as a setup failure", async () => {
		const path = await write(
			"bad-registration.mjs",
			`export default {
	name: "bad-registration",
	manifest: { capabilities: ["tools"] },
	setup(api) {
		api.registerTool({ name: "kept_out", description: "", inputSchema: {}, execute: () => "" });
		api.registerProvider({ name: "rejected" });
	},
};`,
		);
		const told: string[] = [];
		const session = await load({
			sessionId: "s1",
			pluginPaths: [path],
			onIssue: (issue) =>
				told.push(`${issue.state}:${issue.lastError?.message}`),
		});
		await expect(
			session.extensions[0]?.setup?.(
				{
					...noopApi(),
					registerProvider: () => {
						throw new Error("provider rejected by host");
					},
				},
				{},
			),
		).rejects.toThrow("provider rejected by host");
		expect(told).toEqual(["failed:provider rejected by host"]);
		expect(registry.get(path)[0]?.lastError?.phase).toBe("setup");
	}, 30_000);

	it("applies per-session timeout overrides", async () => {
		const path = await write(
			"slow-hook.mjs",
			`export default {
	name: "slow-hook",
	manifest: { capabilities: ["hooks"] },
	hooks: { beforeRun: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 400)) },
};`,
		);
		const hasty = await load({
			sessionId: "hasty",
			pluginPaths: [path],
			hookTimeoutMs: 100,
		});
		await expect(
			hasty.extensions[0]?.hooks?.beforeRun?.({ snapshot: {} } as never),
		).resolves.toBeUndefined();
		expect(registry.get(path)[0]?.timeoutCount).toBe(1);

		const patient = await load({
			sessionId: "patient",
			pluginPaths: [path],
			hookTimeoutMs: 5_000,
		});
		await expect(
			patient.extensions[0]?.hooks?.beforeRun?.({ snapshot: {} } as never),
		).resolves.toEqual({ ok: true });
		expect(registry.get(path)[0]?.timeoutCount).toBe(1);
	}, 30_000);

	it("fails every plugin, and never imports one, when the host ships no bootstrap", async () => {
		const marker = join(root, "imported.txt");
		const path = await write(
			"orphan.mjs",
			`import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(marker)}, "imported");
export default { name: "orphan", manifest: { capabilities: ["tools"] } };`,
		);
		setPluginBootstrapUnavailableForTests(true);
		try {
			const session = await load({ sessionId: "s1", pluginPaths: [path] });
			expect(session.extensions).toHaveLength(0);
			expect(session.issues).toEqual([
				expect.objectContaining({
					name: "orphan",
					state: "failed",
					lastError: expect.objectContaining({
						phase: "import",
						message: expect.stringContaining("CLINE_PLUGIN_BOOTSTRAP_PATH"),
					}),
				}),
			]);
			expect(registry.get("orphan")[0]?.state).toBe("failed");
		} finally {
			setPluginBootstrapUnavailableForTests(false);
		}
		await expect(readFile(marker, "utf8")).rejects.toThrow();
	}, 30_000);

	it("keeps running sessions' copies usable across a reload", async () => {
		const path = await write(
			"stable.mjs",
			toolPlugin("stable", 'return "v1";'),
		);
		const session = await load({ sessionId: "s1", pluginPaths: [path] });
		const [tool] = await toolsOf(session.extensions[0]);
		await write("stable.mjs", toolPlugin("stable", 'return "v2";'));
		await registry.reload("stable");
		expect(registry.get("stable")[0]?.state).toBe("ready");
		// The running session keeps the code it set up with.
		await expect(tool?.execute({}, toolContext)).resolves.toBe("v1");
		const next = await load({ sessionId: "s2", pluginPaths: [path] });
		const [nextTool] = await toolsOf(next.extensions[0]);
		await expect(nextTool?.execute({}, toolContext)).resolves.toBe("v2");
	}, 30_000);
});
