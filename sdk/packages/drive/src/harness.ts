/**
 * DriveHarness — composition root over DriveHostPort (drivecode-sdk MVP).
 * Proposes seating/address/stage/mode; host commits. No agent loop, no IO.
 */

import type {
	AddressSet,
	AgentParticipant,
	DriveEvent,
	DriveSubMode,
	HumanParticipant,
	RoomSnapshot,
	StagePin,
	StageSharer,
} from "@cline/shared";
import { advanceScriptBeat } from "./director/rankBacklogs.js";
import { pickNextShowToPresent } from "./director/pickNextShow.js";
import { planShowIntents } from "./director/planShowIntents.js";
import type { DriveHostPort } from "./hostPort.js";
import { assertRouteLegal, planRoute } from "./router/planRoute.js";
import { setSpotlight } from "./room/participantControls.js";

export const DRIVE_HARNESS_DEFAULT_ROOM_ID = "default" as const;
export const DRIVE_HARNESS_HUMAN_ID = "drive:human" as const;
export const DRIVE_HARNESS_PARTNER_ID = "drive:partner" as const;

export type RosterPackMember = {
	readonly id: string;
	readonly displayName: string;
	readonly role?: AgentParticipant["role"];
};

export type CreateOrAttachInput = {
	roomId?: string;
	humanId: string;
	humanDisplayName?: string;
	/** When set, seats a pair_partner agent (default display "Partner"). */
	partner?: {
		id?: string;
		displayName?: string;
	} | null;
	/** Activate Drive + stage sharer on the partner (default true when partner seated). */
	activateDrive?: boolean;
};

export type CreateDriveHarnessOptions = {
	host: DriveHostPort;
	/**
	 * Resolves roster pack seats until durable RosterPack IO lands.
	 * Required for `rooms.addRosterPack`.
	 */
	resolveRosterPack?: (
		packId: string,
	) =>
		| Promise<readonly RosterPackMember[]>
		| readonly RosterPackMember[];
};

export type DriveHarnessRooms = {
	createOrAttach(input: CreateOrAttachInput): Promise<RoomSnapshot>;
	addRosterPack(roomId: string, packId: string): Promise<RoomSnapshot>;
	setAddress(roomId: string, addressSet: AddressSet): Promise<RoomSnapshot>;
	raiseHand(
		roomId: string,
		participantId: string,
		raised: boolean,
	): Promise<RoomSnapshot>;
	setSharer(
		roomId: string,
		sharer: StageSharer | null,
		pin?: StagePin | null,
	): Promise<RoomSnapshot>;
	setSubMode(
		roomId: string,
		subMode: DriveSubMode,
		driveActive?: boolean,
	): Promise<RoomSnapshot>;
	/**
	 * Spotlight a seated participant via setStage (kernel setSpotlight check).
	 */
	setSpotlight(roomId: string, participantId: string): Promise<RoomSnapshot>;
};

export type DriveHarnessDirector = {
	readonly pickNextShow: typeof pickNextShowToPresent;
	readonly planShowIntents: typeof planShowIntents;
	readonly planRoute: typeof planRoute;
	readonly assertRouteLegal: typeof assertRouteLegal;
	readonly advanceScriptBeat: typeof advanceScriptBeat;
};

export type DriveHarness = {
	readonly host: DriveHostPort;
	start(): Promise<void>;
	onEvent(handler: (event: DriveEvent) => void): () => void;
	readonly rooms: DriveHarnessRooms;
	/**
	 * Pure Show/Director helpers. Live backlog commit stays on the hub
	 * (`drive.show.*`) until a DirectorPort extends the host.
	 */
	readonly director: DriveHarnessDirector;
};

