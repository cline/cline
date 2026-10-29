import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRuntimeHooks } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyPersonalProfile } from "./chat-profile";
import {
	DurablePersonalRuntimeHost,
	type PersonalRuntimeState,
} from "./durable-runtime-host";
import { LocalRuntimeHost } from "./local-runtime-host";
import type { StartSessionInput } from "./runtime-host";

const dirs: string[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	for (const dir of dirs.splice(0))
		await rm(dir, { recursive: true, force: true });
});
async function fixture(initial?: PersonalRuntimeState) {
	const cwd = await mkdtemp(join(tmpdir(), "durable-host-test-"));
	dirs.push(cwd);
	const saved: PersonalRuntimeState[] = [];
	let fail = false;
	let hooks: AgentRuntimeHooks = {};
	vi.spyOn(
		LocalRuntimeHost.prototype,
		"readSessionCompactionState",
	).mockResolvedValue(undefined);
	vi.spyOn(LocalRuntimeHost.prototype, "startSession").mockImplementation(
		async (input) => {
			hooks = input.localRuntime!.hooks!;
			return { sessionId: "task" } as never;
		},
	);
	const host = new DurablePersonalRuntimeHost({
		sessionId: "task",
		sessionService: {} as never,
		stateStore: {
			load: async () => ({ revision: 0, state: initial ?? null }),
			save: async (revision, state) => {
				if (fail) throw Error("store unavailable");
				saved.push(structuredClone(state));
				return revision + 1;
			},
		},
	});
	await host.startSession({
		config: {
			sessionId: "task",
			providerId: "cline",
			modelId: "fixture",
			cwd,
			systemPrompt: "",
			enableTools: true,
			enableSpawnAgent: true,
			enableAgentTeams: false,
		},
	});
	const snapshot = {
		agentId: "root",
		runId: "run",
		messages: [],
		parentAgentId: undefined,
	};
	await hooks.beforeRun!({ snapshot } as never);
	const tool = (id: string, name = "composio_multi_execute_tool") => ({
		snapshot,
		tool: { name },
		toolCall: { toolCallId: id },
		input: { action: "write" },
	});
	return {
		host,
		hooks,
		snapshot,
		tool,
		saved,
		cwd,
		fail: () => {
			fail = true;
		},
	};
}
describe("durable personal boundary", () => {
	it.each([
		"root",
		"child",
	])("restores a %s tool artifact after SIGKILL at its completion checkpoint", async (agent) => {
		const dir = await mkdtemp(join(tmpdir(), "durable-crash-test-"));
		dirs.push(dir);
		const oldWorkspace = join(dir, "old-workspace");
		const replacementWorkspace = join(dir, "replacement-workspace");
		const checkpoint = join(dir, "checkpoint.json");
		const worker = fileURLToPath(
			new URL("./fixtures/durable-artifact-crash.mjs", import.meta.url),
		);
		const run = (phase: string, workspace: string) =>
			new Promise<string>((resolve, reject) => {
				const child = spawn(process.execPath, [
					worker,
					phase,
					workspace,
					checkpoint,
					agent,
				]);
				let stdout = "";
				let stderr = "";
				let acknowledged = false;
				const timeout = setTimeout(() => {
					child.kill("SIGKILL");
					reject(new Error(`Timed out in ${phase}: ${stderr}`));
				}, 10_000);
				child.stdout.on("data", (data) => {
					stdout += data;
					if (
						phase === "seed" &&
						stdout.includes("TOOL_CHECKPOINT_ACKNOWLEDGED")
					) {
						acknowledged = true;
						child.kill("SIGKILL");
					}
				});
				child.stderr.on("data", (data) => {
					stderr += data;
				});
				child.once("error", (error) => {
					clearTimeout(timeout);
					reject(error);
				});
				child.once("close", (code, signal) => {
					clearTimeout(timeout);
					if (
						phase === "seed" ? acknowledged && signal === "SIGKILL" : code === 0
					)
						resolve(stdout);
					else
						reject(
							new Error(`${phase} failed (${code}, ${signal}): ${stderr}`),
						);
				});
			});
		await run("seed", oldWorkspace);
		await rm(oldWorkspace, { recursive: true, force: true });
		expect((await run("restore", replacementWorkspace)).trim()).toBe(
			"acknowledged artifact",
		);
	});
	it("awaits the state store and fails closed before a tool can start", async () => {
		const f = await fixture();
		f.fail();
		await expect(f.hooks.beforeTool!(f.tool("call") as never)).rejects.toThrow(
			"store unavailable",
		);
		await expect(
			f.hooks.beforeModel!({
				snapshot: f.snapshot,
				request: { messages: [] },
			} as never),
		).rejects.toThrow("store unavailable");
	});
	it("keeps parallel acknowledged results until a transcript contains them", async () => {
		const f = await fixture();
		await Promise.all([
			f.hooks.beforeTool!(f.tool("one") as never),
			f.hooks.beforeTool!(f.tool("two") as never),
		]);
		await f.hooks.afterTool!({
			...f.tool("one"),
			result: { output: { id: "one" } },
		} as never);
		await f.hooks.afterTool!({
			...f.tool("two"),
			result: { output: { id: "two" } },
		} as never);
		const saved = f.saved.at(-1)!;
		expect(Object.keys(saved.actions)).toHaveLength(2);
		expect(JSON.stringify(saved.messages)).toContain('"tool_use_id":"one"');
		expect(JSON.stringify(saved.messages)).toContain('"tool_use_id":"two"');
	});
	it("skips oversized artifacts without poisoning future checkpoints", async () => {
		const f = await fixture();
		await mkdir(join(f.cwd, "artifacts"));
		await writeFile(
			join(f.cwd, "artifacts", "large.bin"),
			Buffer.alloc(2 * 1024 * 1024),
		);
		await writeFile(join(f.cwd, "artifacts", "small.txt"), "keep me");
		await f.hooks.beforeModel!({
			snapshot: f.snapshot,
			request: { messages: [] },
		} as never);
		expect(f.saved.at(-1)!.artifactWarnings?.[0]).toContain("large.bin");
		expect(
			Buffer.from(f.saved.at(-1)!.artifacts["small.txt"], "base64").toString(),
		).toBe("keep me");
		await f.hooks.beforeTool!(f.tool("read", "read_files") as never);
	});
	it("allows reads but requires host evidence before resolving an uncertain action", async () => {
		const f = await fixture({
			version: 1,
			sessionId: "task",
			messages: [],
			artifacts: {},
			actions: {
				old: {
					toolName: "composio_multi_execute_tool",
					input: {},
					status: "unknown",
				},
			},
		});
		expect(
			await f.hooks.beforeTool!(f.tool("read", "read_files") as never),
		).toBeUndefined();
		expect(await f.hooks.beforeTool!(f.tool("new") as never)).toMatchObject({
			skip: true,
			stop: true,
		});
		await expect(
			f.host.resolveUnknownAction("old", "succeeded", ""),
		).rejects.toThrow("evidence");
		await f.host.resolveUnknownAction(
			"old",
			"succeeded",
			"Verified event exists: event-123",
		);
		expect(f.saved.at(-1)!.reconciliations?.[0].evidence).toContain(
			"event-123",
		);
		expect(
			await f.hooks.beforeTool!(f.tool("another") as never),
		).toBeUndefined();
	});
	it("permits correction after a known connector error but preserves unknown transport outcomes", async () => {
		const f = await fixture();
		await f.hooks.beforeTool!(f.tool("bad-args") as never);
		await f.hooks.afterTool!({
			...f.tool("bad-args"),
			result: { output: { successful: false, error: "invalid argument" } },
		} as never);
		expect(
			await f.hooks.beforeTool!(f.tool("corrected") as never),
		).toBeUndefined();
		await f.hooks.afterTool!({
			...f.tool("corrected"),
			result: {
				output: {
					successful: false,
					outcomeUnknown: true,
					error: "connection lost",
				},
			},
		} as never);
		expect(await f.hooks.beforeTool!(f.tool("retry") as never)).toMatchObject({
			stop: true,
		});
	});
	it("leaves transcript room and surfaces artifact-budget warnings", async () => {
		const f = await fixture();
		await mkdir(join(f.cwd, "artifacts"));
		for (let i = 0; i < 4; i++)
			await writeFile(
				join(f.cwd, "artifacts", `${i}.txt`),
				Buffer.alloc(1024 * 1024, 65),
			);
		const snapshot = {
			...f.snapshot,
			messages: [
				{
					id: "long",
					role: "user",
					createdAt: 1,
					content: [{ type: "text", text: "x".repeat(4 * 1024 * 1024) }],
				},
			],
		};
		const result = await f.hooks.beforeModel!({
			snapshot,
			request: { messages: [] },
		} as never);
		expect(Buffer.byteLength(JSON.stringify(f.saved.at(-1)))).toBeLessThan(
			8 * 1024 * 1024,
		);
		expect(f.saved.at(-1)!.artifactWarnings?.length).toBeGreaterThan(0);
		expect(JSON.stringify(result)).toContain("Tell the user");
	});
	it("retains delegated uncertainty without overwriting the primary transcript", async () => {
		const f = await fixture();
		const child = {
			...f.tool("child-call"),
			snapshot: {
				...f.snapshot,
				agentId: "child",
				parentAgentId: "root",
				runId: "child-run",
				messages: [],
			},
		};
		await f.hooks.beforeTool!(child as never);
		await f.hooks.afterTool!({
			...child,
			result: { isError: true, output: "connection lost" },
		} as never);
		expect(
			Object.values(f.saved.at(-1)!.actions).some(
				(a) => a.status === "unknown",
			),
		).toBe(true);
		expect(
			await f.hooks.beforeTool!({
				...child,
				toolCall: { toolCallId: "retry" },
			} as never),
		).toMatchObject({ stop: true });
		expect(
			await f.hooks.beforeTool!(f.tool("parent-write") as never),
		).toMatchObject({ stop: true });
		expect(f.saved.at(-1)!.messages).toEqual([]);
	});
	it("composes the capable profile without deleting host hooks or file inputs", async () => {
		const beforeRun = vi.fn(async () => ({
			appendContext: "existing context",
		}));
		const input = applyPersonalProfile({
			config: {
				providerId: "cline",
				modelId: "fixture",
				cwd: "/tmp",
				systemPrompt: "",
				enableTools: true,
				enableSpawnAgent: true,
				enableAgentTeams: false,
			},
			userFiles: ["brief.pdf"],
			localRuntime: { hooks: { beforeRun }, configExtensions: ["plugins"] },
		} as StartSessionInput);
		expect(input.config.enableTools).toBe(true);
		expect(input.config.enableSpawnAgent).toBe(true);
		expect(input.userFiles).toEqual(["brief.pdf"]);
		expect(input.localRuntime?.configExtensions).toEqual(["plugins"]);
		expect(
			(await input.localRuntime!.hooks!.beforeRun!({} as never))?.appendContext,
		).toMatch(/existing context\nCurrent UTC time:/);
	});
});
