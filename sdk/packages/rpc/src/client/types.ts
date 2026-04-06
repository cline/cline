import type {
	TeamProgressLifecycleEvent,
	TeamProgressProjectionEvent,
} from "@clinebot/shared";

export interface RpcSessionClientOptions {
	address: string;
}

export interface RpcStreamEventsInput {
	clientId?: string;
	sessionIds?: string[];
}

export interface RpcStreamEventsHandlers {
	onEvent?: (event: {
		eventId: string;
		sessionId: string;
		taskId?: string;
		eventType: string;
		payload: Record<string, unknown>;
		sourceClientId?: string;
		ts: string;
	}) => void;
	onError?: (error: Error) => void;
	onEnd?: () => void;
}

export interface RpcStreamTeamProgressHandlers {
	onProjection?: (event: TeamProgressProjectionEvent) => void;
	onLifecycle?: (event: TeamProgressLifecycleEvent) => void;
	onError?: (error: Error) => void;
	onEnd?: () => void;
}
