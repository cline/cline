/**
 * DriveHostPort + HostCapabilities (interfaces only — no IO).
 */

import type { DriveEvent, RoomSnapshot } from "@cline/shared";

/** Sole Cline hub writer (hub listens on 25463 — never a second daemon). */
export const CLINE_HUB_WRITER_ENDPOINT = "ws://127.0.0.1:25463" as const;

export type HostCapabilities = {
	readonly harnessId: string;
	readonly schemaVersion: 1;

	readonly roomOps: boolean;
	readonly eventsFirstStage: boolean;
	readonly durableConfigIo: boolean;
	readonly promptRewrite: boolean;
	readonly worktreeIsolation: boolean;
	readonly voiceIo: boolean;
	readonly pixelShare: boolean;

	readonly localOnly: boolean;
	/** Required — single-writer endpoint (Cline: ws://127.0.0.1:25463). */
	readonly writerEndpoint: string;

	/** Enterprise adapters (ARD-0013). Default false until implemented. */
	readonly remoteBridge: boolean;
	readonly orgConfig: boolean;
	readonly auditExport: boolean;
};

export type RoomOp =
	| { type: "create"; roomId: string; hostParticipantId: string }
	| { type: "join"; participant: RoomSnapshot["participants"][number] }
	| { type: "leave"; participantId: string }
	| { type: "setAddress"; addressSet: RoomSnapshot["addressSet"] }
	| {
			type: "setStage";
			sharer: RoomSnapshot["stage"]["sharer"];
			pin?: RoomSnapshot["stage"]["pin"];
	  }
	| { type: "setMode"; subMode: RoomSnapshot["subMode"]; driveActive?: boolean }
	| { type: "raiseHand"; participantId: string; raised: boolean }
	| { type: "mute"; participantId: string; muted: boolean };

export type PromptRewriteDecision = {
	readonly turnId: string;
	readonly rewrite: string;
	readonly reason?: string;
};

export type DriveHostPort = {
	readonly capabilities: HostCapabilities;

	resolveKnownAgents(): Promise<ReadonlyArray<{ name: string }>>;

	readDurableFacets(workspaceRoot: string): Promise<unknown>;
	writeDurableFacets(workspaceRoot: string, next: unknown): Promise<void>;

	commitRoomOp(op: RoomOp): Promise<RoomSnapshot>;
	broadcast(event: DriveEvent): Promise<void>;
	subscribe(handler: (event: DriveEvent) => void): () => void;

	bridgeWorkEvents(handler: (event: DriveEvent) => void): () => void;
	applyPromptRewrite(decision: PromptRewriteDecision): Promise<void>;
};

/**
 * Default Cline host capability matrix — advertise only what works today.
 * - promptRewrite: false until a rewrite fn is wired (see createClineDriveHost).
 * - worktreeIsolation: false until Phase 4 isolation lands.
 */
export const CLINE_HOST_CAPABILITIES: HostCapabilities = {
	harnessId: "cline",
	schemaVersion: 1,
	roomOps: true,
	eventsFirstStage: true,
	durableConfigIo: true,
	promptRewrite: false,
	worktreeIsolation: false,
	voiceIo: false,
	pixelShare: false,
	localOnly: true,
	writerEndpoint: CLINE_HUB_WRITER_ENDPOINT,
	remoteBridge: false,
	orgConfig: false,
	auditExport: false,
};
