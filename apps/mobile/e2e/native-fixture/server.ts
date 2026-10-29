#!/usr/bin/env bun
/** Explicitly launched, loopback-only simulator service. Never imported by app code. */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMobileFixtureHost } from "../../scripts/dev-hub";
import { FixtureAccounts, fixtureSessionList } from "./accounts";
import {
	attachmentMessages,
	type SubmittedAttachments,
} from "./attachment-history";
import {
	commandFault,
	FixtureFaults,
	fixtureStatusAuthenticationFailure,
	holdFixtureWorkspaceMutation,
} from "./faults";
import { fixtureLifecycleDto } from "./rest-contract";
import {
	SDK_PROFILE_PROVENANCE,
	SdkContractProfiles,
} from "./sdk-contract-profiles";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const { startHubWebSocketServer, createLocalHubScheduleRuntimeHandlers } =
	await import(resolve(root, "sdk/packages/core/src/hub/index.ts"));
const { ScriptedRuntimeHost } = await import(
	resolve(root, "sdk/packages/hub-testkit/src/scripted-runtime-host.ts")
);
const { HubClient } = await import(
	resolve(root, "sdk/packages/hub-client/src/index.ts")
);
const { PendingPromptsController } = await import(
	resolve(
		root,
		"sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts",
	)
);
const MobileFixtureHost = createMobileFixtureHost(ScriptedRuntimeHost);
const stateDir =
	process.env.FIXTURE_STATE_DIR ||
	mkdtempSync(resolve(tmpdir(), "cline-native-fixture-"));
const port = Number(process.env.FIXTURE_PORT || 4783);
const base = `http://127.0.0.1:${port}`;
const token = "cline-isolated-native-fixture-token";
const controlKey = crypto.randomUUID();
const events: unknown[] = [];
const record = (kind: string, detail: unknown) => {
	events.push({ at: Date.now(), kind, detail });
	writeFileSync(
		resolve(stateDir, "events.json"),
		JSON.stringify(events, null, 2),
	);
};
const patch =
	"*** Begin Patch\n*** Update File: src/Fixture.ts\n@@\n-export const title = 'Before';\n+export const title = 'After';\n*** Add File: src/NewFixture.ts\n+export const nativeFixture = true;\n*** End Patch";

