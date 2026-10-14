import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, createTool } from "@cline/core";
import type { AgentMessage, AgentRunResult } from "@cline/shared";
import { PluginLifecycle } from "./lifecycle";
import { EMPTY_BACKLOG } from "./planner/backlog";
import { LabelLog } from "./planner/labels";
import { NextSession } from "./planner/next";
import { createNextTurnPlugin, type SetupContext } from "./plugin";
import { type SessionRuntime, sessionEnv } from "./runtime";
import { defaultSettings } from "./settings/settings";
import {
	FileSessionStateStore,
	pruneSessionStates,
} from "./store/session-state";

const temps: string[] = [];
function tempDir(prefix = "next-turn-lifecycle-"): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	temps.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of temps.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

let ids = 0;
function message(role: AgentMessage["role"], text: string): AgentMessage {
	ids += 1;
	return {
		id: `m${ids}`,
		role,
		content: [{ type: "text", text }],
		createdAt: ids,
	};
}

function editRun(request = "Add a retry to the client"): {
	result: AgentRunResult;
	messages: AgentMessage[];
} {
	ids += 1;
	const messages: AgentMessage[] = [
		message("user", request),
		{
			id: `m${ids}`,
			role: "assistant",
			createdAt: ids,
			content: [
				{
					type: "tool-call",
					toolCallId: `c${ids}`,
					toolName: "editor",
					input: { path: "src/client.ts" },
				},
			],
		},
	];
	return {
		messages,
		result: {
			agentId: "a",
			runId: `run_${ids}`,
			status: "completed",
			iterations: 1,
			outputText: "Added the retry.",
			messages,
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		},
	};
}

describe("session state persistence across sandbox respawn (T-plugin-4)", () => {
	test("rehydrates the active offerId, labels the next message once, and skips through the stored pool without a planner call", async () => {
		const dir = tempDir();
		const labelsPath = join(dir, "labels.jsonl");
		const sessionsDir = join(dir, "sessions");
		let plannerCalls = 0;

		const makeSession = () =>
			new NextSession({
				sessionId: "sess_respawn",
				settings: defaultSettings,
				env: () => ({ client: "cline-desktop", tools: [] }),
				sources: () => [{ id: "turn", tier: "T0", probe: () => "present" }],
				backlog: async () => EMPTY_BACKLOG,
				complete: async () => {
					plannerCalls += 1;
					return {
						text: '{"suggestions":[{"kind":"verify","source":"turn","prompt":"Run bun test on client.ts.","why":"client.ts changed"},{"kind":"wrap_up","source":"turn","prompt":"Summarize the client changes.","why":"done"}]}',
					};
				},
				labels: new LabelLog(labelsPath),
				store: new FileSessionStateStore(sessionsDir, "sess_respawn"),
				viewerClient: () => "cline-desktop",
			});

		const first = makeSession();
		const { result, messages } = editRun();
		await first.afterRun(result);
		await first.settled();
		const originalOffer = first.current();
		expect(originalOffer?.planner).toBe("model");
		expect(plannerCalls).toBe(1);

		const respawned = makeSession();
		expect(respawned.current()?.offerId).toBe(originalOffer?.offerId);
		expect(respawned.currentPush().state).toBe("ready");

		const firstCandidate = originalOffer?.candidates[0];
		const afterSkip = await respawned.invoke({
			type: "skip",
			candidateId: firstCandidate?.id ?? "",
			offerId: originalOffer?.offerId,
		});
		expect(plannerCalls).toBe(1);
		expect(afterSkip?.candidates.map((row) => row.id)).not.toContain(
			firstCandidate?.id,
		);

		const secondRespawn = makeSession();
		const remaining = secondRespawn.current()?.candidates[0];
		secondRespawn.outgoing([
			...messages,
			message("user", remaining?.prompt ?? ""),
		]);
		expect(secondRespawn.current()).toBeUndefined();

		const thirdRespawn = makeSession();
		expect(thirdRespawn.current()).toBeUndefined();

		const records = readFileSync(labelsPath, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { event: string });
		expect(records.filter((r) => r.event === "do")).toHaveLength(1);
	});

	test("pruneSessionStates deletes files older than the TTL", () => {
		const dir = tempDir();
		const oldFile = join(dir, "old.json");
		const freshFile = join(dir, "fresh.json");
		writeFileSync(oldFile, "{}\n");
		writeFileSync(freshFile, "{}\n");
		const now = Date.now();
		utimesSync(
			oldFile,
			new Date(now - 20 * 86_400_000),
			new Date(now - 20 * 86_400_000),
		);
		pruneSessionStates(dir, now, 14 * 86_400_000);
		expect(() => readFileSync(oldFile)).toThrow();
		expect(readFileSync(freshFile, "utf8")).toBe("{}\n");
	});
});

