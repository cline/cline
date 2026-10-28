/** Real Hub transport/projector + SDK PendingPromptsController. Only agent work
 * is scripted. The narrow host adapter supplies the same busy/abort/drain seam
 * as LocalRuntimeHost; it never invents queue payloads or queue event ordering.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HubClient } from "@cline/hub-client";
import { ScriptedRuntimeHost } from "@cline/hub-testkit";
import { afterEach, expect, it } from "vitest";
import { createLocalSessionHandle } from "../connection/local-handle";
import { waitFor } from "./__testing__/test-hub-handle";
import { SessionConnection } from "./session-connection";
const root = resolve(
	fileURLToPath(new URL("../../../../", import.meta.url).href),
);
const { PendingPromptsController } = await import(
	resolve(
		root,
		"sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts",
	)
);
const { startHubWebSocketServer, createLocalHubScheduleRuntimeHandlers } =
	await import("@cline/core/hub");
class QueuedRuntime extends ScriptedRuntimeHost {
	private queueStates = new Map<string, any>();
	private coreListeners = new Set<(event: any) => void>();
	private state(sessionId: string) {
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
					notifyPendingUserMessage: () => {},
				},
			};
			this.queueStates.set(sessionId, state);
		}
		return state;
	}
	private emitCore(event: any) {
		for (const listener of this.coreListeners) listener(event);
	}
	private controller = new PendingPromptsController({
		getSession: (id: string) => this.state(id),
		emit: (event: any) => this.emitCore(event),
		send: (input: any) => this.runTurn(input),
	});
	pendingPrompts = {
		list: async ({ sessionId }: any) => this.controller.list(sessionId),
		update: async (input: any) => this.controller.update(input),
		delete: async (input: any) => this.controller.delete(input),
		steerFirst: async ({ sessionId }: any) =>
			this.controller.steerFirst(sessionId),
	};
	override subscribe(listener: (event: any) => void) {
		this.coreListeners.add(listener);
		const off = super.subscribe(listener);
		return () => {
			this.coreListeners.delete(listener);
			off();
		};
	}
	override async getSession(id: string) {
		const session = await super.getSession(id);
		const state = this.state(id);
		return session
			? { ...session, status: state.busy ? "running" : state.status }
			: undefined;
	}
	override async runTurn(input: any): Promise<any> {
		const state = this.state(input.sessionId);
		if (state.busy || input.delivery === "queue") {
			this.controller.enqueue(input.sessionId, { ...input, delivery: "queue" });
			return;
		}
		state.busy = true;
		state.status = "running";
		let result: any;
		try {
			result = await super.runTurn(input);
			return result;
		} finally {
			state.busy = false;
			state.aborting = false;
			state.status =
				result?.finishReason === "aborted"
					? "cancelled"
					: result?.finishReason === "error" || !result
						? "failed"
						: "completed";
			this.emitCore({
				type: "ended",
				payload: {
					sessionId: input.sessionId,
					reason: result?.finishReason ?? "error",
				},
			});
			if (result && result.finishReason !== "error")
				queueMicrotask(() => {
					void this.controller.drain(input.sessionId);
				});
		}
	}
	override async abort(id: string, reason?: unknown) {
		const state = this.state(id);
		state.aborting = true;
		if (state.drainingPendingPrompts) this.controller.discardQueue(state);
		await super.abort(id, reason);
	}
}
const connections: SessionConnection[] = [];
const clients: HubClient[] = [];
let server: any, scratch: string;
afterEach(async () => {
	for (const connection of connections.splice(0)) connection.dispose();
	for (const client of clients.splice(0)) client.close();
	await server?.close();
	server = undefined;
	if (scratch) await rm(scratch, { recursive: true, force: true });
});
async function setup() {
	const runtime = new QueuedRuntime({ workspaceRoot: "/queue-contract" });
	scratch = await mkdtemp(join(tmpdir(), "mobile-cross-client-queue-"));
	server = await startHubWebSocketServer({
		host: "127.0.0.1",
		port: 0,
		pathname: "/hub",
		pairing: false,
		owner: {
			ownerId: "queue-contract",
			discoveryPath: join(scratch, "discovery.json"),
		},
		sessionHost: runtime as never,
		runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		scheduleOptions: { dbPath: ":memory:" },
		eventLog: { dbPath: ":memory:" },
		runQueue: { dbPath: ":memory:" },
		sessionSearchOptions: { dbPath: ":memory:" },
		taskOptions: {
			dbPath: ":memory:",
			globalSpecsDir: join(scratch, "tasks"),
			watchFiles: false,
		},
	});
	const first = new SessionConnection({
		handle: await createLocalSessionHandle({
			url: server.url,
			authToken: server.authToken,
			createNewSession: true,
			providerId: "testkit",
			modelId: "testkit-model",
		}),
	});
	connections.push(first);
	await first.start();
	const sessionId = await first.handle.ensureSession();
	const second = new SessionConnection({
		handle: await createLocalSessionHandle({
			url: server.url,
			authToken: server.authToken,
			hubSessionId: sessionId,
		}),
	});
	connections.push(second);
	await second.start();
	const desktop = new HubClient({
		url: server.url,
		authMode: "hub-subprotocol",
		credential: server.authToken,
		clientType: "desktop-parity",
	});
	clients.push(desktop);
	await desktop.connect();
	await desktop.command("session.attach", { sessionId }, sessionId);
	const enqueue = (prompt: string) =>
		desktop.command("session.send_input", { sessionId, prompt }, sessionId);
	return { runtime, first, second, sessionId, desktop, enqueue };
}
const hasUser = (connection: SessionConnection, text: string) =>
	connection
		.getView()
		.messages.filter(
			(message) =>
				message.role === "user" &&
				message.blocks.some(
					(block) => block.kind === "text" && block.text === text,
				),
		).length;
it("synchronizes cross-client queue edits/removal and submits only the edited text once", async () => {
	const { runtime, first, second, enqueue } = await setup();
	runtime.enqueue([
		{ kind: "text", chunks: ["First answer"] },
		{ kind: "gate", id: "finish-first" },
	]);
	runtime.enqueue([{ kind: "text", chunks: ["Edited queued answer"] }]);
	const original = first.sendInput("original active ask");
	await waitFor(() => first.getView().runStatus === "running", "original run");
	expect((await enqueue("old queued text")).payload?.result).toBeUndefined();
	await waitFor(
		() =>
			first.getView().pendingPrompts.length === 1 &&
			second.getView().pendingPrompts.length === 1,
		"queue on both phones",
	);
	const editedId = second.getView().pendingPrompts[0].id;
	await second.updatePendingPrompt(editedId, {
		prompt: "edited on second phone",
	});
	await waitFor(
		() =>
			first.getView().pendingPrompts[0]?.prompt === "edited on second phone",
		"cross-client edit",
	);
	await enqueue("remove this queued ask");
	await waitFor(
		() => second.getView().pendingPrompts.length === 2,
		"second queued entry",
	);
	await first.removePendingPrompt(
		second.getView().pendingPrompts.find((prompt) => prompt.id !== editedId)!
			.id,
	);
	await waitFor(
		() => second.getView().pendingPrompts.length === 1,
		"cross-client removal",
	);
	runtime.releaseGate("finish-first");
	await original;
	await waitFor(
		() =>
			first.getView().runStatus === "completed" &&
			second.getView().runStatus === "completed" &&
			hasUser(first, "edited on second phone") === 1 &&
			hasUser(second, "edited on second phone") === 1,
		"edited queued turn convergence",
	);
	expect(first.getView().pendingPrompts).toEqual([]);
	expect(second.getView().pendingPrompts).toEqual([]);
	expect(hasUser(first, "old queued text")).toBe(0);
	expect(hasUser(second, "remove this queued ask")).toBe(0);
});
it("aborting a queue-initiated active turn clears the remaining shared queue on both phones", async () => {
	const { runtime, first, second, enqueue } = await setup();
	runtime.enqueue([
		{ kind: "text", chunks: ["Original answer"] },
		{ kind: "gate", id: "finish-original" },
	]);
	runtime.enqueue([
		{ kind: "text", chunks: ["Queued active answer"] },
		{ kind: "abortable-stall" },
	]);
	runtime.enqueue([{ kind: "text", chunks: ["Must never run"] }]);
	const original = first.sendInput("initial ask");
	await waitFor(() => first.getView().runStatus === "running", "initial run");
	await enqueue("queued active ask");
	await enqueue("queued remainder");
	runtime.releaseGate("finish-original");
	await original;
	await waitFor(
		() =>
			hasUser(second, "queued active ask") === 1 &&
			second
				.getView()
				.pendingPrompts.some((prompt) => prompt.prompt === "queued remainder"),
		"queue-initiated active run",
	);
	await second.abort("Stop queued work");
	await waitFor(
		() =>
			first.getView().runStatus === "aborted" &&
			second.getView().runStatus === "aborted" &&
			first.getView().pendingPrompts.length === 0 &&
			second.getView().pendingPrompts.length === 0,
		"stop clears remainder across phones",
	);
	await Promise.all([first.resync(), second.resync()]);
	expect(first.getView().pendingPrompts).toEqual([]);
	expect(second.getView().pendingPrompts).toEqual([]);
	expect(hasUser(first, "queued remainder")).toBe(0);
	expect(hasUser(second, "queued remainder")).toBe(0);
});
it("preserves queued input when the original user-initiated turn is stopped and then drains it", async () => {
	const { runtime, first, second, enqueue } = await setup();
	runtime.enqueue([
		{ kind: "text", chunks: ["Original running answer"] },
		{ kind: "abortable-stall" },
	]);
	runtime.enqueue([{ kind: "text", chunks: ["Surviving queued answer"] }]);
	const original = first.sendInput("original direct ask");
	await waitFor(
		() => first.getView().runStatus === "running",
		"original direct run",
	);
	await enqueue("keep this already-queued ask");
	await waitFor(
		() => second.getView().pendingPrompts.length === 1,
		"queued ask before original Stop",
	);
	await second.abort("Stop only the original response");
	await original;
	await waitFor(
		() =>
			first.getView().runStatus === "completed" &&
			second.getView().runStatus === "completed" &&
			hasUser(first, "keep this already-queued ask") === 1 &&
			hasUser(second, "keep this already-queued ask") === 1,
		"SDK preserves and drains already-queued work",
	);
	expect(first.getView().pendingPrompts).toEqual([]);
	expect(second.getView().pendingPrompts).toEqual([]);
});
