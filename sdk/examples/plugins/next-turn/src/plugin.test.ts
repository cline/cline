import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, createTool, loadAgentPluginFromPath } from "@cline/core";
import type { ContextSource } from "./context/source";
import { EMPTY_BACKLOG } from "./planner/backlog";
import { LabelLog } from "./planner/labels";
import { NextSession, type OfferedSet } from "./planner/next";
import { createNextTurnPlugin, type SetupContext } from "./plugin";
import {
	type SessionRuntime,
	sessionEnv,
	startSessionRuntime,
} from "./runtime";
import { defaultSettings } from "./settings/settings";

type RuntimeConfig = ConstructorParameters<typeof Agent>[0];
type Model = Extract<RuntimeConfig, { model: unknown }>["model"];

/** Edits one file through a tool on the first call, then answers in text. */
function editingModel(): Model {
	let iteration = 0;
	return {
		async *stream() {
			if (iteration++ === 0) {
				yield {
					type: "tool-call-delta",
					index: 0,
					toolCallId: `call-${iteration}`,
					toolName: "editor",
					input: { path: "src/retry.ts" },
				};
				yield { type: "finish", reason: "tool-calls" };
			} else {
				yield { type: "text-delta", text: "Added the retry." };
				yield { type: "finish", reason: "stop" };
			}
		},
	};
}

const editor = createTool({
	name: "editor",
	description: "A deterministic test fixture; writes nothing.",
	inputSchema: {
		type: "object",
		properties: { path: { type: "string" } },
		additionalProperties: false,
	},
	execute: async () => "ok",
});

const context: SetupContext = {
	session: { sessionId: "sess_1" },
	client: { name: "cline-cli" },
	workspaceInfo: {
		rootPath: "/w",
		latestGitBranchName: "main",
		associatedRemoteUrls: ["git@github.com:o/r.git"],
	},
};

