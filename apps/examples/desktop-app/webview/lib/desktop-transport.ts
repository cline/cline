export type DesktopTransportRequest = {
	type: "command";
	id: string;
	command: string;
	args?: Record<string, unknown>;
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

/** Local Hub startup, sent as the `hub_status` event. */
export type DesktopHubStatus = {
	state: "starting" | "ready" | "failed";
	/** User-facing summary. Raw errors go to the log and diagnostics report. */
	error?: string;
};

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
