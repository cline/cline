import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentExtension,
	AgentExtensionApi,
	AgentTool,
	AgentToolContext,
	Message,
	PluginStatusRecord,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PluginCallTimeoutError, PluginRegistry } from "./plugin-registry";

type Collected = { tools: AgentTool[]; rules: unknown[] };

function collectingApi(): {
	api: AgentExtensionApi<AgentTool, Message[]>;
	collected: Collected;
} {
	const collected: Collected = { tools: [], rules: [] };
	return {
		collected,
		api: {
			registerTool: (tool) => collected.tools.push(tool),
			registerCommand: () => {},
			registerRule: (rule) => collected.rules.push(rule),
			registerMessageBuilder: () => {},
			registerProvider: () => {},
			registerAutomationEventType: () => {},
			registerMcpServer: () => {},
		},
	};
}

async function setUp(
	extension: AgentExtension | undefined,
): Promise<Collected> {
	const { api, collected } = collectingApi();
	await extension?.setup?.(api, {});
	return collected;
}

const toolContext: AgentToolContext = { agentId: "agent", iteration: 1 };

function toolPlugin(name: string, toolName = `${name}_tool`): string {
	return `export default {
	name: ${JSON.stringify(name)},
	manifest: { capabilities: ["tools"] },
	setup(api) {
		api.registerTool({
			name: ${JSON.stringify(toolName)},
			description: "test tool",
			inputSchema: { type: "object" },
			execute: async () => "ok from ${name}",
		});
	},
};
`;
}

