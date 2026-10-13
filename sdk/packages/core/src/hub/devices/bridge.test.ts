import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { HubEventEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket as NodeWebSocket } from "ws";
import {
	type BridgeOptions,
	DeviceBridge,
	type DeviceSocket,
	type HubPort,
} from "./bridge";
import { DeviceRegistry } from "./pairing";
import { startDeviceServer } from "./server";

class FakeHub implements HubPort {
	async browse(
		request: import("@cline/device").BrowseRequest,
		_context: import("@cline/device").DeviceContext,
	) {
		return {
			t: "browse" as const,
			id: request.id,
			title: request.kind,
			page: 0,
			more: false,
			items: [],
		};
	}
	listeners = new Set<(e: HubEventEnvelope) => void>();
	conn = new Set<(online: boolean) => void>();
	calls: string[] = [];
	subscribe(l: (e: HubEventEnvelope) => void) {
		this.listeners.add(l);
		return () => this.listeners.delete(l);
	}
	onConnectionChange(l: (online: boolean) => void) {
		this.conn.add(l);
		return () => this.conn.delete(l);
	}
	emit(
		event: string,
		sessionId?: string,
		payload: Record<string, unknown> = {},
	) {
		for (const l of this.listeners)
			l({ version: "v1", event, sessionId, payload } as HubEventEnvelope);
	}
	online() {
		for (const l of this.conn) l(true);
	}
	async respondApproval(id: string, ok: boolean) {
		this.calls.push(`${ok ? "approve" : "deny"}:${id}`);
	}
	async abort(s: string) {
		this.calls.push(`abort:${s}`);
	}
	async sendFollowup(s: string, p: string) {
		this.calls.push(`followup:${s}:${p}`);
	}
	/** Emit the run's start before startTask resolves, like the real hub. */
	startEmitsRun = false;
	async startCloudTask(p: string, ws?: string) {
		this.calls.push(`cloud:${p}@${ws}`);
		return "ses-cloud";
	}
	async startTask(
		p: string,
		ws?: string,
		_context?: import("@cline/device").DeviceContext,
	) {
		this.calls.push(ws ? `start:${p}@${ws}` : `start:${p}`);
		if (this.startEmitsRun) this.emit("run.started", "new-session");
		return "new-session";
	}
}

let cleanup: Array<() => void> = [];
afterEach(async () => {
	for (const c of cleanup) await c();
	cleanup = [];
});

async function setup(
	transcript = "run the tests",
	options: {
		devicesChanged?: BridgeOptions["devicesChanged"];
		heartbeat?: { intervalMs: number; timeoutMs: number };
	} = {},
) {
	const hub = new FakeHub();
	const registry = new DeviceRegistry(
		join(mkdtempSync(join(tmpdir(), "device-")), "d.json"),
	);
	const wavs: Uint8Array[] = []; // concatenated PCM per recording
	const bridge = new DeviceBridge({
		devicesChanged: options.devicesChanged,
		hub,
		registry,
		cancelWindowMs: 50,
		transcribe: () => {
			const chunks: Uint8Array[] = [];
			return {
				push: (pcm) => chunks.push(pcm),
				finish: async () => {
					wavs.push(Buffer.concat(chunks));
					return transcript;
				},
				cancel: () => {},
			};
		},
	});
	hub.online();
	const server = await startDeviceServer({
		heartbeat: options.heartbeat,
		bridge,
		port: 0,
		hostname: "127.0.0.1",
	});
	cleanup.push(
		() => server.stop(),
		() => bridge.dispose(),
	);
	const inbox: any[] = [];
	const waiters: Array<() => void> = [];
	const ws = new WebSocket(`ws://127.0.0.1:${server.port}/device`);
	ws.onmessage = (m) => {
		inbox.push(JSON.parse(String(m.data)));
		for (const w of waiters.splice(0)) w();
	};
	await new Promise((r) => (ws.onopen = r));
	cleanup.push(() => ws.close());
	const next = async (pred: (m: any) => boolean) => {
		for (;;) {
			const i = inbox.findIndex(pred);
			if (i >= 0) return inbox.splice(i, 1)[0];
			await Promise.race([
				new Promise<void>((r) => waiters.push(r)),
				delay(1000).then(() => {
					throw new Error(`timeout; inbox=${JSON.stringify(inbox)}`);
				}),
			]);
		}
	};
	const send = (m: object) => ws.send(JSON.stringify(m));
	const pair = async () => {
		send({ t: "pair", code: registry.issueCode().code, name: "desk" });
		return (await next((m) => m.t === "paired")).token as string;
	};
	return { hub, ws, send, next, pair, wavs, registry, server, bridge };
}