describe("Next Turn as a plugin", () => {
	test("the default export loads through the real SDK loader with its hooks and setup", async () => {
		const plugin = await loadAgentPluginFromPath(`${import.meta.dir}/index.ts`);
		expect(plugin.name).toBe("next-turn");
		expect(plugin.manifest.capabilities).toEqual(["hooks"]);
		expect(Object.keys(plugin.hooks ?? {}).sort()).toEqual([
			"afterRun",
			"beforeModel",
		]);
		expect(typeof plugin.setup).toBe("function");
	});

	test("a real agent run serves a set, and the next message is labelled against it", async () => {
		const labelsPath = join(
			mkdtempSync(join(tmpdir(), "next-turn-plugin-")),
			"labels.jsonl",
		);
		const sets: (OfferedSet | undefined)[] = [];
		let tools: readonly string[] = [];
		const sources: ContextSource[] = [
			{ id: "turn", tier: "T0", probe: () => "present" },
			{ id: "tasks", tier: "T2", probe: () => "present" },
		];
		const next = new NextSession({
			sessionId: "sess_1",
			settings: defaultSettings,
			env: sessionEnv(context, () => tools),
			sources: () => sources,
			backlog: async () => EMPTY_BACKLOG,
			labels: new LabelLog(labelsPath),
		});
		next.onSet((set) => sets.push(set));
		const runtime: SessionRuntime = {
			engine: undefined as never,
			next,
			setTools: (names) => {
				tools = names;
			},
			stop: () => undefined,
		};
		const plugin = createNextTurnPlugin({ startRuntime: () => runtime });
		await plugin.setup?.(
			{} as Parameters<NonNullable<typeof plugin.setup>>[0],
			context,
		);
		const agent = new Agent({
			model: editingModel(),
			tools: [editor],
			hooks: plugin.hooks,
		});
		await agent.run("Add a retry to the client");
		expect(tools).toEqual(["editor"]);
		const served = sets[0];
		expect(served?.cueCode).toBe("completed_edits");
		expect(served?.candidates.map((row) => row.kind)).toEqual([
			"next_step",
			"verify",
			"review_diff",
		]);
		await agent.run(served?.candidates[1]?.prompt ?? "");
		const events = readFileSync(labelsPath, "utf8")
			.trim()
			.split("\n")
			.map((line) => (JSON.parse(line) as { event: string }).event);
		expect(events.slice(0, 3)).toEqual(["offer", "do", "superseded"]);
	});

	test("a starter that throws cannot fail setup, and no runtime starts without a session or a feature", async () => {
		const throwing = createNextTurnPlugin({
			startRuntime: () => {
				throw new Error("boom");
			},
		});
		expect(() =>
			throwing.setup?.(
				{} as Parameters<NonNullable<typeof throwing.setup>>[0],
				context,
			),
		).not.toThrow();
		const off = defaultSettings();
		off.features.next = false;
		off.notify.needsYou = false;
		expect(
			startSessionRuntime({}, { settings: defaultSettings }),
		).toBeUndefined();
		expect(
			startSessionRuntime(context, { settings: () => off }),
		).toBeUndefined();
	});

	test("the session's environment comes from the setup context", () => {
		expect(sessionEnv(context, () => ["editor"])()).toEqual({
			client: "cline-cli",
			sessionId: "sess_1",
			workspaceRoot: "/w",
			cwd: "/w",
			git: {
				branch: "main",
				commit: undefined,
				remotes: ["git@github.com:o/r.git"],
			},
			tools: ["editor"],
		});
		expect(sessionEnv({}, () => [])().git).toBeUndefined();
	});

	test("registers the next UI handler, pushes computing → ready (rules) → ready (model), and stays dormant until viewed when the gate is closed", async () => {
		const labelsPath = join(
			mkdtempSync(join(tmpdir(), "next-turn-slot-")),
			"labels.jsonl",
		);
		const pushes: Array<{ event: string; payload: unknown }> = [];
		let handler: ((input: unknown) => Promise<unknown> | unknown) | undefined;
		const api = {
			registerUiHandler(
				name: string,
				fn: (input: unknown) => Promise<unknown> | unknown,
			) {
				if (name === "next") handler = fn;
			},
		};
		const slotContext = {
			...context,
			client: { name: "cline-desktop" },
			ui: {
				push(event: string, payload: unknown) {
					pushes.push({ event, payload });
				},
			},
		};
		const next = new NextSession({
			sessionId: "sess_1",
			settings: defaultSettings,
			env: sessionEnv(slotContext, () => []),
			sources: () => [
				{ id: "turn", tier: "T0", probe: () => "present" },
				{ id: "tasks", tier: "T2", probe: () => "present" },
			],
			backlog: async () => EMPTY_BACKLOG,
			complete: async () => ({
				text: '{"suggestions":[{"kind":"verify","source":"turn","prompt":"Run bun test on retry.ts.","why":"retry.ts changed"}]}',
				costUsd: 0.001,
				providerId: "cline",
				modelId: "claude-sonnet",
			}),
			labels: new LabelLog(labelsPath),
		});
		const runtime: SessionRuntime = {
			engine: undefined as never,
			next,
			setTools: () => undefined,
			stop: () => undefined,
		};
		const plugin = createNextTurnPlugin({ startRuntime: () => runtime });
		await plugin.setup?.(api as never, slotContext as never);
		expect(handler).toBeDefined();

		const agent = new Agent({
			model: editingModel(),
			tools: [editor],
			hooks: plugin.hooks,
		});
		await agent.run("Add a retry to the client");
		await next.settled();

		expect(
			pushes.map((entry) => (entry.payload as { state: string }).state),
		).toEqual(["computing", "ready", "ready"]);
		const current = (await handler?.({ type: "current" })) as {
			state: string;
			seq: number;
			set?: OfferedSet;
		};
		expect(current.state).toBe("ready");
		expect(current.set?.planner).toBe("model");

		const firstId = current.set?.candidates[0]?.id ?? "";
		const afterSkip = (await handler?.({
			type: "skip",
			candidateId: firstId,
			offerId: current.set?.offerId,
		})) as {
			state: string;
			seq: number;
			set?: OfferedSet;
		};
		expect(afterSkip.seq).toBeGreaterThan(current.seq);
		expect(afterSkip.set?.candidates.map((row) => row.id)).not.toContain(
			firstId,
		);

		const afterUnskip = (await handler?.({
			type: "unskip",
			candidateId: firstId,
			offerId: afterSkip.set?.offerId,
		})) as {
			set?: OfferedSet;
		};
		expect(afterUnskip.set?.candidates.map((row) => row.id)).toContain(firstId);

		await expect(
			Promise.resolve().then(() => handler?.({ type: "unknown_verb" })),
		).rejects.toThrow("invalid NextTurnTrayAction");
	});

	test("dormant gate: without registerUiHandler or on a non-desktop client, Next stays dormant until current is invoked", async () => {
		let activated = 0;
		let dormantRecorded = 0;
		let handler: ((input: unknown) => Promise<unknown> | unknown) | undefined;
		const api = {
			registerUiHandler(
				name: string,
				fn: (input: unknown) => Promise<unknown> | unknown,
			) {
				if (name === "next") handler = fn;
			},
		};
		const next = new NextSession({
			sessionId: "sess_1",
			settings: defaultSettings,
			env: sessionEnv(context, () => []),
			sources: () => [{ id: "turn", tier: "T0", probe: () => "present" }],
			backlog: async () => EMPTY_BACKLOG,
		});
		const runtime: SessionRuntime = {
			engine: undefined as never,
			activateNext: () => {
				activated += 1;
				runtime.next = next;
				return next;
			},
			recordDormantTurn: () => {
				dormantRecorded += 1;
			},
			setTools: () => undefined,
			stop: () => undefined,
		};
		const plugin = createNextTurnPlugin({
			startRuntime: (_ctx, opts) => {
				if (opts?.active) runtime.activateNext?.();
				return runtime;
			},
			isNextActive: (a, c) =>
				typeof a?.registerUiHandler === "function" &&
				c.client?.name === "cline-desktop",
		});
		await plugin.setup?.(api as never, context as never);
		expect(activated).toBe(0);
		const agent = new Agent({
			model: editingModel(),
			tools: [editor],
			hooks: plugin.hooks,
		});
		await agent.run("First turn while dormant");
		expect(dormantRecorded).toBe(1);
		expect(next.current()).toBeUndefined();

		const cur = (await handler?.({
			type: "current",
			client: "cline-desktop",
		})) as { state: string };
		expect(cur.state).toBe("off");
		expect(activated).toBe(1);

		await agent.run("Second turn after viewer attached");
		expect(next.current()?.candidates.length).toBeGreaterThan(0);
	});
});