export function createDriveHarness(
	options: CreateDriveHarnessOptions,
): DriveHarness {
	const { host, resolveRosterPack } = options;

	const requireRoom = async (roomId: string): Promise<RoomSnapshot> => {
		if (!host.getRoom) {
			throw new Error(
				"DriveHostPort.getRoom is required for DriveHarness room ops that read current state",
			);
		}
		const snapshot = await host.getRoom(roomId);
		if (!snapshot) {
			throw new Error(`room_not_found:${roomId}`);
		}
		return snapshot;
	};

	const rooms: DriveHarnessRooms = {
		async createOrAttach(input) {
			const roomId = input.roomId?.trim() || DRIVE_HARNESS_DEFAULT_ROOM_ID;
			const humanId = input.humanId.trim();
			if (!humanId) {
				throw new Error("humanId is required");
			}

			await host.commitRoomOp({
				type: "create",
				roomId,
				hostParticipantId: humanId,
			});

			const human: HumanParticipant = {
				id: humanId,
				kind: "human",
				displayName: input.humanDisplayName?.trim() || "You",
				role: "host",
				status: "idle",
			};
			let snapshot = await host.commitRoomOp({
				type: "join",
				roomId,
				participant: human,
			});

			const partner = input.partner === null ? null : (input.partner ?? {});
			let partnerId: string | null = null;
			if (partner) {
				partnerId = partner.id?.trim() || DRIVE_HARNESS_PARTNER_ID;
				const agent: AgentParticipant = {
					id: partnerId,
					kind: "agent",
					displayName: partner.displayName?.trim() || "Partner",
					role: "partner",
					status: "idle",
					seatSources: [],
				};
				snapshot = await host.commitRoomOp({
					type: "join",
					roomId,
					participant: agent,
				});
			}

			const activate =
				input.activateDrive !== false && partnerId != null;
			if (activate && partnerId) {
				snapshot = await host.commitRoomOp({
					type: "setMode",
					roomId,
					subMode: "act",
					driveActive: true,
				});
				snapshot = await host.commitRoomOp({
					type: "setStage",
					roomId,
					sharer: { kind: "agent", participantId: partnerId },
					pin: null,
				});
			}

			return snapshot;
		},

		async addRosterPack(roomId, packId) {
			if (!resolveRosterPack) {
				throw new Error(
					"addRosterPack requires createDriveHarness({ resolveRosterPack }) until durable packs land",
				);
			}
			const members = await resolveRosterPack(packId);
			if (!members.length) {
				return requireRoom(roomId);
			}

			let snapshot = await requireRoom(roomId);
			const seated = new Set(snapshot.participants.map((p) => p.id));

			for (const member of members) {
				if (seated.has(member.id)) {
					continue;
				}
				const agent: AgentParticipant = {
					id: member.id,
					kind: "agent",
					displayName: member.displayName,
					role: member.role ?? "specialist",
					status: "idle",
					seatSources: [packId],
				};
				snapshot = await host.commitRoomOp({
					type: "join",
					roomId,
					participant: agent,
				});
				seated.add(member.id);
			}
			return snapshot;
		},

		async setAddress(roomId, addressSet) {
			return host.commitRoomOp({
				type: "setAddress",
				roomId,
				addressSet,
			});
		},

		async raiseHand(roomId, participantId, raised) {
			return host.commitRoomOp({
				type: "raiseHand",
				roomId,
				participantId,
				raised,
			});
		},

		async setSharer(roomId, sharer, pin) {
			return host.commitRoomOp({
				type: "setStage",
				roomId,
				sharer,
				pin: pin === undefined ? undefined : pin,
			});
		},

		async setSubMode(roomId, subMode, driveActive) {
			return host.commitRoomOp({
				type: "setMode",
				roomId,
				subMode,
				driveActive,
			});
		},

		async setSpotlight(roomId, participantId) {
			const snapshot = await requireRoom(roomId);
			const seatedIds = new Set(snapshot.participants.map((p) => p.id));
			const check = setSpotlight({ participantId, seatedIds });
			if (!check.ok) {
				throw new Error(`${check.code}:${check.message}`);
			}
			const participant = snapshot.participants.find(
				(entry) => entry.id === participantId,
			);
			if (!participant) {
				throw new Error(`unknown_participant:${participantId}`);
			}
			return host.commitRoomOp({
				type: "setStage",
				roomId,
				sharer: {
					kind: participant.kind,
					participantId,
				},
				pin: null,
			});
		},
	};

	return {
		host,
		async start() {
			if (!host.capabilities.roomOps) {
				throw new Error("DriveHarness requires HostCapabilities.roomOps");
			}
			if (!host.capabilities.writerEndpoint.trim()) {
				throw new Error("DriveHarness requires HostCapabilities.writerEndpoint");
			}
		},
		onEvent(handler) {
			return host.subscribe(handler);
		},
		rooms,
		director: {
			pickNextShow: pickNextShowToPresent,
			planShowIntents,
			planRoute,
			assertRouteLegal,
			advanceScriptBeat,
		},
	};
}
