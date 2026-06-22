"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type HubConnectionStatus =
	| "idle"
	| "connecting"
	| "connected"
	| "disconnected";

export type ConnectorField = {
	flag: string;
	label: string;
	placeholder?: string;
	required?: boolean;
	help?: string[];
	initialValue?: string;
	options?: Array<{ value: string; label: string; hint?: string }>;
	includeWhen?: {
		flag: string;
		equals?: string;
		notEquals?: string;
	};
};

export type ConnectorSecurityField = {
	key: string;
	label: string;
	placeholder?: string;
	help?: string[];
	requiredMessage: string;
};

export type ConnectorChannel = {
	id: string;
	name: string;
	type: "polling" | "webhook" | "hybrid";
	hint: string;
	fields: ConnectorField[];
	security?: {
		prompt: string;
		fields: ConnectorSecurityField[];
	};
};

export type ActiveConnector = {
	id: string;
	type: string;
	pid: number;
	hubUrl: string;
	startedAt?: string;
	applicationId?: string;
	botUsername?: string;
	userName?: string;
	phoneNumberId?: string;
	port?: number;
	baseUrl?: string;
	connectionMode?: string;
};

export type ConnectorChannelsResponse = {
	available: ConnectorChannel[];
	active: ActiveConnector[];
};

type HubStateSnapshot = {
	status: HubConnectionStatus;
	errorMessage: string | null;
	statusMessage: string | null;
};

type DesktopCommandResult =
	| { type: "desktopCommandResult"; id: string; ok: true; result: unknown }
	| { type: "desktopCommandResult"; id: string; ok: false; error: string };

type HubOutboundMessage =
	| DesktopCommandResult
	| { type: "status"; text: string }
	| { type: "error"; text: string };

type PendingRequest = {
	command: string;
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeoutId: ReturnType<typeof setTimeout>;
};

type ConnectOptions = {
	showProgress?: boolean;
};

const REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_HUB_BROWSER_WS_URL =
	process.env.NEXT_PUBLIC_CLINE_HUB_WS_URL?.trim() ||
	"ws://127.0.0.1:8787/browser";

function isDesktopCommandResult(
	message: HubOutboundMessage,
): message is DesktopCommandResult {
	return message.type === "desktopCommandResult";
}

class ClineHubBrowserClient {
	private socket: WebSocket | undefined;
	private connectPromise: Promise<void> | undefined;
	private requestCounter = 0;
	private readonly pending = new Map<string, PendingRequest>();
	private snapshot: HubStateSnapshot = {
		status: "idle",
		errorMessage: null,
		statusMessage: null,
	};
	private onChange: ((snapshot: HubStateSnapshot) => void) | undefined;

	constructor(readonly endpoint: string) {}

	setOnChange(onChange: (snapshot: HubStateSnapshot) => void): void {
		this.onChange = onChange;
		onChange(this.snapshot);
	}

	getSnapshot(): HubStateSnapshot {
		return this.snapshot;
	}

	private setSnapshot(updates: Partial<HubStateSnapshot>): void {
		this.snapshot = { ...this.snapshot, ...updates };
		this.onChange?.(this.snapshot);
	}

