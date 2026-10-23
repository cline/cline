/**
 * `FakeHubSocket` — a `WebSocketImpl`-compatible replay of a recorded fixture.
 *
 * This is what UI tests inject into `HubClient` instead of a real socket. It is
 * intentionally dependency-free (no node builtins, no `@cline/core`) so it runs
 * in jsdom/browser test environments.
 *
 * Replay model:
 * - Commands are matched by **name**, not position, and the live `requestId` is
 *   substituted into the canned reply. A client that generates fresh request ids
 *   (which `HubClient` does) therefore correlates correctly.
 * - Canonical id placeholders (`<session_1>`, `<approval_1>`, …) are bound to the
 *   concrete values the client actually uses; placeholders the client never
 *   supplies get a synthesized stable value. Referential integrity is preserved
 *   in both directions, so a replayed session id round-trips.
 * - Frames are delivered one per microtask, so consumers observe realistic
 *   asynchronous arrival without any timer flake.
 */

import {
	CURRENT_HUB_PROTOCOL_VERSION,
	HUB_CAPABILITIES,
	type HubProtocolMetadata,
	MAX_CLIENT_HUB_PROTOCOL_VERSION,
	MIN_CLIENT_HUB_PROTOCOL_VERSION,
} from "@cline/shared";
import type { CanonicalFrame } from "./canonicalize";
import type { HubFixture } from "./fixture-format";

type Listener = (...args: unknown[]) => void;

/**
 * Protocol metadata replayed on `client.register` replies. Sourced from
 * `@cline/shared` so it tracks the real hub's advertised range instead of a
 * hardcoded copy.
 */
export const DEFAULT_REGISTER_REPLY_METADATA: HubProtocolMetadata = {
	protocolVersion: CURRENT_HUB_PROTOCOL_VERSION,
	minClientProtocolVersion: MIN_CLIENT_HUB_PROTOCOL_VERSION,
	maxClientProtocolVersion: MAX_CLIENT_HUB_PROTOCOL_VERSION,
	capabilities: HUB_CAPABILITIES,
};

export interface FakeHubSocketOptions {
	/**
	 * Reject the connection instead of opening. Auto-enabled when the fixture
	 * recorded a connect failure (no frames + a `hub_connect_failed` outcome).
	 */
	failConnect?: { message?: string } | false;
	/** Called when the client sends a command the fixture has no reply for. */
	onUnmatchedCommand?: (command: string) => void;
	/** Overrides {@link DEFAULT_REGISTER_REPLY_METADATA}. */
	registerReplyMetadata?: Record<string, unknown>;
}

const PLACEHOLDER_PATTERN = /<([a-zA-Z]+)_(\d+)>/g;
const TIMESTAMP_PLACEHOLDER = "<ts>";
const SYNTHETIC_ISO = "1970-01-01T00:00:00.000Z";

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function frameKind(frame: Record<string, unknown>): string {
	return typeof frame.kind === "string" ? frame.kind : "";
}

function envelopeOf(
	frame: Record<string, unknown>,
): Record<string, unknown> | undefined {
	return isRecord(frame.envelope) ? frame.envelope : undefined;
}

function commandName(frame: Record<string, unknown>): string | undefined {
	const command = envelopeOf(frame)?.command;
	return typeof command === "string" ? command : undefined;
}

function requestIdOf(frame: Record<string, unknown>): string | undefined {
	const requestId = envelopeOf(frame)?.requestId;
	return typeof requestId === "string" ? requestId : undefined;
}

/** Does the fixture recording describe a connection that never opened? */
export function fixtureRejectsConnect(fixture: HubFixture): boolean {
	if (fixture.frames.length > 0) {
		return false;
	}
	const outcome = fixture.outcome;
	return (
		isRecord(outcome) &&
		typeof outcome.code === "string" &&
		outcome.code.startsWith("hub_connect")
	);
}

export class FakeHubSocket {
	/** Fixture to replay. Set on a subclass via {@link fakeHubSocketFor}. */
	static fixture: HubFixture | undefined;
	static options: FakeHubSocketOptions = {};

	readyState = 0;

	private readonly listeners = new Map<string, Set<Listener>>();
	private readonly fixture: HubFixture;
	private readonly options: FakeHubSocketOptions;
	private readonly bindings = new Map<string, string>();
	private readonly synthesizedCounts = new Map<string, number>();
	private cursor = 0;
	private closed = false;

