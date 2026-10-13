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
	PluginRegistry,
	type PluginSessionLoadInput,
	type PluginSessionLoadResult,
} from "./plugin-registry";

async function toolsOf(extension: AgentExtension | undefined) {
	const tools: AgentTool[] = [];
	const api = {
		registerTool: (tool: AgentTool) => tools.push(tool),
		registerCommand: () => {},
		registerRule: () => {},
		registerMessageBuilder: () => {},
		registerProvider: () => {},
		registerAutomationEventType: () => {},
		registerMcpServer: () => {},
	} as AgentExtensionApi<AgentTool, Message[]>;
	await extension?.setup?.(api, {});
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

describe("PluginRegistry (worker isolation)", () => {
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
		input: Omit<PluginSessionLoadInput, "isolation">,
	): Promise<PluginSessionLoadResult> => {
		const loaded = await registry.loadForSession({
			...input,
			isolation: "worker",
		});
		sessions.push(loaded);
		return loaded;
	};

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "core-plugin-registry-worker-"));
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
			isolation: "worker",
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
				isolation: "worker",
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
			isolation: "worker",
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
				isolation: "worker",
			});
			expect(hung.extensions).toHaveLength(0);
		} finally {
			delete process.env.HANG_SETUP;
		}
		expect(hangRegistry.get("hang")[0]?.lastError?.phase).toBe("setup");
		const next = await hangRegistry.loadForSession({
			sessionId: "s2",
			pluginPaths: [path],
			isolation: "worker",
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
});
