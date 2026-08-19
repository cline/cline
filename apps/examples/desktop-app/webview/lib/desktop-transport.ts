export type DesktopTransportRequest = {
	type: "command";
	id: string;
	command: string;
	args?: Record<string, unknown>;
};

/**
 * First-message handshake on the WebSocket transport. The sidecar serves no
 * commands until a client presents the per-launch auth token; browsers cannot
 * set headers on a WebSocket upgrade, so the token travels in-band.
 */
export type DesktopTransportAuthRequest = {
	type: "auth";
	token: string;
};

export type DesktopTransportAuthResponse = {
	type: "auth";
	ok: boolean;
	error?: string;
};

export type DesktopTransportResponse = {
	type: "response";
	id: string;
	ok: boolean;
	result?: unknown;
	error?: string;
};

export type DesktopTransportEvent = {
	type: "event";
	event: {
		name: string;
		payload: unknown;
	};
};

export type DesktopDebugLogPayload = {
	scope: string;
	level: "debug" | "info" | "error";
	message: string;
	timestamp: string;
	metadata?: Record<string, unknown>;
};

export type DesktopTransportMessage =
	| DesktopTransportResponse
	| DesktopTransportEvent;

export type DesktopTransportState =
	| "connecting"
	| "reconnecting"
	| "connected"
	| "unavailable";

export type DesktopBackendReadyPayload = {
	endpoint: string;
	wsEndpoint: string;
	pid: number;
	mode: "bun";
};