	constructor(
		readonly url: string,
		readonly protocols?: string | string[],
		readonly requestOptions?: unknown,
	) {
		const ctor = this.constructor as typeof FakeHubSocket;
		if (!ctor.fixture) {
			throw new Error(
				"FakeHubSocket requires a fixture; construct it via fakeHubSocketFor(fixture).",
			);
		}
		this.fixture = ctor.fixture;
		this.options = ctor.options ?? {};
		this.bindPortFromUrl(url);

		const failConnect =
			this.options.failConnect === false
				? undefined
				: (this.options.failConnect ??
					(fixtureRejectsConnect(this.fixture)
						? {
								message: `Fixture ${this.fixture.scenario} rejects the connection.`,
							}
						: undefined));

		queueMicrotask(() => {
			if (this.closed) {
				return;
			}
			if (failConnect) {
				this.readyState = 3;
				this.emit(
					"error",
					new Error(failConnect.message ?? "Fake hub connection failed."),
				);
				this.emit("close", { code: 1006, reason: "fixture rejects connect" });
				return;
			}
			this.readyState = 1;
			this.emit("open", {});
		});
	}

	addEventListener(type: string, listener: Listener): void {
		const existing = this.listeners.get(type) ?? new Set<Listener>();
		existing.add(listener);
		this.listeners.set(type, existing);
	}

	removeEventListener(type: string, listener: Listener): void {
		this.listeners.get(type)?.delete(listener);
	}

	send(data: string): void {
		if (this.readyState !== 1) {
			throw new Error("FakeHubSocket is not open.");
		}
		let outgoing: unknown;
		try {
			outgoing = JSON.parse(data);
		} catch {
			return;
		}
		if (!isRecord(outgoing)) {
			return;
		}
		this.handleOutgoing(outgoing);
	}

	close(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.readyState = 3;
		queueMicrotask(() => {
			this.emit("close", { code: 1000, reason: "" });
		});
	}

	// --- replay ------------------------------------------------------------

	private handleOutgoing(outgoing: Record<string, unknown>): void {
		const matchIndex = this.findMatchingOutFrame(outgoing);
		if (matchIndex === undefined) {
			const command = commandName(outgoing);
			if (command) {
				this.options.onUnmatchedCommand?.(command);
				this.pushFrames([
					{
						kind: "reply",
						envelope: {
							version: "v1",
							requestId: requestIdOf(outgoing),
							ok: false,
							error: {
								code: "fixture_missing_command",
								message: `Fixture ${this.fixture.scenario} has no recorded reply for ${command}.`,
							},
						},
					},
				]);
			}
			return;
		}

		const matched = this.fixture.frames[matchIndex] as CanonicalFrame;
		this.bindPair(matched.frame, outgoing);
		this.cursor = matchIndex + 1;

		const fixtureRequestId = requestIdOf(matched.frame);
		const liveRequestId = requestIdOf(outgoing);
		const pending: Array<Record<string, unknown>> = [];

		while (this.cursor < this.fixture.frames.length) {
			const next = this.fixture.frames[this.cursor] as CanonicalFrame;
			if (next.direction !== "in") {
				break;
			}
			this.cursor += 1;
			const isCorrelatedReply =
				frameKind(next.frame) === "reply" &&
				fixtureRequestId !== undefined &&
				requestIdOf(next.frame) === fixtureRequestId;
			const substituted = this.substitute(next.frame) as Record<
				string,
				unknown
			>;
			if (isCorrelatedReply) {
				const envelope = envelopeOf(substituted);
				if (envelope) {
					if (liveRequestId) {
						envelope.requestId = liveRequestId;
					}
					if (commandName(matched.frame) === "client.register") {
						this.augmentRegisterReply(envelope);
					}
				}
			}
			pending.push(substituted);
		}

		this.pushFrames(pending);
	}

	/**
	 * Fixtures record `client.register` replies through an allowlist, because the
	 * real reply may carry additive protocol metadata that would otherwise churn
	 * every fixture. Replay puts that metadata back, derived from the live
	 * `@cline/shared` constants, so a client that asserts protocol compatibility on
	 * register still sees a well-formed reply. Recorded fields always win.
	 */
	private augmentRegisterReply(envelope: Record<string, unknown>): void {
		if (envelope.ok !== true) {
			return;
		}
		const recorded = isRecord(envelope.payload) ? envelope.payload : {};
		envelope.payload = {
			...(this.options.registerReplyMetadata ?? {
				...DEFAULT_REGISTER_REPLY_METADATA,
				// Advertise every command this fixture actually exercises, so a client
				// that feature-detects before calling one is not told it is missing.
				capabilities: this.replayableCapabilities(),
			}),
			...recorded,
		};
	}

	/** Baseline hub capabilities plus every command recorded in this fixture. */
	private replayableCapabilities(): string[] {
		const capabilities = new Set<string>(HUB_CAPABILITIES);
		for (const frame of this.fixture.frames) {
			const command = commandName(frame.frame);
			if (frame.direction === "out" && command) {
				capabilities.add(command);
			}
		}
		return [...capabilities].sort();
	}

