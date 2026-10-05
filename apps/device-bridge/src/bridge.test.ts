import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubEventEnvelope } from "@cline/shared";
import { DeviceBridge, type HubPort } from "./bridge";
import { DeviceRegistry } from "./pairing";
import { startDeviceServer } from "./server";

class FakeHub implements HubPort {
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
	async startTask(p: string, ws?: string) {
		this.calls.push(ws ? `start:${p}@${ws}` : `start:${p}`);
		if (this.startEmitsRun) this.emit("run.started", "new-session");
		return "new-session";
	}
}

let cleanup: Array<() => void> = [];
afterEach(() => {
	for (const c of cleanup) c();
	cleanup = [];
});

async function setup(transcript = "run the tests") {
	const hub = new FakeHub();
	const registry = new DeviceRegistry(
		join(mkdtempSync(join(tmpdir(), "pet-")), "d.json"),
	);
	const wavs: Uint8Array[] = []; // concatenated PCM per recording
	const bridge = new DeviceBridge({
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
	const server = startDeviceServer({ bridge, port: 0, hostname: "127.0.0.1" });
	cleanup.push(
		() => server.stop(true),
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
				Bun.sleep(1000).then(() => {
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
	return { hub, ws, send, next, pair, wavs, registry, server };
}

describe("DeviceBridge", () => {
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
		await Bun.sleep(50);
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
		await Bun.sleep(30);
		expect(hub.calls).toEqual(["approve:a1", "deny:a2", "abort:s1"]);
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
		await Bun.sleep(80);
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
