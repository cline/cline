import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool, ToolApprovalRequest } from "@cline/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClineCore } from "../../ClineCore";
import { exportSessionReplayBundle } from "./bundle-export";
import { readSessionReplayBundle } from "./bundle-io";
import { buildSessionReplayIterations } from "./bundle-iterations";
import { resolveRecordedRequestMessages } from "./recording-schema";
import { TOOL_ENVIRONMENT_METADATA_KEY } from "./tool-environment";

const STEER_TEXT = "Also note the steer arrived.";

function sseChunk(
	delta: unknown,
	finishReason: string | null,
	usage?: unknown,
) {
	return `data: ${JSON.stringify({
		id: "chatcmpl-fake",
		object: "chat.completion.chunk",
		created: 0,
		model: "fake-model",
		choices: [{ index: 0, delta, finish_reason: finishReason }],
		...(usage ? { usage } : {}),
	})}\n\n`;
}

function toolCalls(calls: Array<{ id: string; name: string; input: unknown }>) {
	return sseChunk(
		{
			tool_calls: calls.map((call, index) => ({
				index,
				id: call.id,
				type: "function",
				function: { name: call.name, arguments: JSON.stringify(call.input) },
			})),
		},
		null,
	);
}

interface ChatRequest {
	tools?: unknown[];
	messages?: Array<{
		role?: string;
		content?: unknown;
		tool_call_id?: string;
	}>;
}

function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) =>
				part && typeof part === "object" && "text" in part
					? String((part as { text: unknown }).text)
					: "",
			)
			.join("");
	}
	return "";
}

/**
 * Scripted OpenAI-compatible model. Stage is derived from the request
 * history so retries and unrelated calls cannot shift the script:
 * 1. read a file and run two parallel lookups,
 * 2. run a command (needs approval; the approval handler steers),
 * 3. after the steer, edit a file,
 * 4. answer with text, which ends the run.
 */
function startFakeModel(workspace: string): Promise<Server> {
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			const request = JSON.parse(body || "{}") as ChatRequest;
			const messages = request.messages ?? [];
			const toolResult = (id: string) =>
				messages.some(
					(message) => message.role === "tool" && message.tool_call_id === id,
				);
			const steered = messages.some(
				(message) =>
					message.role === "user" &&
					messageText(message.content).includes(STEER_TEXT),
			);
			res.writeHead(200, { "content-type": "text/event-stream" });
			const usage = {
				prompt_tokens: 100 + messages.length,
				completion_tokens: 10,
				total_tokens: 110 + messages.length,
			};
			if (!request.tools?.length) {
				res.write(sseChunk({ role: "assistant", content: "Title" }, null));
				res.write(sseChunk({}, "stop", usage));
			} else if (toolResult("call_edit")) {
				res.write(sseChunk({ role: "assistant", content: "Done." }, null));
				res.write(sseChunk({}, "stop", usage));
			} else if (steered && toolResult("call_echo")) {
				res.write(sseChunk({ role: "assistant", content: "Editing." }, null));
				res.write(
					toolCalls([
						{
							id: "call_edit",
							name: "editor",
							input: {
								path: join(workspace, "c.txt"),
								old_text: "before",
								new_text: "after",
							},
						},
					]),
				);
				res.write(sseChunk({}, "tool_calls", usage));
			} else if (toolResult("call_lookup_b")) {
				res.write(sseChunk({ role: "assistant", content: "Running." }, null));
				res.write(
					toolCalls([
						{
							id: "call_echo",
							name: "run_commands",
							input: { commands: ["echo recorded-e2e"] },
						},
					]),
				);
				res.write(sseChunk({}, "tool_calls", usage));
			} else {
				res.write(sseChunk({ role: "assistant", content: "Reading." }, null));
				res.write(
					toolCalls([
						{
							id: "call_read",
							name: "read_files",
							input: { files: [{ path: join(workspace, "a.txt") }] },
						},
						{
							id: "call_lookup_a",
							name: "slow_lookup",
							input: { key: "a", delayMs: 120 },
						},
						{
							id: "call_lookup_b",
							name: "slow_lookup",
							input: { key: "b", delayMs: 5 },
						},
					]),
				);
				res.write(sseChunk({}, "tool_calls", usage));
			}
			res.end("data: [DONE]\n\n");
		});
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve(server));
	});
}