	/**
	 * Command frames match by name; subscription frames match by kind. Search
	 * starts at the cursor and wraps, so a reconnecting client that replays
	 * `client.register` a second time still finds its later recording.
	 */
	private findMatchingOutFrame(
		outgoing: Record<string, unknown>,
	): number | undefined {
		const kind = frameKind(outgoing);
		const command = commandName(outgoing);
		const matches = (candidate: CanonicalFrame): boolean => {
			if (
				candidate.direction !== "out" ||
				frameKind(candidate.frame) !== kind
			) {
				return false;
			}
			return kind === "command"
				? commandName(candidate.frame) === command
				: true;
		};
		for (
			let index = this.cursor;
			index < this.fixture.frames.length;
			index += 1
		) {
			if (matches(this.fixture.frames[index] as CanonicalFrame)) {
				return index;
			}
		}
		for (let index = 0; index < this.cursor; index += 1) {
			if (matches(this.fixture.frames[index] as CanonicalFrame)) {
				return index;
			}
		}
		return undefined;
	}

	private pushFrames(frames: Array<Record<string, unknown>>): void {
		let chain = Promise.resolve();
		for (const frame of frames) {
			// One frame per microtask: asynchronous like a real socket, but with no
			// timers, so replay order is fully deterministic.
			chain = chain.then(() => {
				if (this.closed || this.readyState !== 1) {
					return;
				}
				this.emit("message", { data: JSON.stringify(frame) });
			});
		}
		void chain;
	}

	private emit(type: string, event: unknown): void {
		for (const listener of this.listeners.get(type) ?? []) {
			listener(event);
		}
	}

	// --- placeholder binding ----------------------------------------------

	private bindPortFromUrl(url: string): void {
		const port = /:(\d{2,5})(?:\/|$)/.exec(url)?.[1];
		if (port) {
			this.bindings.set("<port>", port);
		}
	}

	/** Learn placeholder -> live value from a fixture/live frame pair. */
	private bindPair(fixtureValue: unknown, liveValue: unknown): void {
		if (typeof fixtureValue === "string") {
			const exact = /^<([a-zA-Z]+)_(\d+)>$/.exec(fixtureValue);
			if (
				exact &&
				typeof liveValue === "string" &&
				!this.bindings.has(fixtureValue)
			) {
				this.bindings.set(fixtureValue, liveValue);
			}
			return;
		}
		if (Array.isArray(fixtureValue) && Array.isArray(liveValue)) {
			for (const [index, entry] of fixtureValue.entries()) {
				this.bindPair(entry, liveValue[index]);
			}
			return;
		}
		if (isRecord(fixtureValue) && isRecord(liveValue)) {
			for (const key of Object.keys(fixtureValue)) {
				this.bindPair(fixtureValue[key], liveValue[key]);
			}
		}
	}

	/** Replace placeholders with bound (or synthesized-and-bound) values. */
	private substitute(value: unknown): unknown {
		if (typeof value === "string") {
			if (value === TIMESTAMP_PLACEHOLDER) {
				return SYNTHETIC_ISO;
			}
			return value.replace(PLACEHOLDER_PATTERN, (match, idClass: string) =>
				this.resolvePlaceholder(match, idClass),
			);
		}
		if (Array.isArray(value)) {
			return value.map((entry) => this.substitute(entry));
		}
		if (isRecord(value)) {
			const out: Record<string, unknown> = {};
			for (const [key, entry] of Object.entries(value)) {
				out[key] = this.substitute(entry);
			}
			return out;
		}
		return value;
	}

	private resolvePlaceholder(placeholder: string, idClass: string): string {
		const bound = this.bindings.get(placeholder);
		if (bound !== undefined) {
			return bound;
		}
		const next = (this.synthesizedCounts.get(idClass) ?? 0) + 1;
		this.synthesizedCounts.set(idClass, next);
		const synthesized = `fake_${idClass}_${next}`;
		this.bindings.set(placeholder, synthesized);
		return synthesized;
	}
}

/**
 * A `WebSocketImpl` bound to `fixture`, ready to hand to `HubClient`.
 *
 * ```ts
 * const client = new HubClient({
 *   url: "ws://127.0.0.1:1/hub",
 *   WebSocketImpl: fakeHubSocketFor(await readFixture("happy-turn")!),
 * });
 * ```
 */
export function fakeHubSocketFor(
	fixture: HubFixture,
	options: FakeHubSocketOptions = {},
): typeof FakeHubSocket {
	return class BoundFakeHubSocket extends FakeHubSocket {
		static override fixture = fixture;
		static override options = options;
	};
}