describe("plugin lifecycle: disable and uninstall in open chats (T-plugin-16)", () => {
	test("goes quiet when disabledPlugins lists its entry or the package root is removed, and resumes when re-enabled", async () => {
		const dir = tempDir();
		const pkgRoot = join(dir, "pkg");
		const distDir = join(pkgRoot, "dist");
		mkdirSync(distDir, { recursive: true });
		const entryPath = join(distDir, "index.js");
		writeFileSync(
			join(pkgRoot, "package.json"),
			JSON.stringify({ name: "next-turn" }),
		);
		writeFileSync(entryPath, "");

		const settingsPath = join(dir, "global-settings.json");
		writeFileSync(settingsPath, JSON.stringify({ disabledPlugins: [] }));

		const lifecycle = new PluginLifecycle({
			env: { CLINE_GLOBAL_SETTINGS_PATH: settingsPath },
			packageRoot: pkgRoot,
			entryPaths: [entryPath],
		});
		expect(lifecycle.active()).toBe(true);

		const labelsPath = join(dir, "labels.jsonl");
		let plannerCalls = 0;
		const pushes: Array<{ state: string }> = [];
		const context: SetupContext = {
			session: { sessionId: "sess_life" },
			client: { name: "cline-desktop" },
			workspaceInfo: { rootPath: dir },
		};
		const next = new NextSession({
			sessionId: "sess_life",
			settings: defaultSettings,
			env: sessionEnv(context, () => []),
			sources: () => [{ id: "turn", tier: "T0", probe: () => "present" }],
			backlog: async () => EMPTY_BACKLOG,
			complete: async () => {
				plannerCalls += 1;
				return {
					text: '{"suggestions":[{"kind":"verify","source":"turn","prompt":"Run tests.","why":"changed"}]}',
				};
			},
			labels: new LabelLog(labelsPath),
		});
		const runtime: SessionRuntime = {
			engine: undefined as never,
			next,
			setTools: () => undefined,
			stop: () => undefined,
		};
		let handler: ((input: unknown) => Promise<unknown> | unknown) | undefined;
		const plugin = createNextTurnPlugin({
			startRuntime: () => runtime,
			lifecycle,
		});
		await plugin.setup?.(
			{
				registerUiHandler(
					name: string,
					fn: (input: unknown) => Promise<unknown> | unknown,
				) {
					if (name === "next") handler = fn;
				},
			} as never,
			{
				...context,
				ui: {
					push(_event: string, payload: unknown) {
						pushes.push(payload as { state: string });
					},
				},
			} as never,
		);

		writeFileSync(
			settingsPath,
			JSON.stringify({ disabledPlugins: [entryPath] }),
		);
		utimesSync(settingsPath, new Date(), new Date(Date.now() + 2_000));
		lifecycle.invalidate();

		const editor = createTool({
			name: "editor",
			description: "noop",
			inputSchema: { type: "object", properties: {} },
			execute: async () => "ok",
		});
		const model = {
			async *stream() {
				yield { type: "text-delta" as const, text: "Done." };
				yield { type: "finish" as const, reason: "stop" as const };
			},
		};
		const agent = new Agent({ model, tools: [editor], hooks: plugin.hooks });
		await agent.run("Turn while disabled");
		await next.settled();

		expect(plannerCalls).toBe(0);
		expect(() => readFileSync(labelsPath)).toThrow();
		expect(pushes.map((p) => p.state)).toEqual(["off"]);
		expect(await handler?.({ type: "current" })).toMatchObject({
			state: "off",
		});

		writeFileSync(settingsPath, JSON.stringify({ disabledPlugins: [] }));
		utimesSync(settingsPath, new Date(), new Date(Date.now() + 5_000));
		lifecycle.invalidate();

		await agent.run("Turn after re-enabling");
		await next.settled();
		expect(plannerCalls).toBe(1);
		expect(next.current()?.candidates.length).toBeGreaterThan(0);

		rmSync(pkgRoot, { recursive: true, force: true });
		expect(lifecycle.active()).toBe(false);
	});
});
