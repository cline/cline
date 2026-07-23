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

export type DesktopBootstrapPhase =
	| "starting_sidecar"
	| "starting_hub"
	| "connecting_core"
	| "connecting_event_client"
	| "ready"
	| "error";

export type DesktopBootstrapStatus = {
	phase: DesktopBootstrapPhase;
	revision: number;
	updatedAt: string;
	message?: string;
	failedPhase?: Exclude<DesktopBootstrapPhase, "ready" | "error">;
};
