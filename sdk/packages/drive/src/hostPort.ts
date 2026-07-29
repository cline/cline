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
	/** Demo / fixture browser capture for drive_browser_snapshot. Default false. */
	readonly demoCapture: boolean;

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
	| {
			type: "join";
			roomId: string;
			participant: RoomSnapshot["participants"][number];
	  }
	| { type: "leave"; roomId: string; participantId: string }
	| {
			type: "setAddress";
			roomId: string;
			addressSet: RoomSnapshot["addressSet"];
	  }
	| {
			type: "setStage";
			roomId: string;
			sharer: RoomSnapshot["stage"]["sharer"];
			pin?: RoomSnapshot["stage"]["pin"];
	  }
	| {
			type: "setMode";
			roomId: string;
			subMode: RoomSnapshot["subMode"];
			driveActive?: boolean;
	  }
	| {
			type: "raiseHand";
			roomId: string;
			participantId: string;
			raised: boolean;
	  }
	| { type: "mute"; roomId: string; participantId: string; muted: boolean };

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
	/** Read current room snapshot (required by DriveHarness for pack/spotlight). */
	getRoom?(roomId: string): Promise<RoomSnapshot | null>;
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
	demoCapture: false,
	localOnly: true,
	writerEndpoint: CLINE_HUB_WRITER_ENDPOINT,
	remoteBridge: false,
	orgConfig: false,
	auditExport: false,
};