function fixtureTone() {
	const count = 40000,
		bytes = Buffer.alloc(44 + count * 2);
	bytes.write("RIFF", 0);
	bytes.writeUInt32LE(bytes.length - 8, 4);
	bytes.write("WAVEfmt ", 8);
	bytes.writeUInt32LE(16, 16);
	bytes.writeUInt16LE(1, 20);
	bytes.writeUInt16LE(1, 22);
	bytes.writeUInt32LE(8000, 24);
	bytes.writeUInt32LE(16000, 28);
	bytes.writeUInt16LE(2, 32);
	bytes.writeUInt16LE(16, 34);
	bytes.write("data", 36);
	bytes.writeUInt32LE(count * 2, 40);
	for (let index = 0; index < count; index++)
		bytes.writeInt16LE(
			Math.round(Math.sin((index * 2 * Math.PI * 440) / 8000) * 4000),
			44 + index * 2,
		);
	return bytes;
}
class NativeFixtureHost extends MobileFixtureHost {
	sdkProfiles = new SdkContractProfiles(
		(sessionId, event) => this.emitExtra(sessionId, event),
		record,
	);
	queueStates = new Map<string, any>();
	submittedAttachments = new Map<string, SubmittedAttachments[]>();
	heldSessions = new Set<string>();
	releaseGate(id: string) {
		if (id.startsWith("native-queue-"))
			this.heldSessions.delete(id.slice("native-queue-".length));
		super.releaseGate(id);
	}
	injectedHistory = new Map<string, { index: number; message: unknown }[]>();
	pendingController = new PendingPromptsController({
		getSession: (sessionId: string) => this.queueState(sessionId),
		emit: (event: unknown) => this.emitCore(event),
		send: (input: any) => this.runTurn(input),
	});
	pendingPrompts = {
		list: async ({ sessionId }: any) => this.pendingController.list(sessionId),
		update: async (input: any) => this.pendingController.update(input),
		delete: async (input: any) => this.pendingController.delete(input),
		steerFirst: async ({ sessionId }: any) =>
			this.pendingController.steerFirst(sessionId),
	};
	queueState(sessionId: string) {
		let state = this.queueStates.get(sessionId);
		if (!state) {
			state = {
				sessionId,
				pendingPrompts: [],
				aborting: false,
				drainingPendingPrompts: false,
				busy: false,
				status: "idle",
				agent: {
					canStartRun: () => !state.busy,
					notifyPendingUserMessage: () => {
						queueMicrotask(() => {
							void this.consumeFixtureSteer(sessionId);
						});
					},
				},
			};
			this.queueStates.set(sessionId, state);
		}
		return state;
	}
	emitCore(event: unknown) {
		for (const listener of this.extraListeners) listener(event);
	}
	async consumeFixtureSteer(sessionId: string) {
		const entry = this.pendingController.consumeSteer(sessionId);
		if (!entry) return;
		const raw = await ScriptedRuntimeHost.prototype.readSessionMessages.call(
			this,
			sessionId,
		);
		const history = this.injectedHistory.get(sessionId) ?? [];
		history.push({
			index: raw.length,
			message: { role: "user", content: entry.prompt },
		});
		history.push({
			index: raw.length,
			message: {
				role: "assistant",
				content: `STEER_FIXTURE_RECEIVED: ${entry.prompt}`,
			},
		});
		this.injectedHistory.set(sessionId, history);
		this.emitExtra(sessionId, {
			type: "content_start",
			contentType: "text",
			text: `STEER_FIXTURE_RECEIVED: ${entry.prompt}`,
		});
		this.emitExtra(sessionId, {
			type: "content_end",
			contentType: "text",
			text: `STEER_FIXTURE_RECEIVED: ${entry.prompt}`,
		});
		record("steer-consumed", { sessionId, id: entry.id, prompt: entry.prompt });
	}
	async abort(sessionId: string, reason?: unknown) {
		this.sdkProfiles.abort(sessionId);
		const state = this.queueState(sessionId);
		state.aborting = true;
		if (state.drainingPendingPrompts)
			this.pendingController.discardQueue(state);
		await super.abort(sessionId, reason);
		if (this.heldSessions.has(sessionId))
			this.releaseGate(`native-queue-${sessionId}`);
	}
	async runTurn(input: {
		sessionId: string;
		prompt: string;
		delivery?: "queue" | "steer";
		mode?: any;
		userImages?: string[];
		userFiles?: string[];
	}) {
		const state = this.queueState(input.sessionId);
		const delivery = input.delivery ?? (state.busy ? "queue" : undefined);
		if (delivery === "queue" || delivery === "steer") {
			this.pendingController.enqueue(input.sessionId, { ...input, delivery });
			return undefined;
		}
		state.busy = true;
		state.status = "running";
		this.emitCore({
			type: "status",
			payload: { sessionId: input.sessionId, status: "running" },
		});
		let result: any;
		try {
			result = await this.executeFixtureTurn(input);
			return result;
		} finally {
			this.heldSessions.delete(input.sessionId);
			state.busy = false;
			state.aborting = false;
			state.status =
				!result || result.finishReason === "error"
					? "failed"
					: result?.finishReason === "aborted"
						? "cancelled"
						: "completed";
			// A thrown scripted turn has no agent-generated terminal status. Emit it
			// explicitly so the initial running snapshot cannot be the last update.
			if (!result)
				this.emitCore({
					type: "status",
					payload: { sessionId: input.sessionId, status: "failed" },
				});
			this.emitCore({
				type: "ended",
				payload: {
					sessionId: input.sessionId,
					reason: result?.finishReason ?? "error",
				},
			});
			if (result && result.finishReason !== "error")
				queueMicrotask(() => {
					void this.pendingController.drain(input.sessionId);
				});
		}
	}
	thinkingChoices = new Map<string, boolean>();
	async updateSessionConnection(
		sessionId: string,
		updates: {
			providerId?: string;
			modelId?: string;
			reasoningEffort?: string | null;
			thinking?: boolean | null;
		},
	) {
		if (typeof updates.thinking === "boolean")
			this.thinkingChoices.set(sessionId, updates.thinking);
		await super.updateSessionConnection(sessionId, updates);
	}
	async listModelCatalog() {
		const catalog = await super.listModelCatalog();
		return {
			...catalog,
			modelsByProvider: Object.fromEntries(
				Object.entries(catalog.modelsByProvider).map(([provider, models]) => [
					provider,
					models.map((model) => ({
						...model,
						supportsThinking: !model.id.endsWith("-mini"),
					})),
				]),
			),
		};
	}
	async getSession(sessionId: string) {
		const session = await super.getSession(sessionId);
		if (!session || typeof session !== "object") return session;
		const record = session as Record<string, unknown>;
		const state = this.queueStates.get(sessionId);
		return {
			...record,
			// The core status event can be projected before the scripted agent has
			// entered runTurn. Busy admission owns status throughout that window.
			status: state?.busy ? "running" : (state?.status ?? record.status),
			metadata: {
				...(record.metadata as Record<string, unknown> | undefined),
				mode: record.mode ?? "act",
				thinking: this.thinkingChoices.get(sessionId) ?? false,
				...(typeof record.reasoningEffort === "string"
					? { reasoningEffort: record.reasoningEffort }
					: {}),
			},
		};
	}
	uxHistory = new Map<string, unknown[]>();
	extraListeners = new Set<(event: unknown) => void>();
	mediaHistory = new Map<string, { index: number; media: unknown }[]>();
	messageBase = new Map<string, number>();
	subscribe(listener: (event: unknown) => void) {
		const wrapped = (event: any) => {
			if (
				event.type === "agent_event" &&
				event.payload.event.type === "content_end" &&
				event.payload.event.contentType === "media"
			) {
				const sessionId = event.payload.sessionId;
				const history = this.mediaHistory.get(sessionId) || [];
				const media = event.payload.event.media;
				if (!history.some((entry: any) => entry.media.id === media.id))
					history.push({
						index: (this.messageBase.get(sessionId) || 0) + 1,
						media,
					});
				this.mediaHistory.set(sessionId, history);
			}
			listener(event);
		};
		this.extraListeners.add(wrapped);
		const unsubscribe = super.subscribe(wrapped);
		return () => {
			this.extraListeners.delete(wrapped);
			unsubscribe();
		};
	}
	emitExtra(sessionId: string, event: unknown) {
		for (const listener of this.extraListeners)
			listener({ type: "agent_event", payload: { sessionId, event } });
	}
	async readSessionMessages(sessionId: string) {
		if (this.sdkProfiles.histories.has(sessionId))
			return structuredClone(this.sdkProfiles.histories.get(sessionId));
		const messages =
			await ScriptedRuntimeHost.prototype.readSessionMessages.call(
				this,
				sessionId,
			);
		const result: unknown[] = [];
		for (let index = 0; index <= messages.length; index++) {
			for (const entry of this.injectedHistory.get(sessionId) ?? [])
				if (entry.index === index) result.push(entry.message);
			for (const entry of this.mediaHistory.get(sessionId) || [])
				if (entry.index === index)
					result.push({
						role: "assistant",
						content: [{ type: "media", media: entry.media }],
					});
			if (index < messages.length) result.push(messages[index]);
		}
		return [
			...(this.uxHistory.get(sessionId) ?? []),
			...attachmentMessages(
				result,
				this.submittedAttachments.get(sessionId) ?? [],
			),
		];
	}
	async executeFixtureTurn(input: {
		sessionId: string;
		prompt: string;
		userImages?: string[];
		userFiles?: string[];
	}) {
		if (input.userImages?.length || input.userFiles?.length) {
			const entries = this.submittedAttachments.get(input.sessionId) ?? [];
			entries.push(input);
			this.submittedAttachments.set(input.sessionId, entries);
		}
		this.messageBase.set(
			input.sessionId,
			(
				await ScriptedRuntimeHost.prototype.readSessionMessages.call(
					this,
					input.sessionId,
				)
			).length,
		);
		record("prompt", input);
		const prompt = input.prompt.toLowerCase();
		if (this.sdkProfiles.matches(prompt)) return this.sdkProfiles.run(input);
		if (prompt.includes("ux-fixture")) {
			const notice =
				"<mode_notice>The user switched from plan mode to act mode before sending this message.</mode_notice>";
			const history: unknown[] = [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "[SYSTEM] This run is not complete until you call one of these terminal completion tools: INTERNAL_REMINDER_TOOL. Continue working if requirements are not met. If the task is complete, call the appropriate terminal completion tool now.",
						},
					],
					metadata: { userRunSpan: 0 },
				},
				{
					role: "user",
					content:
						"[SYSTEM] You still have team obligations. Unfinished tasks: INTERNAL_REMINDER_TEAM (pending): inspect. Use team_run_task to delegate work, or team_task with action=complete to mark tasks done, or team_await_runs to wait for active runs. Do NOT stop until all tasks are completed.",
					metadata: { userRunSpan: 0 },
				},
				{
					role: "user",
					content:
						"Your previous response was cut off because it reached the model's output-token limit before finishing. Keep responses concise: take one small step at a time, avoid long explanations, and write large files or command output in smaller chunks across multiple tool calls.",
					metadata: { userRunSpan: 0 },
				},
				{
					role: "user",
					content: "INTERNAL_COMPACTION_CONTEXT_DO_NOT_DISPLAY",
					metadata: {
						kind: "compaction_summary",
						displayRole: "system",
						userRunSpan: 3,
					},
				},
				{
					role: "user",
					content: "INTERNAL_RECOVERY_CONTEXT_DO_NOT_DISPLAY",
					metadata: { kind: "recovery_notice" },
				},
				{
					role: "assistant",
					content: "INTERNAL_STATUS_CONTEXT_DO_NOT_DISPLAY",
					metadata: { displayRole: "status", displayOnly: true },
				},
				{
					role: "user",
					content:
						'<hook_context source="RunStart">\nINTERNAL_HOOK_CONTEXT_DO_NOT_DISPLAY\n</hook_context>',
				},
				{
					role: "user",
					content:
						'<user_input mode="act">[TASK RESUMPTION] Please continue where you left off.</user_input>',
				},
				{
					role: "user",
					content: `${notice}<user_input mode="act">${notice}UX_VISIBLE_PROMPT Keep task_id and <div>my code</div>.\n\n\`\`\`xml\n<mode_notice>Authored XML example</mode_notice>\n\`\`\`</user_input>`,
				},
				{
					role: "assistant",
					content:
						"UX_VISIBLE_ANSWER keeps **Markdown** and literal XML: `<user_input>authored assistant example</user_input>`.",
				},
			];
			for (let index = 1; index <= 30; index += 1) {
				const number = String(index).padStart(2, "0");
				history.push(
					{
						role: "user",
						content: `<user_input mode="act">UX navigation prompt ${number}: inspect this section</user_input>`,
					},
					{
						role: "assistant",
						content: `UX answer ${number}: a deterministic transcript section for navigation.`,
					},
				);
			}
			this.uxHistory.set(input.sessionId, history);
			this.enqueue({
				steps: [
					{
						kind: "text",
						chunks: [
							"UX_FIXTURE_READY: reopen this conversation to load the seeded history.",
						],
					},
				],
			});
			return ScriptedRuntimeHost.prototype.runTurn.call(this, input);
		}
		if (prompt.includes("rich-fixture")) {
			this.enqueue({
				steps: [
					{
						kind: "text",
						chunks: [
							"# Rich transcript fixture\n\n**Bold**, *italic*, ~~strike~~, task_id and `inline_code`.\n\n- First bullet\n- Second bullet\n\n1. Numbered first\n2. Numbered second\n\n> Block quote\n\n| Column | Value |\n| --- | --- |\n| alpha | beta |\n\n```typescript\nconst task_id = '<div>authored code</div>';\nconsole.log(task_id);\n```\n\n[Safe documentation](https://example.com) and [blocked scheme](javascript:alert(1)).\n\n---\n\nRICH_FIXTURE_END",
						],
					},
					{
						kind: "tool",
						name: "execute_command",
						input: { command: "fixture-only: no shell is executed" },
						output: Array.from(
							{ length: 180 },
							(_, i) => `Output line ${i + 1}: task_id preserved`,
						).join("\n"),
						requiresApproval: false,
					},
					{
						kind: "tool",
						name: "read_file",
						input: { path: "missing-fixture.txt" },
						error: "Fixture file not found; deterministic tool failure",
						requiresApproval: false,
					},
					{ kind: "text", chunks: ["RICH_FIXTURE_COMPLETE"] },
				],
			});
			return ScriptedRuntimeHost.prototype.runTurn.call(this, input);
		}
		if (prompt.includes("invalid-media")) {
			for (const modality of ["image", "audio", "video"] as const)
				this.emitExtra(input.sessionId, {
					type: "content_end",
					contentType: "media",
					media: {
						id: `invalid-${modality}-${crypto.randomUUID()}`,
						modality,
						mediaType: {
							image: "image/png",
							audio: "audio/wav",
							video: "video/mp4",
						}[modality],
						name: `invalid-fixture.${modality}`,
						source: {
							type: "base64",
							data: Buffer.from(
								"Intentionally invalid native media bytes",
							).toString("base64"),
						},
					},
				});
			this.enqueue({
				steps: [{ kind: "text", chunks: ["INVALID_MEDIA_FIXTURE_READY"] }],
			});
			return ScriptedRuntimeHost.prototype.runTurn.call(this, input);
		}
		if (prompt.includes("approval-fixture")) {
			this.enqueue({
				steps: [
					{
						kind: "tool",
						name: "bash",
						input: { command: "git diff -- src/Example.tsx" },
						output:
							"diff --git a/src/Example.tsx b/src/Example.tsx\n--- a/src/Example.tsx\n+++ b/src/Example.tsx\n@@ -1 +1 @@\n-export const title = 'Example';\n+export const title = 'Fixture';",
						requiresApproval: true,
					},
					{
						kind: "text",
						chunks: [
							"Approval fixture finished; the tool outcome above records whether it was allowed or denied.",
						],
					},
				],
			});
			return ScriptedRuntimeHost.prototype.runTurn.call(this, input);
		}
		if (prompt.includes("fixture-error"))
			throw new Error("Native fixture requested a deterministic run failure.");
		if (prompt.includes("edit-fixture")) {
			this.enqueue({
				steps: [
					{
						kind: "tool",
						name: "apply_patch",
						input: { input: patch },
						output:
							"Updated two synthetic files; no filesystem changes were made.",
						requiresApproval: false,
					},
					{ kind: "text", chunks: ["EDIT_FIXTURE_COMPLETE"] },
				],
			});
			return ScriptedRuntimeHost.prototype.runTurn.call(this, input);
		}
		if (prompt.includes("hold-fixture")) {
			this.heldSessions.add(input.sessionId);
			this.enqueue({
				steps: [
					{ kind: "text", chunks: ["QUEUE_FIXTURE_HOLDING"] },
					{ kind: "gate", id: `native-queue-${input.sessionId}` },
					{ kind: "text", chunks: ["QUEUE_FIXTURE_RELEASED"] },
				],
			});
			return ScriptedRuntimeHost.prototype.runTurn.call(this, input);
		}

		const kind = prompt.includes("sample-file")
			? "file"
			: prompt.includes("sample-video")
				? "video"
				: prompt.includes("sample-audio")
					? "audio"
					: prompt.includes("sample-image")
						? "image"
						: undefined;
		if (kind) {
			const videoPath = resolve(stateDir, "fixture-video.mp4");
			if (kind === "video" && !existsSync(videoPath))
				throw new Error(
					"Generate fixture-video.mp4 before the video scenario.",
				);
			const bytes =
				kind === "video"
					? readFileSync(videoPath)
					: kind === "image"
						? readFileSync(resolve(root, "apps/mobile/assets/icon.png"))
						: kind === "audio"
							? fixtureTone()
							: Buffer.from(
									"Cline native fixture: safe generated file contents.\n",
								);
			const mediaType = {
				image: "image/png",
				audio: "audio/wav",
				video: "video/mp4",
				file: "text/plain",
			}[kind];
			const name = {
				image: "fixture.png",
				audio: "fixture-tone.wav",
				video: "fixture-video.mp4",
				file: "fixture-result.txt",
			}[kind];
			this.emitExtra(input.sessionId, {
				type: "content_end",
				contentType: "media",
				media: {
					id: `native-${crypto.randomUUID()}`,
					modality: kind,
					mediaType,
					name,
					source: { type: "base64", data: bytes.toString("base64") },
				},
			});
			this.enqueue({
				steps: [
					{ kind: "text", chunks: [`${kind.toUpperCase()}_FIXTURE_READY`] },
				],
			});
			return ScriptedRuntimeHost.prototype.runTurn.call(this, input);
		}

		return super.runTurn(input);
	}
}
const runtime = new NativeFixtureHost({
	workspaceRoot: "/native-fixture",
	providerId: "cline",
	modelId: "anthropic/claude-sonnet-4-6",
	approvals: "wait-for-respond",
});
const hub = await startHubWebSocketServer({
	host: "127.0.0.1",
	port: 0,
	pathname: "/hub",
	pairing: false,
	owner: {
		ownerId: "native-fixture",
		discoveryPath: resolve(stateDir, "discovery.json"),
	},
	sessionHost: runtime,
	runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
	scheduleOptions: { dbPath: ":memory:" },
	eventLog: { dbPath: ":memory:" },
	runQueue: { dbPath: ":memory:" },
	sessionSearchOptions: { dbPath: ":memory:" },
	taskOptions: {
		dbPath: ":memory:",
		globalSpecsDir: resolve(stateDir, "tasks"),
		watchFiles: false,
	},
});
const observer = new HubClient({
	url: hub.url,
	authMode: "hub-subprotocol",
	credential: hub.authToken,
	clientId: "native-fixture-observer",
	clientType: "native-fixture",
});
await observer.connect();
observer.subscribe((event: unknown) => record("hub-event", event));
let approved = existsSync(resolve(stateDir, "authorized"));
let historyError = false;
let hydrateError = false;
let abortError = false;
const faults = new FixtureFaults();
const fixtureAccounts = new FixtureAccounts({
	faults,
	record,
	sleep: (milliseconds) => Bun.sleep(milliseconds),
});
const pendingUntil = new Map<string, number>();
const rows: Record<string, unknown>[] = [];
let nextWorkspaceId = 0;
const restorePath = process.env.FIXTURE_RESTORE_PATH;
if (restorePath && existsSync(restorePath)) {
	const saved = JSON.parse(readFileSync(restorePath, "utf8"));
	for (const entry of saved.entries ?? []) {
		const row = entry.row;
		const taskId = row.metadata.taskId;
		await runtime.startSession({
			config: {
				sessionId: taskId,
				providerId: "cline",
				modelId: row.metadata.modelId,
				mode: "act",
				workspaceRoot: "/native-fixture",
			},
		});
		runtime.uxHistory.set(taskId, entry.messages);
		rows.push(row);
		nextWorkspaceId = Math.max(
			nextWorkspaceId,
			Number(String(row.id).split("-").at(-1)) || 0,
		);
	}
	record("fixture-state-restored", { count: rows.length });
}
const json = (body: unknown, status = 200) => Response.json(body, { status });
const auth = (request: Request) =>
	request.headers.get("authorization") === `Bearer workos:${token}`;