describe("PluginRegistry", () => {
	let root: string;
	let registry: PluginRegistry;
	let statusEvents: PluginStatusRecord[];

	const write = async (file: string, source: string) => {
		const path = join(root, file);
		await writeFile(path, source, "utf8");
		return path;
	};

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "core-plugin-registry-"));
		registry = new PluginRegistry({
			hookTimeoutMs: 100,
			toolTimeoutMs: 100,
			setupTimeoutMs: 500,
			failureThreshold: 3,
		});
		statusEvents = [];
		registry.subscribe((status) => statusEvents.push(status));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("loads a plugin once and reports it ready with its sessions", async () => {
		const path = await write("good.js", toolPlugin("good"));
		const first = await registry.loadForSession({
			sessionId: "s1",
			pluginPaths: [path],
		});
		const second = await registry.loadForSession({
			sessionId: "s2",
			pluginPaths: [path],
		});

		const collected = await setUp(first.extensions[0]);
		expect(collected.tools.map((tool) => tool.name)).toEqual(["good_tool"]);
		await expect(collected.tools[0]?.execute({}, toolContext)).resolves.toBe(
			"ok from good",
		);
		expect(second.extensions).toHaveLength(1);

		const [status] = registry.list();
		expect(status).toMatchObject({
			name: "good",
			state: "ready",
			errorCount: 0,
			sessionIds: ["s1", "s2"],
		});
		expect(statusEvents.map((event) => event.state)).toEqual([
			"loading",
			"ready",
		]);

		first.release();
		expect(registry.list()[0]?.sessionIds).toEqual(["s2"]);
	});

	it("marks a plugin that throws on import failed and keeps the others", async () => {
		const good = await write("good.js", toolPlugin("good"));
		const broken = await write(
			"throws-on-import.js",
			`throw new Error("import exploded");\nexport default {};\n`,
		);

		const loaded = await registry.loadForSession({
			sessionId: "s1",
			pluginPaths: [broken, good],
		});

		expect(loaded.extensions.map((extension) => extension.name)).toEqual([
			"good",
		]);
		const status = registry.get(broken)[0];
		expect(status?.state).toBe("failed");
		expect(status?.lastError?.phase).toBe("import");
		expect(status?.lastError?.message).toContain("import exploded");
		expect(loaded.failures).toEqual([
			expect.objectContaining({ pluginPath: broken, phase: "load" }),
		]);
		expect(loaded.issues).toEqual([
			expect.objectContaining({
				pluginPath: broken,
				state: "failed",
				reason: "error",
			}),
		]);
	});

	it("marks a plugin that throws in setup failed without partial registrations", async () => {
		const good = await write("good.js", toolPlugin("good"));
		const broken = await write(
			"throws-in-setup.js",
			`export default {
	name: "throws-in-setup",
	manifest: { capabilities: ["tools"] },
	setup(api) {
		api.registerTool({ name: "half", description: "", inputSchema: {}, execute: () => "" });
		throw new Error("setup exploded");
	},
};
`,
		);

		const loaded = await registry.loadForSession({
			sessionId: "s1",
			pluginPaths: [broken, good],
		});
		const [brokenExtension, goodExtension] = loaded.extensions;
		expect((await setUp(brokenExtension)).tools).toEqual([]);
		expect((await setUp(goodExtension)).tools).toHaveLength(1);

		const status = registry.get("throws-in-setup")[0];
		expect(status?.state).toBe("failed");
		expect(status?.lastError).toMatchObject({
			phase: "setup",
			message: "setup exploded",
			sessionId: "s1",
		});

		// Setup failure is per session: the next session gets a fresh copy,
		// tries again, and is told about its own failure.
		const told: string[] = [];
		const next = await registry.loadForSession({
			sessionId: "s2",
			pluginPaths: [broken, good],
			onIssue: (issue) => told.push(`${issue.name}:${issue.state}`),
		});
		expect(next.extensions.map((extension) => extension.name)).toEqual([
			"throws-in-setup",
			"good",
		]);
		expect((await setUp(next.extensions[0])).tools).toEqual([]);
		expect(told).toEqual(["throws-in-setup:failed"]);
	});

	it("gives each session its own copy of the plugin module", async () => {
		// Plugins written for the per-session sandbox build one plugin object
		// per import and refuse a second setup().
		const path = await write(
			"one-setup-per-module.js",
			`let setupDone = false;
export default {
	name: "one-setup",
	manifest: { capabilities: ["tools"] },
	setup(api, ctx) {
		if (setupDone) throw new Error("Create a separate handle for each session");
		setupDone = true;
		const owner = ctx.session?.sessionId;
		api.registerTool({ name: "owner", description: "", inputSchema: {}, execute: () => owner });
	},
};
`,
		);
		const tools: AgentTool[] = [];
		for (const sessionId of ["s1", "s2", "s3"]) {
			const loaded = await registry.loadForSession({
				sessionId,
				pluginPaths: [path],
				setupContext: { session: { sessionId } },
			});
			tools.push(...(await setUp(loaded.extensions[0])).tools);
		}

		expect(registry.get(path)[0]).toMatchObject({
			state: "ready",
			errorCount: 0,
			sessionIds: ["s1", "s2", "s3"],
		});
		await expect(
			Promise.all(tools.map((tool) => tool.execute({}, toolContext))),
		).resolves.toEqual(["s1", "s2", "s3"]);
	});

	it("keeps other sessions working when one session's setup fails", async () => {
		const path = await write(
			"session-picky.js",
			`export default {
	name: "session-picky",
	manifest: { capabilities: ["tools"] },
	setup(api, ctx) {
		if (ctx.session?.sessionId === "bad") throw new Error("not for this session");
		api.registerTool({ name: "picky", description: "", inputSchema: {}, execute: () => "ok" });
	},
};
`,
		);
		const told: string[] = [];
		const load = (sessionId: string) =>
			registry.loadForSession({
				sessionId,
				pluginPaths: [path],
				setupContext: { session: { sessionId } },
				onIssue: (issue) => told.push(`${sessionId}:${issue.state}`),
			});
		const [tool] = (await setUp((await load("good")).extensions[0])).tools;
		await setUp((await load("bad")).extensions[0]);
		expect(registry.get(path)[0]?.lastError?.phase).toBe("setup");
		// Only the session whose setup failed is told; "good" still works.
		expect(told).toEqual(["bad:failed"]);

		await expect(tool?.execute({}, toolContext)).resolves.toBe("ok");
		const later = await setUp((await load("later")).extensions[0]);
		expect(later.tools).toHaveLength(1);
		expect(registry.get(path)[0]?.state).toBe("ready");
	});

	it("notifies every session using a plugin when it degrades or fails", async () => {
		const path = await write(
			"flaky-hook.js",
			`export default {
	name: "flaky-hook",
	manifest: { capabilities: ["hooks"] },
	hooks: { beforeRun: async () => { throw new Error("flaky"); } },
};
`,
		);
		const seen: Array<{ session: string; state: string }> = [];
		const first = await registry.loadForSession({
			sessionId: "s1",
			pluginPaths: [path],
			onIssue: (issue) => seen.push({ session: "s1", state: issue.state }),
		});
		await registry.loadForSession({
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
	});

	it("rejects registrations that need a missing capability", async () => {
		const path = await write(
			"no-rules-capability.js",
			`export default {
	name: "no-rules",
	manifest: { capabilities: ["tools"] },
	setup(api) { api.registerRule({ id: "r", content: "x" }); },
};
`,
		);
		const loaded = await registry.loadForSession({ pluginPaths: [path] });
		expect((await setUp(loaded.extensions[0])).rules).toEqual([]);
		expect(registry.get(path)[0]?.lastError?.message).toContain(
			'requires the "rules" capability',
		);
	});

	it("records a rejecting hook, follows hookErrorMode, and stops after repeated failures", async () => {
		const path = await write(
			"rejecting-hook.js",
			`export default {
	name: "rejecting-hook",
	manifest: { capabilities: ["hooks"] },
	hooks: {
		async beforeRun() {
			globalThis.__rejectingHookCalls = (globalThis.__rejectingHookCalls ?? 0) + 1;
			throw new Error("hook rejected");
		},
	},
};
`,
		);
		const ignore = await registry.loadForSession({
			sessionId: "s1",
			pluginPaths: [path],
		});
		const strict = await registry.loadForSession({
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
		const hookCalls = () =>
			(globalThis as unknown as Record<string, number>).__rejectingHookCalls;
		const calls = hookCalls();
		await beforeRun?.(context);
		expect(hookCalls()).toBe(calls);
		expect(statusEvents.map((event) => event.state)).toContain("degraded");
	});

	it("times out a hook that never resolves and lets the run continue", async () => {
		const path = await write(
			"hanging-hook.js",
			`export default {
	name: "hanging-hook",
	manifest: { capabilities: ["hooks"] },
	hooks: { beforeRun: () => new Promise(() => {}) },
};
`,
		);
		const loaded = await registry.loadForSession({
			sessionId: "s1",
			pluginPaths: [path],
		});
		await expect(
			loaded.extensions[0]?.hooks?.beforeRun?.({ snapshot: {} } as never),
		).resolves.toBeUndefined();
		expect(registry.get(path)[0]).toMatchObject({
			state: "degraded",
			timeoutCount: 1,
			lastError: { phase: "hook:beforeRun", timedOut: true },
		});
	});

	it("returns tool failures to the model and blocks tools of failed plugins", async () => {
		const path = await write(
			"bad-tools.js",
			`export default {
	name: "bad-tools",
	manifest: { capabilities: ["tools"] },
	setup(api) {
		api.registerTool({ name: "throws", description: "", inputSchema: {}, execute: () => { throw new Error("tool broke"); } });
		api.registerTool({ name: "hangs", description: "", inputSchema: {}, execute: () => new Promise(() => {}) });
	},
};
`,
		);
		const loaded = await registry.loadForSession({
			sessionId: "s1",
			pluginPaths: [path],
		});
		const [throws, hangs] = (await setUp(loaded.extensions[0])).tools;

		await expect(throws?.execute({}, toolContext)).rejects.toThrow(
			"tool broke",
		);
		expect(registry.get(path)[0]?.lastError?.phase).toBe("tool:throws");
		await expect(hangs?.execute({}, toolContext)).rejects.toBeInstanceOf(
			PluginCallTimeoutError,
		);
		expect(registry.get(path)[0]?.timeoutCount).toBe(1);
		await expect(throws?.execute({}, toolContext)).rejects.toThrow();
		expect(registry.get(path)[0]?.state).toBe("failed");
		await expect(throws?.execute({}, toolContext)).rejects.toThrow(
			/bad-tools" tool "throws" is unavailable/,
		);
	});

	it("gives each session only the plugins its policy enables", async () => {
		const alpha = await write("alpha.js", toolPlugin("alpha"));
		const beta = await write("beta.js", toolPlugin("beta"));
		const onlyAlpha = await registry.loadForSession({
			sessionId: "s1",
			pluginPaths: [alpha, beta],
			policy: { "*": { enabled: false }, alpha: { enabled: true } },
		});
		const noAlpha = await registry.loadForSession({
			sessionId: "s2",
			pluginPaths: [alpha, beta],
			policy: { alpha: { enabled: false } },
		});

		expect(onlyAlpha.extensions.map((extension) => extension.name)).toEqual([
			"alpha",
		]);
		expect(noAlpha.extensions.map((extension) => extension.name)).toEqual([
			"beta",
		]);
		expect(noAlpha.issues).toEqual([
			expect.objectContaining({
				name: "alpha",
				state: "disabled",
				reason: "session_policy",
			}),
		]);
		expect(registry.get("alpha")[0]?.sessionIds).toEqual(["s1"]);

		// A broken plugin the session turned off is reported as disabled.
		const broken = await write("broken.js", `throw new Error("x");`);
		const off = await registry.loadForSession({
			sessionId: "s3",
			pluginPaths: [broken],
			policy: { "*": { enabled: false } },
		});
		expect(off.failures).toEqual([]);
		expect(off.issues).toEqual([
			expect.objectContaining({ name: "broken", state: "disabled" }),
		]);
		expect(registry.get("beta")[0]?.sessionIds).toEqual(["s2"]);
	});

	it("reports plugins disabled in settings and paths that could not be resolved", async () => {
		const disabled = await write("off.js", toolPlugin("off"));
		const loaded = await registry.loadForSession({
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
		expect(loaded.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "off", reason: "settings" }),
				expect.objectContaining({ state: "failed", reason: "error" }),
			]),
		);
		const optedOut = await registry.loadForSession({
			pluginPaths: [],
			disabledPluginPaths: [disabled],
			policy: { off: { enabled: false } },
		});
		expect(optedOut.issues).toEqual([]);
	});

	it("attributes a stray error to the plugin whose file is in its stack", async () => {
		const path = await write(
			"stray.js",
			`export function makeError() { return new Error("stray rejection"); }
export default { name: "stray", manifest: { capabilities: ["tools"] } };
`,
		);
		const other = await write("other.js", toolPlugin("other"));
		await registry.loadForSession({ pluginPaths: [path, other] });

		const { importPluginModule } = await import("./plugin-module-import");
		const module = await importPluginModule(path, { useCache: false });
		const error = (module.makeError as () => Error)();

		expect(registry.attributeUncaughtError(new Error("hub bug"))).toBe(
			undefined,
		);
		const status = registry.attributeUncaughtError(error, "unhandledRejection");
		expect(status).toMatchObject({
			name: "stray",
			state: "failed",
			lastError: {
				phase: "uncaught",
				message: "unhandledRejection: stray rejection",
			},
		});
		expect(registry.get(other)[0]?.state).toBe("ready");
	});

	it("reloads a plugin after it is fixed", async () => {
		const path = await write(
			"fixable.js",
			`throw new Error("not yet");\nexport default {};\n`,
		);
		await registry.loadForSession({ pluginPaths: [path] });
		expect(registry.get(path)[0]?.state).toBe("failed");

		await writeFile(path, toolPlugin("fixable"), "utf8");
		const [status] = await registry.reload(path);
		expect(status).toMatchObject({
			name: "fixable",
			state: "ready",
			errorCount: 0,
		});
		expect(status?.lastError).toBeUndefined();
		const loaded = await registry.loadForSession({ pluginPaths: [path] });
		expect(loaded.extensions).toHaveLength(1);
	});

	it("passes cwd, session id, and emitEvent to setup, tools, and the legacy host shim", async () => {
		const path = await write(
			"context.js",
			`export default {
	name: "context",
	manifest: { capabilities: ["tools"] },
	setup(api, ctx) {
		globalThis.__contextPluginSetup = { cwd: ctx.cwd, sessionId: ctx.session?.sessionId };
		ctx.emitEvent?.("from_setup", { ok: true });
		api.registerTool({
			name: "ctx_tool",
			description: "",
			inputSchema: {},
			execute: async (_input, context) => {
				globalThis.__clinePluginHost?.emitEvent?.("from_shim", { cwd: context.cwd });
				return context.cwd;
			},
		});
	},
};
`,
		);
		const events: Array<{ name: string; payload?: unknown }> = [];
		const loaded = await registry.loadForSession({
			sessionId: "s1",
			pluginPaths: [path],
			cwd: "/work/project",
			setupContext: { session: { sessionId: "s1" } },
			emitEvent: (event) => events.push(event),
		});
		const [tool] = (await setUp(loaded.extensions[0])).tools;
		await expect(tool?.execute({}, toolContext)).resolves.toBe("/work/project");

		expect(
			(globalThis as Record<string, unknown>).__contextPluginSetup,
		).toEqual({ cwd: "/work/project", sessionId: "s1" });
		expect(events).toEqual([
			{ name: "from_setup", payload: { ok: true } },
			{ name: "from_shim", payload: { cwd: "/work/project" } },
		]);
	});

	it("keeps running sessions' copies usable across a reload", async () => {
		const path = await write("versioned.js", toolPlugin("versioned"));
		const before = await registry.loadForSession({
			sessionId: "old",
			pluginPaths: [path],
		});
		const [oldTool] = (await setUp(before.extensions[0])).tools;

		await writeFile(path, toolPlugin("versioned", "versioned_v2"), "utf8");
		await registry.reload(path);
		const after = await registry.loadForSession({
			sessionId: "new",
			pluginPaths: [path],
		});
		const [newTool] = (await setUp(after.extensions[0])).tools;

		await expect(oldTool?.execute({}, toolContext)).resolves.toBe(
			"ok from versioned",
		);
		expect(newTool?.name).toBe("versioned_v2");
		expect(registry.get(path)[0]?.sessionIds).toEqual(["new", "old"]);
	});

	it("does not let a broken reload turn off copies that still work", async () => {
		const path = await write("break-on-reload.js", toolPlugin("breaks"));
		const running = await registry.loadForSession({
			sessionId: "running",
			pluginPaths: [path],
		});
		const [tool] = (await setUp(running.extensions[0])).tools;

		await writeFile(path, `throw new Error("bad edit");`, "utf8");
		const [status] = await registry.reload(path);
		expect(status?.state).toBe("failed");
		await expect(tool?.execute({}, toolContext)).resolves.toBe(
			"ok from breaks",
		);
	});

	it("times out and stops commands, rule content, and message builders", async () => {
		const path = await write(
			"callbacks.js",
			`export default {
	name: "callbacks",
	manifest: { capabilities: ["commands", "rules", "messageBuilders"] },
	setup(api) {
		api.registerCommand({ name: "hang", handler: () => new Promise(() => {}) });
		api.registerCommand({ name: "boom", handler: () => { throw new Error("command broke"); } });
		api.registerRule({ id: "slow-rule", content: () => new Promise(() => {}) });
		api.registerMessageBuilder({ name: "bad-builder", build: () => { throw new Error("builder broke"); } });
	},
};
`,
		);
		const loaded = await registry.loadForSession({
			sessionId: "s1",
			pluginPaths: [path],
			callTimeoutMs: 50,
		});
		const commands: Array<{
			name: string;
			handler?: (input: string) => unknown;
		}> = [];
		const rules: Array<{ content: unknown }> = [];
		const builders: Array<{ build: (messages: Message[]) => unknown }> = [];
		await loaded.extensions[0]?.setup?.(
			{
				...collectingApi().api,
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
	});

	it("runs onDispose cleanup and clears the copy's timers when the session ends", async () => {
		const path = await write(
			"timers.js",
			`globalThis.__timerTicks = 0;
setInterval(() => { globalThis.__timerTicks++; }, 5);
export default {
	name: "timers",
	manifest: { capabilities: ["tools"] },
	setup(api, ctx) {
		setInterval(() => { globalThis.__timerTicks++; }, 5);
		ctx.onDispose?.(() => { globalThis.__disposedSession = ctx.session?.sessionId; });
	},
};
`,
		);
		const loaded = await registry.loadForSession({
			sessionId: "s1",
			pluginPaths: [path],
			setupContext: { session: { sessionId: "s1" } },
		});
		await setUp(loaded.extensions[0]);
		await new Promise((resolve) => setTimeout(resolve, 30));
		const globals = globalThis as unknown as Record<string, unknown>;
		expect(globals.__timerTicks).toBeGreaterThan(0);

		await loaded.release();
		const ticks = globals.__timerTicks;
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(globals.__timerTicks).toBe(ticks);
		expect(globals.__disposedSession).toBe("s1");
	});

	it("does not track timers the host creates for a plugin", async () => {
		const path = await write(
			"host-callback.js",
			`export default {
	name: "host-callback",
	manifest: { capabilities: ["tools"] },
	setup(_api, ctx) { ctx.emitEvent?.("start_host_timer"); },
};
`,
		);
		let hostTimerFired = false;
		const loaded = await registry.loadForSession({
			sessionId: "s1",
			pluginPaths: [path],
			emitEvent: () => {
				setTimeout(() => {
					hostTimerFired = true;
				}, 20);
			},
		});
		await setUp(loaded.extensions[0]);
		await loaded.release();
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(hostTimerFired).toBe(true);
	});

	it("treats a registration the host rejects as a setup failure", async () => {
		const path = await write(
			"bad-registration.js",
			`export default {
	name: "bad-registration",
	manifest: { capabilities: ["tools"] },
	setup(api) {
		api.registerTool({ name: "kept_out", description: "", inputSchema: {}, execute: () => "" });
		api.registerProvider({ name: "rejected" });
	},
};
`,
		);
		const told: string[] = [];
		const loaded = await registry.loadForSession({
			sessionId: "s1",
			pluginPaths: [path],
			onIssue: (issue) =>
				told.push(`${issue.state}:${issue.lastError?.message}`),
		});
		const { api } = collectingApi();
		await expect(
			loaded.extensions[0]?.setup?.(
				{
					...api,
					registerProvider: () => {
						throw new Error("provider rejected by host");
					},
				},
				{},
			),
		).rejects.toThrow("provider rejected by host");
		expect(told).toEqual(["failed:provider rejected by host"]);
		expect(registry.get(path)[0]?.lastError?.phase).toBe("setup");

		const invalid = await write(
			"bad-event-type.js",
			`export default {
	name: "bad-event-type",
	manifest: { capabilities: ["automationEvents"] },
	setup(api) { api.registerAutomationEventType({ eventType: "", source: "x" }); },
};
`,
		);
		const second = await registry.loadForSession({ pluginPaths: [invalid] });
		await setUp(second.extensions[0]);
		expect(registry.get(invalid)[0]?.lastError).toMatchObject({
			phase: "setup",
			message: "registerAutomationEventType requires an eventType",
		});
	});

	it("applies per-session timeout overrides", async () => {
		const path = await write(
			"slow-hook.js",
			`export default {
	name: "slow-hook",
	manifest: { capabilities: ["hooks"] },
	hooks: { beforeRun: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 150)) },
};
`,
		);
		const patient = await registry.loadForSession({
			sessionId: "patient",
			pluginPaths: [path],
			hookTimeoutMs: 1_000,
		});
		await expect(
			patient.extensions[0]?.hooks?.beforeRun?.({ snapshot: {} } as never),
		).resolves.toEqual({ ok: true });
		expect(registry.get(path)[0]?.timeoutCount).toBe(0);
	});

	it("keeps the module copy imported by preload for the first session", async () => {
		const path = await write(
			"counted.js",
			`globalThis.__countedImports = (globalThis.__countedImports ?? 0) + 1;
export default { name: "counted", manifest: { capabilities: ["tools"] } };
`,
		);
		const globals = globalThis as unknown as Record<string, number>;
		globals.__countedImports = 0;
		await registry.preload({ pluginPaths: [path] });
		expect(globals.__countedImports).toBe(1);
		await registry.loadForSession({ sessionId: "first", pluginPaths: [path] });
		expect(globals.__countedImports).toBe(1);
		await registry.loadForSession({ sessionId: "second", pluginPaths: [path] });
		expect(globals.__countedImports).toBe(2);
	});

	it("keeps the runtime's this for timer callbacks and the plugin's this for its methods", async () => {
		const path = await write(
			"this-binding.js",
			`export default {
	name: "this-binding",
	label: "plugin-object",
	manifest: { capabilities: ["commands", "rules", "messageBuilders"] },
	setup(api) {
		globalThis.__setupThis = this?.label;
		const handle = setTimeout(function () {
			globalThis.__timerThisIsHandle = this === handle;
		}, 1);
		api.registerRule({ id: "self-rule", content() { return this.id; } });
		api.registerCommand({ name: "who", handler(input) { return this.name + ":" + input; } });
		api.registerMessageBuilder({ name: "tagger", build(messages) { return [...messages, { role: "user", content: this.name }]; } });
	},
};
`,
		);
		const loaded = await registry.loadForSession({
			sessionId: "s1",
			pluginPaths: [path],
		});
		const rules: Array<{ content: unknown }> = [];
		const commands: Array<{ handler?: (input: string) => unknown }> = [];
		const builders: Array<{ build: (messages: Message[]) => unknown }> = [];
		await loaded.extensions[0]?.setup?.(
			{
				...collectingApi().api,
				registerRule: (rule) => rules.push(rule),
				registerCommand: (command) => commands.push(command),
				registerMessageBuilder: (builder) => builders.push(builder),
			},
			{},
		);
		await new Promise((resolve) => setTimeout(resolve, 20));
		const globals = globalThis as unknown as Record<string, unknown>;

		expect(globals.__setupThis).toBe("plugin-object");
		expect(globals.__timerThisIsHandle).toBe(true);
		await expect((rules[0]?.content as () => Promise<string>)()).resolves.toBe(
			"self-rule",
		);
		await expect(commands[0]?.handler?.("me")).resolves.toBe("who:me");
		await expect(builders[0]?.build([])).resolves.toEqual([
			{ role: "user", content: "tagger" },
		]);
		expect(registry.get(path)[0]?.errorCount).toBe(0);
	});

	it("routes events from work the module started at import to the session that claimed it", async () => {
		const path = await write(
			"import-time-work.js",
			`setTimeout(() => {
	globalThis.__clinePluginHost?.emitEvent?.("steer_message", { prompt: "from import" });
}, 40);
export default { name: "import-time-work", manifest: { capabilities: ["tools"] } };
`,
		);
		const events: Array<{ name: string; payload?: unknown }> = [];
		await registry.loadForSession({
			sessionId: "claimer",
			pluginPaths: [path],
			emitEvent: (event) => events.push(event),
		});
		await new Promise((resolve) => setTimeout(resolve, 80));
		expect(events).toEqual([
			{ name: "steer_message", payload: { prompt: "from import" } },
		]);
	});

	it("tells an older generation's sessions about its first failure after a reload", async () => {
		const path = await write(
			"old-hook.js",
			`export default {
	name: "old-hook",
	manifest: { capabilities: ["hooks"] },
	hooks: { beforeRun: async () => { throw new Error("old copy broke"); } },
};
`,
		);
		const told: string[] = [];
		const old = await registry.loadForSession({
			sessionId: "old",
			pluginPaths: [path],
			onIssue: (issue) =>
				told.push(`${issue.state}:${issue.lastError?.message}`),
		});
		await writeFile(path, toolPlugin("old-hook"), "utf8");
		await registry.reload(path);

		await old.extensions[0]?.hooks?.beforeRun?.({ snapshot: {} } as never);

		expect(told).toEqual(["degraded:old copy broke"]);
		// Status still describes the reloaded generation.
		expect(registry.get(path)[0]?.state).toBe("ready");
	});

	it("gives new sessions changes made outside the entry file, and only new sessions", async () => {
		const helper = await write(
			"helper.js",
			`export const toolName = "helper_v1";\n`,
		);
		const path = await write(
			"uses-helper.js",
			`import { toolName } from "./helper.js";
export default {
	name: "uses-helper",
	manifest: { capabilities: ["tools"] },
	setup(api) {
		api.registerTool({ name: toolName, description: "", inputSchema: {}, execute: () => toolName });
	},
};
`,
		);
		const before = await registry.loadForSession({
			sessionId: "before",
			pluginPaths: [path],
		});
		// Leaves an imported copy waiting for the next session to claim.
		await registry.reload(path);
		// Same length as before, written immediately, and only in a file the
		// entry imports: the waiting copy is now stale.
		await writeFile(helper, `export const toolName = "helper_v2";\n`, "utf8");
		const after = await registry.loadForSession({
			sessionId: "after",
			pluginPaths: [path],
		});

		expect(
			(await setUp(before.extensions[0])).tools.map((t) => t.name),
		).toEqual(["helper_v1"]);
		expect((await setUp(after.extensions[0])).tools.map((t) => t.name)).toEqual(
			["helper_v2"],
		);
	});

	it("retries a plugin after a fix to a file it imports only for side effects", async () => {
		await write("side-effect.js", `throw new Error("helper broken");\n`);
		const path = await write(
			"side-effect-entry.js",
			`import "./side-effect.js";
export default { name: "side-effect-entry", manifest: { capabilities: ["tools"] } };
`,
		);
		const broken = await registry.loadForSession({ pluginPaths: [path] });
		expect(broken.extensions).toEqual([]);
		expect(registry.get(path)[0]).toMatchObject({
			state: "failed",
			lastError: { phase: "import" },
		});

		// Text that merely looks like an import inside a string must not be
		// treated as one when loading.
		const prose = await write(
			"prose.js",
			`export default { name: "prose", note: 'run import "x" first', manifest: { capabilities: ["tools"] } };\n`,
		);
		const proseLoaded = await registry.loadForSession({ pluginPaths: [prose] });
		expect(proseLoaded.extensions.map((extension) => extension.name)).toEqual([
			"prose",
		]);

		// Fix only the helper; the entry file is untouched.
		await write("side-effect.js", `globalThis.__sideEffectRan = true;\n`);
		const fixed = await registry.loadForSession({ pluginPaths: [path] });
		expect(fixed.extensions.map((extension) => extension.name)).toEqual([
			"side-effect-entry",
		]);
		expect(registry.get(path)[0]?.state).toBe("ready");
	});
});
