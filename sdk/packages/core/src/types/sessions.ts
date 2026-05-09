import type {
	SessionLineage,
	SessionRuntimeRecordShape,
} from "@clinebot/shared";
import type { SessionSource, SessionStatus } from "./common";

export interface SessionRef extends SessionLineage {
	sessionId: string;
}

export interface SessionRecord
	extends SessionRef,
		Omit<SessionRuntimeRecordShape, "source" | "status"> {
	source: SessionSource;
	status: SessionStatus;
}

export interface SessionHistoryMetadata extends Record<string, unknown> {
	title?: string;
	totalCost?: number;
	checkpoint?: {
		latest?: {
			ref?: string;
			createdAt?: number;
			runCount?: number;
		};
		history?: Array<{
			ref?: string;
			createdAt?: number;
			runCount?: number;
		}>;
	};
}

export interface SessionHistoryRecord extends Omit<SessionRecord, "metadata"> {
	metadata?: SessionHistoryMetadata;
}
