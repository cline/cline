import type { HubEventEnvelope } from "@cline/shared";
import type { ServerWebSocket } from "bun";
import type { DeviceRegistry } from "./pairing";
import {
	AUDIO_BITS,
	AUDIO_CHANNELS,
	AUDIO_FRAME_HEADER_BYTES,
	AUDIO_SAMPLE_RATE,
	type BridgeToDevice,
	clip,
	type DeviceToBridge,
	MAX_RECORDING_BYTES,
	PROTOCOL_VERSION,
	parseDeviceMessage,
	type VoiceTarget,
} from "./protocol";
import { PetStateProjector } from "./state";

const TRANSCRIPT_MAX = 120;
const HELLO_TIMEOUT_MS = 10_000;
const THINKING_TIMEOUT_MS = 30_000;
const MIN_RECORDING_BYTES = AUDIO_SAMPLE_RATE * 2 * 0.3; // 300 ms

/** The hub operations the bridge needs. Implemented over the hub client in main.ts. */
export interface HubPort {
	subscribe(listener: (event: HubEventEnvelope) => void): () => void;
	onConnectionChange(listener: (online: boolean) => void): () => void;
	respondApproval(approvalId: string, approved: boolean): Promise<void>;
	abort(sessionId: string): Promise<void>;
	sendFollowup(sessionId: string, prompt: string): Promise<void>;
	/**
	 * Start a new task. `recentWorkspace` is where the user last ran Cline,
	 * as observed from hub events; the implementation decides precedence.
	 */
	startTask(prompt: string, recentWorkspace?: string): Promise<string>;
}

/**
 * One live transcription, fed 16 kHz s16le mono PCM while the user talks.
 * `finish()` resolves with the final text once audio has ended.
 */
export interface TranscriptionStream {
	push(pcm: Uint8Array): void;
	finish(): Promise<string>;
	cancel(): void;
}

/** Starts a transcription when push-to-talk begins. */
export type Transcriber = () => TranscriptionStream;

export interface BridgeOptions {
	hub: HubPort;
	registry: DeviceRegistry;
	transcribe: Transcriber;
	/** Window in which the device can cancel a transcript before submission. */
	cancelWindowMs?: number;
	log?: (message: string) => void;
	now?: () => number;
}

export interface DeviceSocketData {
	authed: boolean;
	name?: string;
	helloTimer?: ReturnType<typeof setTimeout>;
}

type DeviceSocket = ServerWebSocket<DeviceSocketData>;

type VoiceSession =
	| {
			phase: "recording";
			owner: DeviceSocket;
			stream: TranscriptionStream;
			bytes: number;
			lastSeq: number;
			forceNew: boolean;
	  }
	| {
			phase: "transcribing";
			owner: DeviceSocket;
			stream: TranscriptionStream;
			forceNew: boolean;
	  }
	| {
			phase: "pending";
			owner: DeviceSocket;
			text: string;
			target: VoiceTarget;
			session?: string;
			timer: ReturnType<typeof setTimeout>;
	  };

/**
 * Translates between the hub event stream and compact device messages.
 * Owns no runtime state of its own beyond the projection and the voice buffer.
 */
export class DeviceBridge {
	private readonly devices = new Set<DeviceSocket>();
	private readonly projector: PetStateProjector;
	private voice?: VoiceSession;
	private lastSent = "";
	private transientTimer?: ReturnType<typeof setTimeout>;
	private thinkingTimer?: ReturnType<typeof setTimeout>;
	private readonly disposers: Array<() => void> = [];
	private readonly cancelWindowMs: number;
	private readonly log: (message: string) => void;

	constructor(private readonly options: BridgeOptions) {
		this.projector = new PetStateProjector(options.now);
		this.cancelWindowMs = options.cancelWindowMs ?? 3_000;
		this.log = options.log ?? (() => {});
		this.disposers.push(
			options.hub.subscribe((event) => {
				if (this.projector.apply(event)) this.broadcastState();
			}),
			options.hub.onConnectionChange((online) => {
				this.projector.setHubOnline(online);
				this.broadcastState();
			}),
		);
	}

	dispose(): void {
		for (const d of this.disposers) d();
		this.cancelVoice(false);
		clearTimeout(this.transientTimer);
		clearTimeout(this.thinkingTimer);
	}

	// ---- WebSocket handlers (wired to Bun.serve in server.ts) ---------------

	onOpen(ws: DeviceSocket): void {
		ws.data.helloTimer = setTimeout(
			() => ws.close(4001, "hello timeout"),
			HELLO_TIMEOUT_MS,
		);
	}

	onClose(ws: DeviceSocket): void {
		clearTimeout(ws.data.helloTimer);
		this.devices.delete(ws);
		if (this.voice?.owner === ws) this.cancelVoice(false);
		if (ws.data.name) this.log(`device disconnected: ${ws.data.name}`);
	}

