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
		const load = (sessionId: string) =>
			registry.loadForSession({
				sessionId,
				pluginPaths: [path],
				setupContext: { session: { sessionId } },
			});
		const [tool] = (await setUp((await load("good")).extensions[0])).tools;
		await setUp((await load("bad")).extensions[0]);
		expect(registry.get(path)[0]?.lastError?.phase).toBe("setup");

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
			/bad-tools" is failed; tool "throws" is unavailable/,
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
		expect(loaded.issues).toHaveLength(1);
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
});