describe("DeviceBridge", () => {
	it("replaces a reconnecting device, ignores its old socket, and distinguishes identical names", async () => {
		const events: Array<{ type: string; name: string }> = [];
		const { pair, bridge, registry } = await setup("", {
			devicesChanged: (event) => events.push(event),
		});
		const token = await pair();
		const socket: DeviceSocket = {
			data: { authed: false },
			send: vi.fn(),
			close: vi.fn(),
		};
		await bridge.onMessage(socket, JSON.stringify({ t: "hello", token }));
		expect(bridge.connectedDevices()).toEqual(["desk"]);
		expect(events.map((event) => event.type)).toEqual([
			"connected",
			"disconnected",
			"connected",
		]);
		const replacement: DeviceSocket = {
			data: { authed: false },
			send: vi.fn(),
			close: vi.fn(),
		};
		await bridge.onMessage(replacement, JSON.stringify({ t: "hello", token }));
		expect(socket.close).toHaveBeenCalledWith(4000, "device reconnected");
		bridge.onClose(socket); // Delayed close must not remove the replacement or emit twice.
		await bridge.onMessage(socket, JSON.stringify({ t: "hello", token }));
		expect(bridge.connectedDevices()).toEqual(["desk"]);
		expect(events).toHaveLength(5);
		const otherToken = registry.pair(registry.issueCode().code, "desk")!;
		const other: DeviceSocket = {
			data: { authed: false },
			send: vi.fn(),
			close: vi.fn(),
		};
		await bridge.onMessage(
			other,
			JSON.stringify({ t: "hello", token: otherToken }),
		);
		expect(bridge.connectedDevices()).toEqual(["desk", "desk"]);
		bridge.onClose(replacement);
		bridge.onClose(replacement);
		expect(bridge.connectedDevices()).toEqual(["desk"]);
		expect(events).toHaveLength(7);
		expect(JSON.stringify(events)).not.toContain(token);
		bridge.onClose(other);
	});

	it("keeps responsive devices and removes a silent socket on its pong deadline", async () => {
		const { pair, bridge, server } = await setup("", {
			heartbeat: { intervalMs: 40, timeoutMs: 100 },
		});
		const token = await pair();
		await delay(180); // Several heartbeats on the responding client.
		expect(bridge.connectedDevices()).toEqual(["desk"]);
		const silent = new NodeWebSocket(`ws://127.0.0.1:${server.port}/device`, {
			autoPong: false,
		});
		cleanup.push(() => silent.terminate());
		await new Promise<void>((resolve, reject) => {
			silent.once("open", resolve);
			silent.once("error", reject);
		});
		const welcomed = new Promise<void>((resolve) =>
			silent.on("message", (data) => {
				if (JSON.parse(data.toString()).t === "welcome") resolve();
			}),
		);
		silent.send(JSON.stringify({ t: "hello", token }));
		await welcomed;
		expect(bridge.connectedDevices()).toEqual(["desk"]);
		await vi.waitFor(() => expect(bridge.connectedDevices()).toEqual([]));
	});
	it("routes to a selected idle session and carries device settings into new tasks", async () => {
		const { hub, pair, send, next } = await setup();
		await pair();
		const original = hub.browse.bind(hub);
		hub.browse = async (request, context) => {
			if (request.select) {
				if (request.kind === "sessions") context.session = request.key;
				else {
					context.workspace = "/chosen";
					context.model = { provider: "test", model: "chosen" };
					delete context.session;
				}
			}
			return {
				...(await original(request, context)),
				selected: request.select,
			};
		};
		hub.emit("run.started", "other-running-task");
		send({
			t: "browse",
			id: "select",
			kind: "sessions",
			key: "idle-session",
			select: true,
		});
		expect(await next((m) => m.t === "browse")).toMatchObject({
			id: "select",
			selected: true,
		});
		send({ t: "prompt", id: "resume", text: "Continue this task" });
		expect(await next((m) => m.t === "prompt")).toMatchObject({
			session: "idle-session",
			target: "followup",
		});
		expect(hub.calls).toContain("followup:idle-session:Continue this task");
		send({
			t: "browse",
			id: "workspace",
			kind: "workspaces",
			key: "chosen",
			select: true,
		});
		await next((m) => m.t === "browse");
		let chosen: import("@cline/device").DeviceContext | undefined;
		hub.startTask = async (_prompt, _workspace, context) => {
			chosen = { ...context };
			return "new-chosen";
		};
		send({ t: "prompt", id: "create", text: "New work" });
		expect(await next((m) => m.t === "prompt")).toMatchObject({
			session: "new-chosen",
			target: "new",
		});
		expect(chosen).toEqual({
			workspace: "/chosen",
			model: { provider: "test", model: "chosen" },
		});
		send({ t: "prompt", id: "continue", text: "Continue new work" });
		expect(await next((m) => m.t === "prompt")).toMatchObject({
			session: "new-chosen",
			target: "followup",
		});
	});

	it("routes typed prompts locally, as follow-ups, as new tasks, and to cloud", async () => {
		const { hub, pair, send, next, wavs } = await setup();
		await pair();
		hub.emit("session.created", "s1", {
			session: { workspaceRoot: "/code/app" },
		});
		send({ t: "prompt", id: "1", text: '  print "hello"  ' });
		expect(await next((m) => m.t === "prompt" && m.id === "1")).toMatchObject({
			status: "submitted",
			target: "new",
		});
		hub.emit("run.started", "s1");
		send({ t: "prompt", id: "2", text: "continue" });
		expect(await next((m) => m.t === "prompt" && m.id === "2")).toMatchObject({
			target: "followup",
			session: "s1",
		});
		send({ t: "prompt", id: "3", text: "parallel task", target: "new" });
		expect(await next((m) => m.t === "prompt" && m.id === "3")).toMatchObject({
			target: "new",
		});
		send({ t: "prompt", id: "4", text: "cloud sessions: build it" });
		expect(await next((m) => m.t === "prompt" && m.id === "4")).toMatchObject({
			target: "cloud",
			session: "ses-cloud",
		});
		expect(hub.calls).toEqual([
			'start:print "hello"@/code/app',
			"followup:s1:continue",
			"start:parallel task@/code/app",
			"cloud:build it@/code/app",
		]);
		expect(wavs).toEqual([]);
	});
	it("returns typed errors and does not resubmit duplicate request IDs", async () => {
		const { hub, pair, send, next } = await setup();
		await pair();
		send({ t: "prompt", id: "1", text: "cloud session" });
		expect(await next((m) => m.t === "prompt")).toMatchObject({
			id: "1",
			status: "error",
		});
		hub.startTask = async () => {
			throw new Error("Hub unavailable");
		};
		send({ t: "prompt", id: "2", text: "test" });
		expect(await next((m) => m.t === "prompt")).toMatchObject({
			id: "2",
			status: "error",
			reason: "Hub unavailable",
		});
		let release!: (id: string) => void;
		hub.startTask = async (text) => {
			hub.calls.push(text);
			return new Promise((resolve) => {
				release = resolve;
			});
		};
		send({ t: "prompt", id: "3", text: "one task" });
		send({ t: "prompt", id: "3", text: "one task" });
		send({ t: "prompt", id: "4", text: "second task" });
		expect(await next((m) => m.t === "prompt" && m.id === "4")).toMatchObject({
			status: "error",
		});
		release("s-new");
		expect(await next((m) => m.t === "prompt" && m.id === "3")).toMatchObject({
			status: "submitted",
		});
		send({ t: "prompt", id: "3", text: "one task" });
		expect(await next((m) => m.t === "prompt" && m.id === "3")).toMatchObject({
			status: "submitted",
		});
		expect(hub.calls).toEqual(["one task"]);
	});
	it("keeps typed submission separate from an active voice recording", async () => {
		const { hub, pair, send, next } = await setup();
		await pair();
		send({ t: "voice_start" });
		await next((m) => m.state === "listening");
		send({ t: "prompt", id: "1", text: "run tests" });
		expect(await next((m) => m.t === "prompt")).toMatchObject({
			status: "error",
		});
		expect(hub.calls).toEqual([]);
		send({ t: "voice_cancel" });
		await next((m) => m.t === "voice" && m.status === "cancelled");
		send({ t: "prompt", id: "2", text: "run tests" });
		expect(await next((m) => m.t === "prompt" && m.id === "2")).toMatchObject({
			status: "submitted",
		});
	});
	it("requires authentication for typed prompts", async () => {
		const { hub, send, next } = await setup();
		send({ t: "prompt", id: "1", text: "test" });
		expect(await next((m) => m.t === "auth_error")).toBeTruthy();
		expect(hub.calls).toEqual([]);
	});
	it("rejects unauthenticated commands", async () => {
		const { send, next } = await setup();
		send({ t: "abort" });
		expect(await next((m) => m.t === "auth_error")).toMatchObject({
			reason: "not_authenticated",
		});
	});

	it("pairs, then accepts the token on reconnect", async () => {
		const { pair, next, registry, server } = await setup();
		const token = await pair();
		expect(await next((m) => m.t === "state")).toMatchObject({ state: "idle" });
		expect(registry.list()).toHaveLength(1);
		const ws2 = new WebSocket(`ws://127.0.0.1:${server.port}/device`);
		const got: any[] = [];
		ws2.onmessage = (m) => got.push(JSON.parse(String(m.data)));
		await new Promise((r) => (ws2.onopen = r));
		ws2.send(JSON.stringify({ t: "hello", token }));
		await delay(50);
		expect(got[0]).toMatchObject({ t: "welcome", name: "desk" });
		ws2.close();
	});

	it("streams state and relays approve/deny/abort", async () => {
		const { hub, pair, next, send } = await setup();
		await pair();
		await next((m) => m.t === "state");
		hub.emit("run.started", "s1");
		hub.emit("tool.started", "s1", {
			toolName: "bash",
			input: { command: "bun test" },
		});
		expect(await next((m) => m.t === "state" && m.tool)).toMatchObject({
			state: "working",
			tool: "bun test",
		});
		hub.emit("approval.requested", "s1", {
			approvalId: "a1",
			sessionId: "s1",
			toolName: "bash",
			inputJson: '{"command":"git push"}',
		});
		const waiting = await next((m) => m.state === "waiting");
		expect(waiting.approval).toEqual({ id: "a1", summary: "Run: git push" });
		send({ t: "approve", id: "a1" });
		send({ t: "deny", id: "a2" });
		send({ t: "abort" });
		await delay(30);
		expect(hub.calls).toEqual(["approve:a1", "deny:a2", "abort:s1"]);
	});

	it("pushes live counters without a stats request or device tap", async () => {
		const { hub, pair, next } = await setup();
		await pair();
		expect(await next((m) => m.t === "stats")).toMatchObject({
			sessions: 0,
			today: 0,
		});
		hub.emit("session.updated", "s1", { session: { status: "running" } });
		expect(await next((m) => m.t === "stats")).toMatchObject({
			sessions: 1,
			today: 1,
		});
		hub.emit("run.started", "s1");
		hub.emit("run.completed", "s1");
		expect(await next((m) => m.t === "stats")).toMatchObject({
			sessions: 0,
			today: 1,
		});
	});

	it("records, transcribes and starts a new task when idle", async () => {
		const { hub, pair, next, send, ws, wavs } = await setup();
		await pair();
		send({ t: "voice_start", rate: 16000, bits: 16, ch: 1 });
		expect(await next((m) => m.state === "listening")).toBeTruthy();
		for (let seq = 0; seq < 10; seq++) {
			const frame = new Uint8Array(2 + 2048);
			new DataView(frame.buffer).setUint16(0, seq, true);
			ws.send(frame);
		}
		send({ t: "voice_end" });
		const transcribed = await next(
			(m) => m.t === "voice" && m.status === "transcribed",
		);
		expect(transcribed).toMatchObject({ text: "run the tests", target: "new" });
		expect(
			await next((m) => m.state === "thinking" && m.transcript),
		).toBeTruthy();
		const submitted = await next(
			(m) => m.t === "voice" && m.status === "submitted",
		);
		expect(submitted).toMatchObject({ target: "new", session: "new-session" });
		expect(hub.calls).toEqual(["start:run the tests"]);
		expect(wavs[0].byteLength).toBe(10 * 2048); // streamed PCM, header stripped
	});

	it("shows working, not thinking, when the new task is already running", async () => {
		const { hub, pair, next, send, ws } = await setup("fix the build");
		hub.startEmitsRun = true;
		await pair();
		send({ t: "voice_start" });
		for (let i = 0; i < 4; i++) ws.send(new Uint8Array(2 + 4000));
		send({ t: "voice_end" });
		await next((m) => m.t === "voice" && m.status === "transcribed");
		send({ t: "voice_confirm" });
		await next((m) => m.t === "voice" && m.status === "submitted");
		const state = await next((m) => m.t === "state" && m.state === "working");
		expect(state.session).toBe("new-session");
	});

	it("starts a parallel task when the device asks for target new", async () => {
		const { hub, pair, next, send, ws } = await setup("write the changelog");
		await pair();
		hub.emit("session.created", "s1", {
			session: { workspaceRoot: "/code/app" },
		});
		hub.emit("run.started", "s1");
		send({ t: "voice_start", target: "new" });
		for (let i = 0; i < 4; i++) ws.send(new Uint8Array(2 + 4000));
		send({ t: "voice_end" });
		expect(
			await next((m) => m.t === "voice" && m.status === "transcribed"),
		).toMatchObject({ target: "new" });
		send({ t: "voice_confirm" });
		expect(
			await next((m) => m.t === "voice" && m.status === "submitted"),
		).toMatchObject({ target: "new", session: "new-session" });
		expect(hub.calls).toEqual(["start:write the changelog@/code/app"]);
	});

	it.each([
		{ speech: "Cloud session: fix the build", prompt: "fix the build" },
		{
			speech: "Cloud sessions, uh, update the built-in model list.",
			prompt: "uh, update the built-in model list.",
		},
	])("routes '$speech' to cloud even while local work runs", async ({
		speech,
		prompt,
	}) => {
		const { hub, pair, next, send, ws } = await setup(speech);
		await pair();
		hub.emit("session.created", "s1", {
			session: { workspaceRoot: "/code/app" },
		});
		hub.emit("run.started", "s1");
		send({ t: "voice_start" });
		for (let i = 0; i < 4; i++) ws.send(new Uint8Array(2 + 4000));
		send({ t: "voice_end" });
		expect(
			await next((m) => m.t === "voice" && m.status === "transcribed"),
		).toMatchObject({ target: "cloud", text: prompt });
		send({ t: "voice_confirm" });
		expect(
			await next((m) => m.t === "voice" && m.status === "submitted"),
		).toMatchObject({ target: "cloud", session: "ses-cloud" });
		expect(hub.calls).toEqual([`cloud:${prompt}@/code/app`]);
	});

	it.each([
		{ text: "CLOUD SESSION: Update Models", task: "Update Models" },
		{
			text: "cloud sessionization: update models",
			task: "ization: update models",
		},
		{ text: "cloud sessionship: update models", task: "hip: update models" },
	])("routes any '$text' prefix to cloud", async ({ text, task }) => {
		const { hub, pair, send, next } = await setup();
		await pair();
		hub.emit("session.created", "s1", {
			session: { workspaceRoot: "/code/app" },
		});
		send({ t: "prompt", id: "1", text });
		expect(await next((m) => m.t === "prompt")).toMatchObject({
			target: "cloud",
		});
		expect(hub.calls).toEqual([`cloud:${task}@/code/app`]);
	});

	it("keeps a cloud-session mention elsewhere as a regular task", async () => {
		const text = "Discuss cloud sessions";
		const { hub, pair, send, next } = await setup();
		await pair();
		send({ t: "prompt", id: "1", text });
		expect(await next((m) => m.t === "prompt")).toMatchObject({
			target: "new",
		});
		expect(hub.calls).toEqual([`start:${text}`]);
	});

	it("does not replace a new recording when cloud provisioning finishes", async () => {
		const { hub, pair, next, send, ws } = await setup(
			"cloud session, fix the build",
		);
		let finish!: (session: string) => void;
		hub.startCloudTask = async () =>
			await new Promise<string>((resolve) => {
				finish = resolve;
			});
		await pair();
		send({ t: "voice_start" });
		await next((m) => m.state === "listening");
		for (let i = 0; i < 4; i++) ws.send(new Uint8Array(2 + 4000));
		send({ t: "voice_end" });
		await next((m) => m.t === "voice" && m.status === "transcribed");
		send({ t: "voice_confirm" });
		send({ t: "voice_start" });
		await next((m) => m.state === "listening");
		finish("ses-cloud");
		await delay(10);
		send({ t: "voice_cancel" });
		expect(
			await next((m) => m.t === "voice" && m.status === "cancelled"),
		).toBeTruthy();
	});

	it("requires a task after the cloud session prefix", async () => {
		const { hub, pair, next, send, ws } = await setup("cloud session.");
		await pair();
		send({ t: "voice_start" });
		for (let i = 0; i < 4; i++) ws.send(new Uint8Array(2 + 4000));
		send({ t: "voice_end" });
		expect(
			await next((m) => m.t === "voice" && m.status === "error"),
		).toMatchObject({ text: 'Use "cloud session" followed by your task' });
		expect(hub.calls).toEqual([]);
	});

	it("starts new voice tasks in the most recent session's workspace", async () => {
		const { hub, pair, next, send, ws } = await setup("add a test");
		await pair();
		hub.emit("session.created", "s1", {
			session: { workspaceRoot: "/code/app" },
		});
		send({ t: "voice_start" });
		for (let i = 0; i < 4; i++) ws.send(new Uint8Array(2 + 4000));
		send({ t: "voice_end" });
		await next((m) => m.t === "voice" && m.status === "transcribed");
		send({ t: "voice_confirm" });
		await next((m) => m.t === "voice" && m.status === "submitted");
		expect(hub.calls).toEqual(["start:add a test@/code/app"]);
	});

	it("sends a follow-up to the active session and honours cancel", async () => {
		const { hub, pair, next, send, ws } = await setup("also update docs");
		await pair();
		hub.emit("run.started", "s1");
		const record = async () => {
			send({ t: "voice_start" });
			for (let i = 0; i < 4; i++) ws.send(new Uint8Array(2 + 4000));
			send({ t: "voice_end" });
			return next((m) => m.t === "voice" && m.status === "transcribed");
		};
		expect(await record()).toMatchObject({ target: "followup", session: "s1" });
		send({ t: "voice_cancel" });
		expect(
			await next((m) => m.t === "voice" && m.status === "cancelled"),
		).toBeTruthy();
		await delay(80);
		expect(hub.calls).toEqual([]);

		await record();
		send({ t: "voice_confirm" });
		expect(await next((m) => m.status === "submitted")).toMatchObject({
			target: "followup",
		});
		expect(hub.calls).toEqual(["followup:s1:also update docs"]);
	});

	it("rejects too-short recordings and unsupported formats", async () => {
		const { pair, next, send } = await setup();
		await pair();
		send({ t: "voice_start", rate: 44100 });
		expect(await next((m) => m.t === "voice")).toMatchObject({
			status: "error",
		});
		send({ t: "voice_start" });
		send({ t: "voice_end" });
		expect(await next((m) => m.t === "voice")).toMatchObject({
			status: "error",
			text: "too short",
		});
	});
});