const server = Bun.serve({
	hostname: "127.0.0.1",
	port,
	// Controlled responses can wait up to 60s without sending bytes.
	idleTimeout: 75,
	async fetch(request, server) {
		const url = new URL(request.url),
			path = url.pathname;
		if (path === "/health") return json({ ok: true, fixture: true, base });
		if (path.startsWith("/control/")) {
			if (request.headers.get("x-fixture-key") !== controlKey)
				return json({ error: "fixture control key required" }, 403);
			const action = path.slice(9);
			const scope = url.searchParams.get("id") || "global";
			if (action === "set") {
				try {
					faults.set(
						scope,
						url.searchParams.get("fault") || "",
						Number(url.searchParams.get("value") ?? 1),
					);
				} catch (error) {
					return json({ error: String(error) }, 400);
				}
				return json({ ok: true, faults: faults.view() });
			}
			if (action === "clear") {
				faults.clear(scope);
				return json({ ok: true, faults: faults.view() });
			}
			if (action === "state") return json({ rows, faults: faults.view() });
			if (action === "sdk-profile" || action === "sdk-release") {
				const row = rows.find((row) => row.id === scope);
				if (!row || scope === "global")
					return json(
						{ error: "An exact fixture workspace id is required." },
						400,
					);
				const taskId = (row.metadata as { taskId: string }).taskId;
				if (action === "sdk-release" && !runtime.sdkProfiles.release(taskId))
					return json(
						{ error: "No SDK profile gate is waiting for this workspace." },
						409,
					);
				return json({
					phase: runtime.sdkProfiles.phases.get(taskId),
					provenance: SDK_PROFILE_PROVENANCE,
				});
			}
			if (action === "snapshot") {
				const entries = await Promise.all(
					rows.map(async (row) => ({
						row,
						messages: await runtime.readSessionMessages(
							(row.metadata as { taskId: string }).taskId,
						),
					})),
				);
				writeFileSync(
					resolve(stateDir, "restore.json"),
					JSON.stringify({ entries }, null, 2),
					{ mode: 0o600 },
				);
				return json({ ok: true, count: entries.length });
			}
			if (action === "release") {
				const selected =
					scope === "global" ? rows : rows.filter((row) => row.id === scope);
				for (const row of selected)
					runtime.releaseGate(
						`native-queue-${(row.metadata as { taskId: string }).taskId}`,
					);
			}
			if (action === "archive" || action === "resume") {
				const row = url.searchParams.get("id")
					? rows.find((row) => row.id === url.searchParams.get("id"))
					: rows[0];
				if (!row) return json({ error: "No fixture workspace exists" }, 404);
				row.status = action === "archive" ? "stopped" : "running";
			}
			if (action === "history-error")
				historyError = url.searchParams.get("enabled") !== "0";
			if (action === "hydrate-error")
				hydrateError = url.searchParams.get("enabled") !== "0";
			if (action === "abort-error")
				abortError = url.searchParams.get("enabled") !== "0";
			if (
				scope !== "global" &&
				["history-error", "hydrate-error", "abort-error"].includes(action)
			) {
				faults.set(
					scope,
					action,
					url.searchParams.get("enabled") === "0" ? 0 : 1,
				);
				if (action === "history-error") historyError = false;
				if (action === "hydrate-error") hydrateError = false;
				if (action === "abort-error") abortError = false;
			}
			if (action === "events") return json(events);
			return json({ ok: true, historyError, hydrateError, abortError });
		}
		if (path === "/verify") {
			approved = true;
			writeFileSync(
				resolve(stateDir, "authorized"),
				"fixture browser authorization completed\n",
			);
			return new Response(
				"<h1>Cline simulator fixture signed in</h1><p>Return to the Cline E2E app.</p>",
				{ headers: { "content-type": "text/html" } },
			);
		}
		if (
			path === "/user_management/authorize/device" &&
			faults.get("global", "auth-authorize-error")
		)
			return json({ error: "Fixture device authorization unavailable" }, 503);
		if (path === "/user_management/authorize/device")
			return json({
				device_code: "fixture-device",
				user_code: "E2E-ONLY",
				verification_uri: `${base}/verify`,
				verification_uri_complete: `${base}/verify`,
				expires_in: 900,
				interval: 1,
			});
		if (
			path === "/user_management/authenticate" &&
			faults.get("global", "auth-expired")
		)
			return json(
				{
					error: "expired_token",
					error_description: "Fixture sign-in code expired",
				},
				400,
			);
		if (
			path === "/user_management/authenticate" &&
			faults.get("global", "auth-error")
		)
			return json(
				{
					error: "server_error",
					error_description: "Fixture sign-in temporarily unavailable",
				},
				503,
			);
		if (path === "/user_management/authenticate")
			return approved && !faults.get("global", "auth-pending")
				? json({
						access_token: "fixture-workos",
						refresh_token: "fixture-workos-refresh",
						token_type: "Bearer",
					})
				: json({ error: "authorization_pending" }, 400);
		if (path === "/api/v1/auth/register" || path === "/api/v1/auth/refresh")
			return json({
				success: true,
				data: {
					accessToken: token,
					refreshToken: "fixture-refresh",
					tokenType: "Bearer",
					expiresAt: new Date(Date.now() + 86400000).toISOString(),
					userInfo: {
						subject: "fixture-user",
						email: "simulator@example.invalid",
						name: "Native Fixture",
						clineUserId: "fixture-account",
						accounts: [],
					},
				},
			});
		if (
			path === "/api/v1/ai/cline/models" &&
			faults.get("global", "models-error")
		)
			return json({ error: "Fixture models unavailable" }, 503);
		if (path === "/api/v1/ai/cline/models")
			return json({
				data: [
					{
						id: "anthropic/claude-sonnet-4-6",
						name: "Fixture Sonnet",
						supported_parameters: ["reasoning"],
						architecture: { input_modalities: ["text", "image"] },
					},
					{
						id: "anthropic/claude-sonnet-4-6-mini",
						name: "Fixture Fast (no thinking)",
						supported_parameters: [],
						architecture: { input_modalities: ["text"] },
					},
				],
			});
		if (path === "/api/v1/ai/cline/recommended-models")
			return json({
				recommended: [
					{ id: "anthropic/claude-sonnet-4-6", name: "Fixture Sonnet" },
				],
			});
		if (!auth(request))
			return json(
				{ success: false, error: "Isolated fixture identity required" },
				401,
			);
		const accountResponse = await fixtureAccounts.handle(request);
		if (accountResponse) return accountResponse;
		if (path === "/api/v1/session" && request.method === "GET") {
			const scopedRows = await fixtureSessionList({
				rows,
				organizationId: url.searchParams.get("organizationId") || undefined,
				faults,
				sleep: (milliseconds) => Bun.sleep(milliseconds),
			});
			return historyError || faults.get("global", "list-error")
				? json({ success: false, error: "Fixture history unavailable" }, 503)
				: json({
						success: true,
						data: faults.get("global", "list-empty") ? [] : scopedRows,
					});
		}
		if (path === "/api/v1/session" && request.method === "POST") {
			await Bun.sleep(faults.get("global", "create-delay-ms"));
			if (faults.get("global", "create-error"))
				return json(
					{
						success: false,
						error: "Fixture rejected create before acceptance",
					},
					503,
				);
			const body = await request.json();
			const id = `fixture-workspace-${String(++nextWorkspaceId).padStart(8, "0")}`;
			const taskId = `fixture-task-${String(nextWorkspaceId).padStart(8, "0")}`;
			rows.unshift({
				id,
				status: "running",
				sandboxType: "resumable",
				title: body.title || "Native fixture conversation",
				...(typeof body.organizationId === "string" && body.organizationId
					? { organizationId: body.organizationId }
					: {}),
				metadata: {
					taskId,
					modelId: body.modelId || "anthropic/claude-sonnet-4-6",
					sandboxType: "resumable",
				},
				repoContext: {
					repoUrl: body.repoUrl || "https://github.com/fixture/native-fixture",
					branch: body.branch || "main",
				},
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			});
			record("workspace-created", { id, taskId });
			const pending = faults.get("global", "create-pending-ms");
			if (pending) {
				rows[0].status = "provisioning";
				pendingUntil.set(id, Date.now() + pending);
			}
			if (faults.get("global", "create-ambiguous"))
				return json(
					{
						success: false,
						error: "Fixture accepted create but acknowledgement was lost",
					},
					503,
				);
			return json({
				success: true,
				data: { sessionId: id, status: rows[0].status },
			});
		}
		const archive = path.match(/^\/api\/v1\/session\/([^/]+)\/history$/);
		if (archive) {
			const row = rows.find((row) => row.id === archive[1]);
			if (!row) return json({ error: "No fixture workspace exists" }, 404);
			if (faults.get(String(row.id), "history-error"))
				return json({ error: "Fixture archive unavailable" }, 503);
			const taskId = (row.metadata as { taskId: string }).taskId;
			return json({
				version: 1,
				messages: await runtime.readSessionMessages(taskId),
			});
		}
		const match = path.match(
			/^\/api\/v1\/session\/([^/]+)(?:\/(status|resume|suspend))?$/,
		);
		if (match) {
			const row = rows.find((row) => row.id === match[1]);
			if (!row)
				return json({ success: false, error: "Unknown fixture session" }, 404);
			if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
				if (
					server.upgrade(request, {
						data: { pending: [], upstream: undefined, workspaceId: row.id },
					})
				)
					return;
				return json({ error: "upgrade failed" }, 400);
			}
			if (
				pendingUntil.has(String(row.id)) &&
				Date.now() >= pendingUntil.get(String(row.id))!
			) {
				row.status = "running";
				pendingUntil.delete(String(row.id));
			}
			await holdFixtureWorkspaceMutation({
				faults,
				id: String(row.id),
				method: request.method,
				action: match[2],
				record,
				sleep: (milliseconds) => Bun.sleep(milliseconds),
			});
			// A second delayed DELETE must never splice a different row at index -1.
			if (!rows.includes(row))
				return json({ success: false, error: "Unknown fixture session" }, 404);
			const fault = match[2]
				? `${match[2]}-error`
				: request.method === "PATCH"
					? "rename-error"
					: request.method === "DELETE"
						? "delete-error"
						: "details-error";
			if (match[2] === "status" && request.method === "GET") {
				const authenticationFailure = fixtureStatusAuthenticationFailure(
					faults,
					String(row.id),
				);
				if (authenticationFailure) return authenticationFailure;
			}
			if (faults.get(String(row.id), fault))
				return json({ success: false, error: `Fixture ${fault}` }, 503);
			if (match[2] === "suspend" || match[2] === "resume") {
				const dto = fixtureLifecycleDto(
					row as { id: unknown; status: unknown },
					match[2],
				);
				record(`workspace-${match[2]}`, { id: row.id });
				return json({
					success: true,
					data: dto,
				});
			}
			if (request.method === "DELETE") {
				rows.splice(rows.indexOf(row), 1);
				await ScriptedRuntimeHost.prototype.deleteSession.call(
					runtime,
					(row.metadata as { taskId: string }).taskId,
				);
				record("fixture-workspace-deleted", { id: row.id });
				return new Response(null, { status: 204 });
			}
			if (request.method === "PATCH") {
				Object.assign(row, await request.json());
				return json({ success: true, data: row });
			}
			if (match[2])
				return json({
					success: true,
					data: { sessionId: row.id, status: row.status },
				});
			return json({ success: true, data: row });
		}
		record("unhandled-http", {
			method: request.method,
			path,
			query: url.search,
		});
		return json({ error: `Fixture endpoint not implemented: ${path}` }, 404);
	},
	websocket: {
		open(socket) {
			const upstream = new WebSocket(hub.url, [
				`cline-hub-auth.${hub.authToken}`,
			]);
			socket.data.upstream = upstream;
			upstream.onopen = () => {
				for (const message of socket.data.pending) upstream.send(message);
				socket.data.pending = [];
			};
			upstream.onmessage = (event) => {
				if (faults.get(String(socket.data.workspaceId), "drop-replies")) return;
				socket.send(
					typeof event.data === "string"
						? event.data
						: new Uint8Array(event.data),
				);
			};
			upstream.onclose = () => socket.close();
			upstream.onerror = () => socket.close(1011, "Fixture upstream failure");
		},
		message(socket, message) {
			const text =
				typeof message === "string"
					? message
					: new TextDecoder().decode(message);
			try {
				const frame = JSON.parse(text),
					envelope = frame.envelope;
				if (
					frame.kind === "command" &&
					envelope &&
					((hydrateError && envelope.command === "session.messages") ||
						(abortError && envelope.command === "run.abort") ||
						(commandFault(envelope.command) &&
							faults.get(
								String(socket.data.workspaceId),
								commandFault(envelope.command)!,
							)))
				) {
					socket.send(
						JSON.stringify({
							kind: "reply",
							envelope: {
								version: "v1",
								requestId: envelope.requestId,
								ok: false,
								error: {
									code: "fixture_failure",
									message: `Fixture rejected ${envelope.command}`,
								},
							},
						}),
					);
					record("injected-command-error", envelope.command);
					return;
				}
			} catch {}
			const upstream = socket.data.upstream;
			if (upstream?.readyState === WebSocket.OPEN) upstream.send(text);
			else socket.data.pending.push(text);
		},
		close(socket) {
			socket.data.upstream?.close();
		},
	},
});
const config = { base, port, stateDir, controlKey, token, hubUrl: hub.url };
writeFileSync(
	resolve(stateDir, "config.json"),
	JSON.stringify(config, null, 2),
	{ mode: 0o600 },
);
console.log(
	JSON.stringify({
		fixtureBase: base,
		stateDir,
		configPath: resolve(stateDir, "config.json"),
	}),
);
process.on("SIGTERM", async () => {
	server.stop(true);
	observer.close();
	await hub.close();
	process.exit(0);
});