	private rejectPending(error: Error): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timeoutId);
			pending.reject(error);
		}
		this.pending.clear();
	}

	async connect(options: ConnectOptions = {}): Promise<void> {
		const showProgress = options.showProgress === true;
		if (typeof window === "undefined") {
			throw new Error("Cline Hub connection is only available in the browser.");
		}
		if (this.socket?.readyState === WebSocket.OPEN) {
			this.setSnapshot({
				status: "connected",
				errorMessage: null,
				statusMessage: "Connected to Cline Hub.",
			});
			return;
		}
		if (this.socket?.readyState === WebSocket.CONNECTING && this.connectPromise) {
			return this.connectPromise;
		}

		if (showProgress) {
			this.setSnapshot({
				status: "connecting",
				errorMessage: null,
				statusMessage: "Connecting to Cline Hub...",
			});
		}

		this.connectPromise = new Promise<void>((resolve, reject) => {
			const socket = new WebSocket(this.endpoint);
			let settled = false;
			let failureHandled = false;
			this.socket = socket;

			const fail = (message: string) => {
				if (failureHandled) return;
				failureHandled = true;
				const error = new Error(message);
				const wasConnected = this.snapshot.status === "connected";
				if (!settled) {
					settled = true;
					reject(error);
				}
				this.rejectPending(error);
				this.setSnapshot({
					status: "disconnected",
					errorMessage:
						showProgress || wasConnected ? message : this.snapshot.errorMessage,
					statusMessage: null,
				});
			};

			socket.addEventListener("open", () => {
				settled = true;
				this.setSnapshot({
					status: "connected",
					errorMessage: null,
					statusMessage: "Connected to Cline Hub.",
				});
				socket.send(JSON.stringify({ type: "ready" }));
				resolve();
			});

			socket.addEventListener("message", (event) => {
				let message: HubOutboundMessage;
				try {
					message = JSON.parse(String(event.data)) as HubOutboundMessage;
				} catch {
					fail("Received an invalid message from the Cline Hub server.");
					return;
				}

				if (isDesktopCommandResult(message)) {
					const pending = this.pending.get(message.id);
					if (!pending) return;
					clearTimeout(pending.timeoutId);
					this.pending.delete(message.id);
					if (message.ok) {
						pending.resolve(message.result);
					} else {
						pending.reject(new Error(message.error));
					}
					return;
				}

				if (message.type === "error") {
					this.setSnapshot({
						errorMessage: message.text,
						statusMessage: null,
					});
					return;
				}

				if (message.type === "status") {
					this.setSnapshot({ statusMessage: message.text });
				}
			});

			socket.addEventListener("close", () => {
				this.socket = undefined;
				this.connectPromise = undefined;
				fail("Disconnected from the Cline Hub server.");
			});

			socket.addEventListener("error", () => {
				fail("Failed to connect to the Cline Hub server.");
			});
		});

		return this.connectPromise;
	}

	disconnect(): void {
		this.socket?.close();
		this.socket = undefined;
		this.connectPromise = undefined;
		this.rejectPending(new Error("Disconnected from the Cline Hub server."));
		this.setSnapshot({
			status: "disconnected",
			errorMessage: null,
			statusMessage: null,
		});
	}

	async invoke<T>(
		command: string,
		args?: Record<string, unknown>,
		options?: { timeoutMs?: number },
	): Promise<T> {
		await this.connect({ showProgress: true });
		const socket = this.socket;
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			throw new Error("Cline Hub is not connected.");
		}

		const id = `welcome_${Date.now()}_${this.requestCounter++}`;
		return await new Promise<T>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Timed out waiting for desktop command: ${command}`));
			}, options?.timeoutMs ?? REQUEST_TIMEOUT_MS);
			this.pending.set(id, {
				command,
				resolve: (value) => resolve(value as T),
				reject,
				timeoutId,
			});
			socket.send(
				JSON.stringify({ type: "desktopCommand", id, command, args }),
			);
		});
	}
}

export function useClineHubClient(endpoint = DEFAULT_HUB_BROWSER_WS_URL) {
	const client = useMemo(() => new ClineHubBrowserClient(endpoint), [endpoint]);
	const [snapshot, setSnapshot] = useState<HubStateSnapshot>(
		client.getSnapshot(),
	);
	const connectingRef = useRef(false);

	const connect = useCallback(async (options: ConnectOptions = {}) => {
		if (connectingRef.current) return;
		connectingRef.current = true;
		try {
			await client.connect(options);
		} catch {
			// The snapshot carries the user-facing connection error.
		} finally {
			connectingRef.current = false;
		}
	}, [client]);

	useEffect(() => {
		client.setOnChange(setSnapshot);
		void connect();
		const intervalId = window.setInterval(() => {
			if (client.getSnapshot().status !== "connected") {
				void connect();
			}
		}, 3_000);
		return () => {
			window.clearInterval(intervalId);
			client.disconnect();
		};
	}, [client, connect]);

	const invoke = useCallback(
		async <T,>(command: string, args?: Record<string, unknown>) =>
			await client.invoke<T>(command, args),
		[client],
	);

	return {
		...snapshot,
		endpoint,
		isConnected: snapshot.status === "connected",
		connect,
		invoke,
	};
}