	async onMessage(ws: DeviceSocket, raw: string | Buffer): Promise<void> {
		if (typeof raw !== "string") {
			this.onAudio(ws, raw);
			return;
		}
		const msg = parseDeviceMessage(raw);
		if (!msg) {
			this.send(ws, { t: "error", reason: "bad_message" });
			return;
		}
		if (!ws.data.authed) {
			this.handleAuth(ws, msg);
			return;
		}
		try {
			await this.handleCommand(ws, msg);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			this.log(`command ${msg.t} failed: ${reason}`);
			this.send(ws, { t: "error", reason: clip(reason, 80) });
		}
	}

	// ---- Auth ---------------------------------------------------------------

	private handleAuth(ws: DeviceSocket, msg: DeviceToBridge): void {
		if (msg.t === "pair") {
			const name = msg.name ?? "cline-pet";
			const token = this.options.registry.pair(msg.code.trim(), name);
			if (!token) {
				this.send(ws, { t: "auth_error", reason: "bad_code" });
				ws.close(4003, "bad pairing code");
				return;
			}
			this.log(`paired new device: ${name}`);
			this.send(ws, { t: "paired", token, name });
			this.admit(ws, name);
			return;
		}
		if (msg.t === "hello") {
			const device = this.options.registry.authenticate(msg.token);
			if (!device) {
				this.send(ws, { t: "auth_error", reason: "unknown_token" });
				ws.close(4003, "unknown token");
				return;
			}
			this.admit(ws, device.name);
			return;
		}
		this.send(ws, { t: "auth_error", reason: "not_authenticated" });
		ws.close(4001, "not authenticated");
	}

	private admit(ws: DeviceSocket, name: string): void {
		clearTimeout(ws.data.helloTimer);
		ws.data.authed = true;
		ws.data.name = name;
		this.devices.add(ws);
		this.log(`device connected: ${name}`);
		this.send(ws, { t: "welcome", v: PROTOCOL_VERSION, name });
		this.send(ws, this.projector.snapshot());
	}

	// ---- Commands -----------------------------------------------------------

	private async handleCommand(
		ws: DeviceSocket,
		msg: DeviceToBridge,
	): Promise<void> {
		switch (msg.t) {
			case "approve":
			case "deny":
				await this.options.hub.respondApproval(msg.id, msg.t === "approve");
				return;
			case "abort": {
				const session = this.projector.activeSessionId();
				if (session) await this.options.hub.abort(session);
				return;
			}
			case "stats":
				this.send(ws, { t: "stats", ...this.projector.stats() });
				return;
			case "voice_start":
				this.startVoice(ws, msg);
				return;
			case "voice_end":
				await this.endVoice(ws);
				return;
			case "voice_cancel":
				if (this.voice?.owner === ws) this.cancelVoice(true);
				return;
			case "voice_confirm":
				if (this.voice?.owner === ws && this.voice.phase === "pending") {
					clearTimeout(this.voice.timer);
					await this.submitVoice();
				}
				return;
			case "hello":
			case "pair":
				return;
		}
	}

	// ---- Voice --------------------------------------------------------------

	private startVoice(
		ws: DeviceSocket,
		msg: Extract<DeviceToBridge, { t: "voice_start" }>,
	): void {
		if (
			(msg.rate ?? AUDIO_SAMPLE_RATE) !== AUDIO_SAMPLE_RATE ||
			(msg.bits ?? AUDIO_BITS) !== AUDIO_BITS ||
			(msg.ch ?? AUDIO_CHANNELS) !== AUDIO_CHANNELS
		) {
			this.send(ws, {
				t: "voice",
				status: "error",
				text: "unsupported audio format",
			});
			return;
		}
		// A new recording supersedes anything in flight (last press wins).
		this.cancelVoice(false);
		// Start the provider session now so audio streams while the user talks.
		this.voice = {
			phase: "recording",
			owner: ws,
			stream: this.options.transcribe(),
			bytes: 0,
			lastSeq: -1,
			forceNew: msg.target === "new",
		};
		this.projector.setVoice({ phase: "listening" });
		this.broadcastState();
	}

	private onAudio(ws: DeviceSocket, frame: Buffer): void {
		const voice = this.voice;
		if (!ws.data.authed || voice?.phase !== "recording" || voice.owner !== ws)
			return;
		if (frame.byteLength <= AUDIO_FRAME_HEADER_BYTES) return;
		const seq = frame.readUInt16LE(0);
		if (voice.lastSeq >= 0 && seq !== ((voice.lastSeq + 1) & 0xffff)) {
			this.log(
				`audio frame gap: expected ${(voice.lastSeq + 1) & 0xffff}, got ${seq}`,
			);
		}
		voice.lastSeq = seq;
		const pcm = frame.subarray(AUDIO_FRAME_HEADER_BYTES);
		if (voice.bytes + pcm.byteLength > MAX_RECORDING_BYTES) return; // drop overflow
		voice.stream.push(new Uint8Array(pcm));
		voice.bytes += pcm.byteLength;
	}