const slowLookup: AgentTool<{ key: string; delayMs: number }, string> = {
	name: "slow_lookup",
	description: "Looks up a key after a delay.",
	inputSchema: {
		type: "object",
		properties: { key: { type: "string" }, delayMs: { type: "number" } },
		required: ["key", "delayMs"],
	},
	executionMode: "parallel",
	async execute(input) {
		await new Promise((resolve) => setTimeout(resolve, input.delayMs));
		return `value-${input.key}`;
	},
};

function sha256(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("session recording e2e", () => {
	let server: Server;
	let root: string;
	let workspace: string;
	let sessionsDir: string;
	const savedEnv = { ...process.env };

	beforeAll(async () => {
		root = mkdtempSync(join(tmpdir(), "core-recording-e2e-"));
		workspace = join(root, "workspace");
		sessionsDir = join(root, "sessions");
		const data = join(root, "data");
		for (const dir of [workspace, sessionsDir, data, join(root, "home")]) {
			mkdirSync(dir, { recursive: true });
		}
		writeFileSync(join(workspace, "a.txt"), "alpha\n");
		writeFileSync(join(workspace, "c.txt"), "before\n");
		Object.assign(process.env, {
			HOME: join(root, "home"),
			CLINE_DIR: join(root, "home", ".cline"),
			CLINE_DATA_DIR: data,
			CLINE_DB_DATA_DIR: join(data, "db"),
			CLINE_SESSION_DATA_DIR: sessionsDir,
			CLINE_TEAM_DATA_DIR: join(root, "teams"),
			CLINE_SESSION_BACKEND_MODE: "local",
			CLINE_PROVIDER_SETTINGS_PATH: join(data, "settings", "providers.json"),
			CLINE_HOOKS_LOG_PATH: join(data, "logs", "hooks.jsonl"),
		});
		delete process.env.CLINE_RECORD_SESSIONS;
		server = await startFakeModel(workspace);
	});

	afterAll(async () => {
		await new Promise((resolve) => server?.close(resolve));
		for (const key of Object.keys(process.env)) {
			if (!(key in savedEnv)) delete process.env[key];
		}
		Object.assign(process.env, savedEnv);
		if (root) rmSync(root, { recursive: true, force: true });
	});

	it("records requests, decisions, ordering and tool facts, and exports them", async () => {
		const { port } = server.address() as AddressInfo;
		const approvals: ToolApprovalRequest[] = [];
		let steerTarget: ClineCore | undefined;
		const core = await ClineCore.create({
			backendMode: "local",
			capabilities: {
				requestToolApproval: async (request) => {
					approvals.push(request);
					await steerTarget?.send({
						sessionId: request.sessionId,
						prompt: STEER_TEXT,
						delivery: "steer",
					});
					return { approved: true };
				},
			},
		});
		steerTarget = core;
		try {
			const started = await core.start({
				config: {
					providerId: "openai-compatible",
					modelId: "fake-model",
					apiKey: "sk-recording-e2e",
					baseUrl: `http://127.0.0.1:${port}/v1`,
					cwd: workspace,
					workspaceRoot: workspace,
					systemPrompt: "You are a test agent.",
					mode: "act",
					enableTools: true,
					enableSpawnAgent: false,
					enableAgentTeams: false,
					extraTools: [slowLookup as AgentTool],
					recording: { enabled: true },
				},
				toolPolicies: { run_commands: { autoApprove: false } },
				prompt: "Read, look up, run and edit.",
				interactive: false,
			});
			const sessionId = started.sessionId;
			expect(approvals.map((request) => request.toolName)).toEqual([
				"run_commands",
			]);
			expect(readFileSync(join(workspace, "c.txt"), "utf8")).toBe("after\n");

			const outputDir = join(root, "bundle");
			const exported = await exportSessionReplayBundle({
				sessionId,
				outputDir,
				source: {
					getSession: (id) => core.get(id),
					readMessages: (id) => core.readMessages(id),
					readSessionCompactionState: (id) =>
						core.readSessionCompactionState(id),
				},
				sessionsDir,
			});
			expect(exported.validation.errors).toEqual([]);
			expect(exported.manifest.schemaVersion).toBe(2);

			const bundle = await readSessionReplayBundle(outputDir);
			const [session] = bundle.sessions;
			if (!session) throw new Error("bundle has no session");
			const { transcript, requests, blobs, events } = session;
			const recording = session.entry.recording;
			expect(recording).not.toBeNull();
			expect(recording?.segments).toHaveLength(1);
			expect(recording?.segments[0]?.enabledBy).toBe("config");

			// One request record per committed assistant message, linked by id.
			const assistantIds = transcript.messages
				.filter((message) => message.role === "assistant")
				.map((message) => message.id);
			expect(assistantIds).toHaveLength(4);
			const completed = requests.filter(
				(record) => record.response.outcome === "completed",
			);
			expect(completed.map((record) => record.response.messageId)).toEqual(
				assistantIds,
			);
			expect(recording?.coverage).toMatchObject({
				assistantMessages: 4,
				linked: 4,
				unlinkedMessageIds: [],
			});
			expect(requests.map((record) => record.iteration)).toEqual([1, 2, 3, 4]);
			expect(requests.map((record) => record.response.toolCallIds)).toEqual([
				["call_read", "call_lookup_a", "call_lookup_b"],
				["call_echo"],
				["call_edit"],
				[],
			]);
			expect(requests.map((record) => record.callIndex)).toEqual([0, 1, 2, 3]);
			for (const record of requests) {
				expect(blobs.get(record.request.systemPromptSha256 ?? "")?.value).toBe(
					transcript.systemPrompt,
				);
				const tools = blobs.get(record.request.toolsSha256)?.value as Array<{
					name: string;
				}>;
				expect(tools.map((tool) => tool.name)).toContain("slow_lookup");
				expect(record.request.provider).toMatchObject({
					provider: "openai-compatible",
					model: "fake-model",
				});
				expect(JSON.stringify(record)).not.toContain("sk-recording-e2e");
				expect(record.response.usage).toMatchObject({ outputTokens: 10 });
			}
			// Each request carries the whole conversation so far, so request
			// N+1 is stored as "request N plus what it added".
			const requestMessages = resolveRecordedRequestMessages(requests);
			expect(requestMessages.errors).toEqual([]);
			for (const record of requests.slice(1)) {
				const previous =
					requestMessages.messages.get(record.callIndex - 1) ?? [];
				expect(record.request.messagePrefix).toEqual({
					callIndex: record.callIndex - 1,
					count: previous.length,
				});
				expect(
					requestMessages.messages
						.get(record.callIndex)
						?.slice(0, previous.length),
				).toEqual(previous);
			}
			for (const shas of requestMessages.messages.values()) {
				for (const sha of shas) expect(blobs.has(sha)).toBe(true);
			}
			const steerBlob = [...blobs.values()].find(
				(blob) =>
					blob.kind === "message" &&
					JSON.stringify(blob.value).includes(STEER_TEXT),
			);
			expect(steerBlob).toBeDefined();
			expect(requests[2]?.request.messageSha256s).toContain(steerBlob?.sha256);
			expect(requestMessages.messages.get(1)).not.toContain(steerBlob?.sha256);

			// Decisions: approval requested/resolved with attribution, the
			// steer enqueued and delivered mid-run, the start prompt delivered.
			const decisions = events.filter((event) => event.kind === "decision");
			expect(decisions.map((event) => event.name)).toEqual([
				"prompt_delivered",
				"approval_requested",
				"prompt_enqueued",
				"approval_resolved",
				"prompt_delivered",
			]);
			const [startPrompt, requested, enqueued, resolved, steered] = decisions;
			expect(startPrompt?.payload).toMatchObject({
				delivery: "immediate",
				source: "start",
			});
			expect(requested).toMatchObject({
				toolCallId: "call_echo",
				iteration: 2,
				payload: { toolName: "run_commands" },
			});
			expect(enqueued?.payload).toMatchObject({
				delivery: "steer",
				prompt: STEER_TEXT,
			});
			expect(resolved?.payload).toMatchObject({
				approved: true,
				decidedBy: { kind: "host" },
			});
			expect(steered?.payload).toMatchObject({ delivery: "steer" });
			expect(steered?.refs?.promptId).toBe(enqueued?.refs?.promptId);
			// The steer lands between model calls 2 and 3.
			const seqOf = (callIndex: number) =>
				requests.find((record) => record.callIndex === callIndex)?.seq ?? -1;
			expect(steered?.seq).toBeGreaterThan(seqOf(1));
			expect(steered?.seq).toBeLessThan(seqOf(2));

			// Ordering: all sequenced events are unique and strictly increasing,
			// and the parallel lookups started before either finished while
			// finishing in the opposite order.
			const seqs = events
				.map((event) => event.seq)
				.filter((seq): seq is number => seq !== undefined);
			expect(seqs.length).toBe(events.length);
			expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
			expect(new Set(seqs).size).toBe(seqs.length);
			const runtimeSeq = (name: string, toolCallId: string) =>
				events.find(
					(event) =>
						event.kind === "runtime" &&
						event.name === name &&
						event.toolCallId === toolCallId,
				)?.seq ?? -1;
			const startA = runtimeSeq("tool_started", "call_lookup_a");
			const startB = runtimeSeq("tool_started", "call_lookup_b");
			const finishA = runtimeSeq("tool_finished", "call_lookup_a");
			const finishB = runtimeSeq("tool_finished", "call_lookup_b");
			expect(startA).toBeGreaterThan(runtimeSeq("tool_finished", "call_read"));
			expect(Math.max(startA, startB)).toBeLessThan(Math.min(finishA, finishB));
			expect(finishB).toBeLessThan(finishA);
			// Hook audit lines share the counter.
			expect(
				events.some(
					(event) => event.kind === "hook" && event.seq !== undefined,
				),
			).toBe(true);
			// Every request record has its model_finished event at the same seq.
			for (const record of requests) {
				const finished = events.find(
					(event) =>
						event.name === "model_finished" &&
						event.refs?.modelCallIndex === record.callIndex,
				);
				expect(finished?.seq).toBe(record.seq);
			}

			// Tool environment facts ride on the tool result messages.
			const factsFor = (toolCallId: string) => {
				const message = transcript.messages.find(
					(candidate) =>
						Array.isArray(candidate.content) &&
						candidate.content.some(
							(block) =>
								block.type === "tool_result" &&
								block.tool_use_id === toolCallId,
						),
				);
				return message?.metadata?.[TOOL_ENVIRONMENT_METADATA_KEY] as
					| Record<string, unknown>
					| undefined;
			};
			expect(factsFor("call_read")).toMatchObject({
				version: 1,
				read: [{ exists: true, sha256: sha256("alpha\n"), bytes: 6 }],
			});
			expect(factsFor("call_echo")).toMatchObject({
				commands: { results: [{ command: "echo recorded-e2e", exitCode: 0 }] },
			});
			expect(factsFor("call_edit")).toMatchObject({
				preImage: [{ exists: true, sha256: sha256("before\n") }],
				postImage: [{ exists: true, sha256: sha256("after\n") }],
			});
			expect(factsFor("call_lookup_a")).toBeUndefined();

			// Playback projection surfaces the recorded calls and decisions.
			const iterations = buildSessionReplayIterations(session);
			expect(iterations).toHaveLength(4);
			expect(iterations[1]?.modelCalls?.[0]).toMatchObject({
				callIndex: 1,
				outcome: "completed",
			});
			expect(
				iterations.map((iteration) =>
					iteration.modelCalls?.map((call) => call.callIndex),
				),
			).toEqual([[0], [1], [2], [3]]);
			const decisionDetails = (position: number) =>
				iterations[position]?.events
					.filter((event) => event.kind === "decision")
					.map((event) => event.detail);
			expect(decisionDetails(0)).toEqual([
				"immediate prompt delivered (start)",
			]);
			expect(decisionDetails(1)).toEqual([
				"approval requested for run_commands",
				expect.stringMatching(/^approved run_commands by host after \d+ms$/),
			]);
			// The steer was enqueued during iteration 2's tool call; its
			// decisions are shown with iteration 3, the model call it fed,
			// next to the steer message (which does not start a user turn).
			expect(iterations[2]?.injected?.map((note) => note.text)).toEqual([
				STEER_TEXT,
			]);
			expect(decisionDetails(2)).toEqual([
				`steer prompt queued: "${STEER_TEXT}"`,
				"steer prompt delivered (act)",
			]);
		} finally {
			await core.dispose();
		}
	});
});
