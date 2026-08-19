"use client";

/**
 * The webview side of the native bridge.
 *
 * Connects to the broker's loopback WebSocket, authenticates with the
 * per-launch secret obtained from the Tauri shell (never from a URL or
 * env var), keeps the DesktopProjection in sync (replace + revision-
 * fenced patches), and sends only the fixed command set. Outside the
 * shell (headless `next dev`), it falls back to the broker's explicit
 * development bridge; with `?fixtures=<name>` it renders local fixture
 * projections and never opens a socket.
 */

import {
	BRIDGE_PROTOCOL_VERSION,
	type BridgeCommand,
	DEV_BRIDGE_PORT,
	DEV_BRIDGE_SECRET,
} from "@shared/bridge";
import type { PublicDesktopError } from "@shared/errors";
import { FIXTURE_PROJECTIONS } from "@shared/fixtures";
import {
	createInitialProjection,
	type DesktopProjection,
} from "@shared/projection";

export type BridgeStatus =
	| "connecting"
	| "connected"
	| "disconnected"
	| "fixtures";

export interface BridgeState {
	status: BridgeStatus;
	projection: DesktopProjection;
}

type Listener = (state: BridgeState) => void;

interface PendingCommand {
	resolve(value: unknown): void;
	reject(error: PublicDesktopError): void;
}

interface BridgeEndpoint {
	port: number;
	secret: string;
}

async function resolveEndpoint(): Promise<BridgeEndpoint> {
	// Inside the Tauri shell the endpoint + per-launch secret come from a
	// native command. `invoke` is imported dynamically so a plain browser
	// (dev mode) never loads the Tauri API.
	if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
		const { invoke } = await import("@tauri-apps/api/core");
		return await invoke<BridgeEndpoint>("bridge_endpoint");
	}
	return { port: DEV_BRIDGE_PORT, secret: DEV_BRIDGE_SECRET };
}

export class BridgeClient {
	private socket: WebSocket | undefined;
	private state: BridgeState = {
		status: "connecting",
		projection: createInitialProjection(),
	};
	private readonly listeners = new Set<Listener>();
	private readonly pending = new Map<string, PendingCommand>();
	private nextFrameId = 0;
	private stopped = false;
	private readonly fixtureName: string | undefined;

	constructor(fixtureName?: string) {
		this.fixtureName = fixtureName;
	}

	static fixtureFromLocation(): string | undefined {
		if (typeof window === "undefined") {
			return undefined;
		}
		const value = new URLSearchParams(window.location.search).get("fixtures");
		return value ?? undefined;
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		listener(this.state);
		return () => {
			this.listeners.delete(listener);
		};
	}

	start(): void {
		if (this.fixtureName) {
			const factory =
				FIXTURE_PROJECTIONS[this.fixtureName] ?? FIXTURE_PROJECTIONS.idle;
			this.setState({ status: "fixtures", projection: factory() });
			return;
		}
		void this.connect();
	}

	stop(): void {
		this.stopped = true;
		this.socket?.close();
	}

	private setState(state: BridgeState): void {
		this.state = state;
		for (const listener of this.listeners) {
			listener(state);
		}
	}

	private async connect(): Promise<void> {
		if (this.stopped) {
			return;
		}
		let endpoint: BridgeEndpoint;
		try {
			endpoint = await resolveEndpoint();
		} catch {
			this.scheduleReconnect();
			return;
		}
		const socket = new WebSocket(`ws://127.0.0.1:${endpoint.port}/`);
		this.socket = socket;
		socket.onopen = () => {
			// The secret rides in the FIRST frame, never in the URL.
			socket.send(
				JSON.stringify({
					v: BRIDGE_PROTOCOL_VERSION,
					type: "authenticate",
					secret: endpoint.secret,
				}),
			);
		};
		socket.onmessage = (message) => {
			this.handleFrame(String(message.data));
		};
		socket.onclose = () => {
			if (this.socket === socket) {
				this.socket = undefined;
				this.failAllPending();
				this.setState({ ...this.state, status: "disconnected" });
				this.scheduleReconnect();
			}
		};
		socket.onerror = () => {
			socket.close();
		};
	}

	private scheduleReconnect(): void {
		if (this.stopped) {
			return;
		}
		setTimeout(() => void this.connect(), 1_000);
	}

	private failAllPending(): void {
		for (const pending of this.pending.values()) {
			pending.reject({
				code: "bridge_disconnected",
				message: "The native bridge connection was lost",
				retryable: true,
				action: "retry",
			});
		}
		this.pending.clear();
	}

	private handleFrame(raw: string): void {
		let frame: Record<string, unknown>;
		try {
			frame = JSON.parse(raw) as Record<string, unknown>;
		} catch {
			return;
		}
		switch (frame.type) {
			case "authenticated":
				this.setState({ ...this.state, status: "connected" });
				return;
			case "projection.replace": {
				this.setState({
					status: "connected",
					projection: frame.projection as DesktopProjection,
				});
				return;
			}
			case "projection.patch": {
				const baseRevision = frame.baseRevision as number;
				const revision = frame.revision as number;
				if (this.state.projection.revision !== baseRevision) {
					// Revision fence broken (missed patch): request a replace.
					void this.send({ command: "app.initialize" }).catch(() => {});
					return;
				}
				this.setState({
					status: "connected",
					projection: {
						...this.state.projection,
						...(frame.patch as Partial<DesktopProjection>),
						revision,
					},
				});
				return;
			}
			case "command.result": {
				const id = String(frame.id);
				const pending = this.pending.get(id);
				if (!pending) {
					return;
				}
				this.pending.delete(id);
				if (frame.ok === true) {
					pending.resolve(frame.result);
				} else {
					pending.reject(
						(frame.error as PublicDesktopError) ?? {
							code: "desktop_internal",
							message: "Command failed",
							retryable: false,
						},
					);
				}
				return;
			}
			default:
				return;
		}
	}

	/** Send one fixed bridge command; resolves with its typed result. */
	send(command: BridgeCommand): Promise<unknown> {
		if (this.fixtureName) {
			return Promise.resolve({ fixtures: true });
		}
		const socket = this.socket;
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			return Promise.reject({
				code: "bridge_disconnected",
				message: "The native bridge is not connected",
				retryable: true,
				action: "retry",
			} satisfies PublicDesktopError);
		}
		this.nextFrameId += 1;
		const id = `frame_${this.nextFrameId}`;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			socket.send(
				JSON.stringify({
					v: BRIDGE_PROTOCOL_VERSION,
					type: "command",
					id,
					payload: command,
				}),
			);
		});
	}
}