	private async endVoice(ws: DeviceSocket): Promise<void> {
		const voice = this.voice;
		if (voice?.phase !== "recording" || voice.owner !== ws) return;
		if (voice.bytes < MIN_RECORDING_BYTES) {
			this.cancelVoice(false); // also cancels the provider stream
			this.send(ws, { t: "voice", status: "error", text: "too short" });
			return;
		}
		const { stream, forceNew } = voice;
		this.voice = { phase: "transcribing", owner: ws, stream, forceNew };
		this.projector.setVoice({ phase: "thinking" });
		this.broadcastState();

		let text: string;
		try {
			text = (await stream.finish()).trim();
		} catch (error) {
			if (this.voice?.phase !== "transcribing" || this.voice.stream !== stream)
				return; // cancelled meanwhile
			this.voiceFailed(
				ws,
				error instanceof Error ? error.message : String(error),
			);
			return;
		}
		if (this.voice?.phase !== "transcribing" || this.voice.stream !== stream)
			return;
		if (!text) {
			this.voiceFailed(ws, "no speech detected");
			return;
		}

		const session = forceNew ? undefined : this.projector.activeSessionId();
		const target: VoiceTarget = session ? "followup" : "new";
		const shown = clip(text, TRANSCRIPT_MAX);
		this.voice = {
			phase: "pending",
			owner: ws,
			text,
			target,
			session,
			timer: setTimeout(() => void this.submitVoice(), this.cancelWindowMs),
		};
		this.projector.setVoice({ phase: "thinking", transcript: shown });
		this.send(ws, {
			t: "voice",
			status: "transcribed",
			text: shown,
			target,
			...(session ? { session } : {}),
			cancel_ms: this.cancelWindowMs,
		});
		this.broadcastState();
	}

	private async submitVoice(): Promise<void> {
		const voice = this.voice;
		if (voice?.phase !== "pending") return;
		this.voice = undefined;
		let submittedTo: string | undefined;
		try {
			let session = voice.session;
			// Re-check: the targeted session may have ended during the cancel window.
			if (
				voice.target === "followup" &&
				session &&
				this.projector.activeSessionId() === session
			) {
				await this.options.hub.sendFollowup(session, voice.text);
				this.send(voice.owner, {
					t: "voice",
					status: "submitted",
					target: "followup",
					session,
				});
			} else {
				session = await this.options.hub.startTask(
					voice.text,
					this.projector.recentWorkspace(),
				);
				this.send(voice.owner, {
					t: "voice",
					status: "submitted",
					target: "new",
					session,
				});
			}
			submittedTo = session;
			this.log(`voice prompt submitted to ${session}`);
		} catch (error) {
			this.voiceFailed(
				voice.owner,
				error instanceof Error ? error.message : String(error),
			);
			return;
		}
		// The turn usually starts while we wait for the hub to accept the
		// prompt, so its start event may already be in: show it working now.
		if (submittedTo && this.projector.isRunning(submittedTo)) {
			this.projector.setVoice(undefined);
			this.broadcastState();
			return;
		}
		// Otherwise stay "thinking" until the hub reports the turn running,
		// with a fallback so a silent hub can't leave the pet thinking forever.
		this.projector.setVoice({
			phase: "thinking",
			transcript: clip(voice.text, TRANSCRIPT_MAX),
			awaitingSession: submittedTo,
		});
		this.broadcastState();
		clearTimeout(this.thinkingTimer);
		this.thinkingTimer = setTimeout(() => {
			if (!this.voice) {
				this.projector.setVoice(undefined);
				this.broadcastState();
			}
		}, THINKING_TIMEOUT_MS);
	}

	private cancelVoice(notify: boolean): void {
		const voice = this.voice;
		if (!voice) return;
		if (voice.phase === "recording" || voice.phase === "transcribing")
			voice.stream.cancel();
		if (voice.phase === "pending") clearTimeout(voice.timer);
		this.voice = undefined;
		this.projector.setVoice(undefined);
		if (notify) this.send(voice.owner, { t: "voice", status: "cancelled" });
		this.broadcastState();
	}

	private voiceFailed(ws: DeviceSocket, reason: string): void {
		this.log(`voice failed: ${reason}`);
		this.voice = undefined;
		this.projector.setVoice(undefined);
		this.send(ws, { t: "voice", status: "error", text: clip(reason, 60) });
		this.broadcastState();
	}

	// ---- Output -------------------------------------------------------------

	private broadcastState(): void {
		const state = this.projector.snapshot();
		const encoded = JSON.stringify(state);
		// E-ink refreshes are expensive: never resend an identical state.
		if (encoded !== this.lastSent) {
			this.lastSent = encoded;
			for (const ws of this.devices) ws.send(encoded);
		}
		clearTimeout(this.transientTimer);
		const remaining = this.projector.transientRemainingMs();
		if (remaining !== undefined) {
			this.transientTimer = setTimeout(
				() => this.broadcastState(),
				remaining + 10,
			);
		}
	}

	private send(ws: DeviceSocket, msg: BridgeToDevice): void {
		ws.send(JSON.stringify(msg));
	}
}
