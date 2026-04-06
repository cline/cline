import {
	RPC_TEAM_LIFECYCLE_EVENT_TYPE,
	RPC_TEAM_PROGRESS_EVENT_TYPE,
	type TeamProgressLifecycleEvent,
	type TeamProgressProjectionEvent,
} from "@clinebot/shared";
import type { ClineGatewayClient } from "../proto/generated/cline/rpc/v1/ClineGateway";
import type { PublishEventResponse__Output } from "../proto/generated/cline/rpc/v1/PublishEventResponse";
import type { RoutedEvent__Output } from "../proto/generated/cline/rpc/v1/RoutedEvent";
import { fromProtoStruct, toProtoStruct } from "../proto/serde";
import type {
	RpcStreamEventsHandlers,
	RpcStreamEventsInput,
	RpcStreamTeamProgressHandlers,
} from "./types";
import { unary } from "./unary";

export class EventsClient {
	constructor(private readonly client: ClineGatewayClient) {}

	async publishEvent(input: {
		eventId?: string;
		sessionId: string;
		taskId?: string;
		eventType: string;
		payload: Record<string, unknown>;
		sourceClientId?: string;
	}): Promise<{ eventId: string; accepted: boolean }> {
		const response = await unary<PublishEventResponse__Output>((callback) => {
			this.client.PublishEvent(
				{
					eventId: input.eventId,
					sessionId: input.sessionId,
					taskId: input.taskId,
					eventType: input.eventType,
					payload: toProtoStruct(input.payload),
					sourceClientId: input.sourceClientId,
				},
				callback,
			);
		});
		return {
			eventId: response.eventId ?? "",
			accepted: response.accepted === true,
		};
	}

	streamEvents(
		input: RpcStreamEventsInput,
		handlers: RpcStreamEventsHandlers = {},
	): () => void {
		let closing = false;
		const stream = this.client.StreamEvents({
			clientId: input.clientId ?? "",
			sessionIds: input.sessionIds ?? [],
		});
		stream.on("data", (event: RoutedEvent__Output) => {
			handlers.onEvent?.({
				eventId: event.eventId ?? "",
				sessionId: event.sessionId ?? "",
				taskId: event.taskId?.trim() ? event.taskId : undefined,
				eventType: event.eventType ?? "",
				payload: fromProtoStruct(event.payload) ?? {},
				sourceClientId: event.sourceClientId?.trim()
					? event.sourceClientId
					: undefined,
				ts: event.ts ?? "",
			});
		});
		stream.on("error", (error: Error) => {
			const grpcCode =
				typeof (error as { code?: unknown }).code === "number"
					? Number((error as { code?: unknown }).code)
					: undefined;
			const isCancelled = grpcCode === 1 || error.message.includes("CANCELLED");
			if (closing && isCancelled) {
				return;
			}
			handlers.onError?.(error);
		});
		stream.on("end", () => handlers.onEnd?.());
		return () => {
			closing = true;
			stream.cancel();
		};
	}

	streamTeamProgress(
		input: RpcStreamEventsInput,
		handlers: RpcStreamTeamProgressHandlers = {},
	): () => void {
		return this.streamEvents(input, {
			onEvent: (event) => {
				if (event.eventType === RPC_TEAM_PROGRESS_EVENT_TYPE) {
					try {
						const parsed =
							event.payload as unknown as TeamProgressProjectionEvent;
						if (
							parsed.type === "team_progress_projection" &&
							parsed.version === 1
						) {
							handlers.onProjection?.(parsed);
						}
					} catch {
						// Ignore malformed payloads; event stream remains best effort.
					}
					return;
				}
				if (event.eventType === RPC_TEAM_LIFECYCLE_EVENT_TYPE) {
					try {
						handlers.onLifecycle?.(
							event.payload as unknown as TeamProgressLifecycleEvent,
						);
					} catch {
						// Ignore malformed payloads; event stream remains best effort.
					}
				}
			},
			onError: handlers.onError,
			onEnd: handlers.onEnd,
		});
	}
}
