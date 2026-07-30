/**
 * DriveHarness — composition root over DriveHostPort (drivecode-sdk MVP).
 * Proposes seating/address/stage/mode; host commits. No agent loop, no IO.
 */

import type {
	AddressSet,
	AgentParticipant,
	AgentProfile,
	DirectorScript,
	DriveEvent,
	DriveSubMode,
	HumanParticipant,
	PermissionPreset,
	RoomSnapshot,
	RosterPack,
	ShowBacklogItem,
	StagePin,
	StageSharer,
} from "@cline/shared";
import { pickNextShowToPresent } from "./director/pickNextShow.js";
import { planShowIntents } from "./director/planShowIntents.js";
import { advanceScriptBeat } from "./director/rankBacklogs.js";
import { expandRosterPack } from "./facets/expand.js";
import type { DirectorOpResult, DriveHostPort } from "./hostPort.js";
import { setSpotlight } from "./room/participantControls.js";
import {
	applySeatSourceDelta,
	planRemoveRosterPack,
} from "./room/seatSources.js";
import { assertRouteLegal, planRoute } from "./router/planRoute.js";

export const DRIVE_HARNESS_DEFAULT_ROOM_ID = "default" as const;
export const DRIVE_HARNESS_HUMAN_ID = "drive:human" as const;
export const DRIVE_HARNESS_PARTNER_ID = "drive:partner" as const;

const DEFAULT_INK = {
	kind: "token" as const,
	token: "foreground" as const,
};

/** Stub member list until durable RosterPack IO lands. */
export type RosterPackMember = {
	readonly id: string;
	readonly displayName: string;
	readonly role?: AgentParticipant["role"];
};

export type CreateOrAttachInput = {
	roomId?: string;
	humanId: string;
	humanDisplayName?: string;
	/** Human roster role (default "host"). */
	humanRole?: HumanParticipant["role"];
	/** When set, seats a pair_partner agent (default display "Partner"). */
	partner?: {
		id?: string;
		displayName?: string;
		/** Agent roster role (default "partner"). */
		role?: AgentParticipant["role"];
	} | null;
	/** Activate Drive + stage sharer on the partner (default true when partner seated). */
	activateDrive?: boolean;
};

export type CreateDriveHarnessOptions = {
	host: DriveHostPort;
	/**
	 * Resolves roster pack seats until durable RosterPack IO lands.
	 * Required for `rooms.addRosterPack`.
	 * Accepts either a full `RosterPack` or a stub member list.
	 */
	resolveRosterPack?: (
		packId: string,
	) =>
		| Promise<RosterPack | readonly RosterPackMember[] | null>
		| RosterPack
		| readonly RosterPackMember[]
		| null;
	/** Parent permission ceiling when expanding packs (default full). */
	parentPreset?: PermissionPreset;
	/** Max new seats from a single pack expand (default unlimited). */
	seatCap?: number;
	/** Optional profile map for expand; stubs are synthesized from members when omitted. */
	resolveProfiles?: (
		profileIds: readonly string[],
	) =>
		| Promise<ReadonlyMap<string, AgentProfile>>
		| ReadonlyMap<string, AgentProfile>;
};

export type DriveHarnessRooms = {
	createOrAttach(input: CreateOrAttachInput): Promise<RoomSnapshot>;
	addRosterPack(roomId: string, packId: string): Promise<RoomSnapshot>;
	removeRosterPack(roomId: string, packId: string): Promise<RoomSnapshot>;
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

export type DriveHarnessShows = {
	enqueue(
		roomId: string,
		showItem: ShowBacklogItem,
		opts?: { presentNow?: boolean },
	): Promise<DirectorOpResult>;
	present(roomId: string, showItem: ShowBacklogItem): Promise<DirectorOpResult>;
	tick(
		roomId: string,
		opts?: { preferShowId?: string | null },
	): Promise<DirectorOpResult>;
	planFromWork(
		roomId: string,
		workKind: "edit" | "command" | "test_result",
		ownerParticipantId: string,
		opts?: { nowMs?: number },
	): Promise<DirectorOpResult>;
};

export type DriveHarnessScripts = {
	attach(
		roomId: string,
		script: DirectorScript,
		opts?: { showItems?: ShowBacklogItem[] },
	): Promise<DirectorOpResult>;
	advance(roomId: string): Promise<DirectorOpResult>;
};

export type DriveHarness = {
	readonly host: DriveHostPort;
	start(): Promise<void>;
	onEvent(handler: (event: DriveEvent) => void): () => void;
	readonly rooms: DriveHarnessRooms;
	/**
	 * Pure Show/Director helpers (no host IO).
	 */
	readonly director: DriveHarnessDirector;
	/**
	 * Live Show backlog commits via DriveHostPort.commitDirectorOp.
	 */
	readonly shows: DriveHarnessShows;
	/**
	 * Script attach/advance commits via DriveHostPort.commitDirectorOp.
	 */
	readonly scripts: DriveHarnessScripts;
};

function isRosterPack(value: unknown): value is RosterPack {
	return (
		typeof value === "object" &&
		value !== null &&
		"members" in value &&
		"id" in value &&
		"slug" in value &&
		"addressable" in value &&
		Array.isArray((value as RosterPack).members) &&
		typeof (value as RosterPack).id === "string"
	);
}

function stubPackFromMembers(
	packId: string,
	members: readonly RosterPackMember[],
): RosterPack {
	return {
		id: packId,
		slug: packId,
		displayName: packId,
		members: members.map((member) => ({
			profileId: member.id,
			role: member.role === "partner" ? "pair_partner" : "specialist",
			override: { displayName: member.displayName },
		})),
		addressable: true,
	};
}

function stubProfilesFromPack(pack: RosterPack): Map<string, AgentProfile> {
	const profiles = new Map<string, AgentProfile>();
	for (const member of pack.members) {
		profiles.set(member.profileId, {
			id: member.profileId,
			ref: { kind: "builtin", id: member.profileId },
			displayName: member.override?.displayName ?? member.profileId,
			nameInk: member.override?.nameInk ?? DEFAULT_INK,
			bodyInk: member.override?.bodyInk ?? DEFAULT_INK,
		});
	}
	return profiles;
}

function agentRoleFromPack(
	role: RosterPack["members"][number]["role"],
): AgentParticipant["role"] {
	return role === "pair_partner" ? "partner" : "specialist";
}

export function createDriveHarness(
	options: CreateDriveHarnessOptions,
): DriveHarness {
	const {
		host,
		resolveRosterPack,
		parentPreset = "full",
		seatCap = Number.POSITIVE_INFINITY,
		resolveProfiles,
	} = options;

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

			let snapshot = await host.commitRoomOp({
				type: "create",
				roomId,
				hostParticipantId: humanId,
			});

			const isSeated = (participantId: string): boolean =>
				snapshot.participants.some(
					(participant) => participant.id === participantId,
				);

			if (!isSeated(humanId)) {
				const human: HumanParticipant = {
					id: humanId,
					kind: "human",
					displayName: input.humanDisplayName?.trim() || "You",
					role: input.humanRole ?? "host",
					status: "idle",
				};
				snapshot = await host.commitRoomOp({
					type: "join",
					roomId,
					participant: human,
				});
			}

			const partner = input.partner === null ? null : (input.partner ?? {});
			let partnerId: string | null = null;
			if (partner) {
				partnerId = partner.id?.trim() || DRIVE_HARNESS_PARTNER_ID;
				if (!isSeated(partnerId)) {
					const agent: AgentParticipant = {
						id: partnerId,
						kind: "agent",
						displayName: partner.displayName?.trim() || "Partner",
						role: partner.role ?? "partner",
						status: "idle",
						seatSources: [{ kind: "manual" }],
					};
					snapshot = await host.commitRoomOp({
						type: "join",
						roomId,
						participant: agent,
					});
				}
			}

			const activate =
				input.activateDrive !== false &&
				partnerId != null &&
				!snapshot.driveActive;
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
			const resolved = await resolveRosterPack(packId);
			if (!resolved) {
				return requireRoom(roomId);
			}

			const pack = isRosterPack(resolved)
				? resolved
				: stubPackFromMembers(packId, resolved);
			if (!pack.members.length) {
				return requireRoom(roomId);
			}

			const profileIds = pack.members.map((member) => member.profileId);
			const profiles =
				(await resolveProfiles?.(profileIds)) ?? stubProfilesFromPack(pack);
			const known = await host.resolveKnownAgents();
			const expanded = expandRosterPack({
				pack,
				profiles,
				known,
				parentPreset,
				seatCap,
			});

			let snapshot = await requireRoom(roomId);
			const packSource = { kind: "pack" as const, packId };

			for (const proposal of expanded.proposals) {
				const existing = snapshot.participants.find(
					(participant) => participant.id === proposal.profileId,
				);
				if (existing?.kind === "agent") {
					const delta = applySeatSourceDelta(existing.seatSources, {
						type: "add",
						source: packSource,
					});
					const unchanged =
						delta.next.length === existing.seatSources.length &&
						delta.next.every((source, index) => {
							const prior = existing.seatSources[index];
							return (
								prior !== undefined &&
								source.kind === prior.kind &&
								(source.kind !== "pack" ||
									(prior.kind === "pack" && source.packId === prior.packId)) &&
								(source.kind !== "spawn" ||
									(prior.kind === "spawn" &&
										source.parentId === prior.parentId))
							);
						});
					if (unchanged) {
						continue;
					}
					const updated: AgentParticipant = {
						...existing,
						seatSources: delta.next,
					};
					snapshot = await host.commitRoomOp({
						type: "join",
						roomId,
						participant: updated,
					});
					continue;
				}
				if (existing) {
					continue;
				}
				const agent: AgentParticipant = {
					id: proposal.profileId,
					kind: "agent",
					displayName: proposal.displayName,
					role: agentRoleFromPack(proposal.role),
					status: "idle",
					seatSources: [packSource],
				};
				snapshot = await host.commitRoomOp({
					type: "join",
					roomId,
					participant: agent,
				});
			}
			return snapshot;
		},

		async removeRosterPack(roomId, packId) {
			const removeKeys = new Set<string>([packId]);
			if (resolveRosterPack) {
				const resolved = await resolveRosterPack(packId);
				if (resolved && isRosterPack(resolved)) {
					removeKeys.add(resolved.id);
					if (resolved.slug?.trim()) {
						removeKeys.add(resolved.slug.trim());
					}
				}
			}

			let snapshot = await requireRoom(roomId);
			for (const key of removeKeys) {
				const actions = planRemoveRosterPack(snapshot.participants, key);
				for (const action of actions) {
					if (action.action === "leave") {
						snapshot = await host.commitRoomOp({
							type: "leave",
							roomId,
							participantId: action.participantId,
						});
						continue;
					}
					const existing = snapshot.participants.find(
						(participant) => participant.id === action.participantId,
					);
					if (!existing || existing.kind !== "agent") {
						continue;
					}
					snapshot = await host.commitRoomOp({
						type: "join",
						roomId,
						participant: {
							...existing,
							seatSources: action.seatSources,
						},
					});
				}
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

	const requireDirector = () => {
		if (!host.commitDirectorOp) {
			throw new Error(
				"DriveHostPort.commitDirectorOp is required for DriveHarness.shows/scripts",
			);
		}
		return host.commitDirectorOp;
	};

	const shows: DriveHarnessShows = {
		async enqueue(roomId, showItem, opts) {
			return requireDirector()({
				type: "enqueueShow",
				roomId,
				showItem,
				presentNow: opts?.presentNow,
			});
		},
		async present(roomId, showItem) {
			return requireDirector()({
				type: "presentShow",
				roomId,
				showItem,
			});
		},
		async tick(roomId, opts) {
			return requireDirector()({
				type: "tickShow",
				roomId,
				preferShowId: opts?.preferShowId,
			});
		},
		async planFromWork(roomId, workKind, ownerParticipantId, opts) {
			return requireDirector()({
				type: "planFromWork",
				roomId,
				workKind,
				ownerParticipantId,
				nowMs: opts?.nowMs,
			});
		},
	};

	const scripts: DriveHarnessScripts = {
		async attach(roomId, script, opts) {
			return requireDirector()({
				type: "attachScript",
				roomId,
				script,
				showItems: opts?.showItems,
			});
		},
		async advance(roomId) {
			return requireDirector()({
				type: "advanceScript",
				roomId,
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
				throw new Error(
					"DriveHarness requires HostCapabilities.writerEndpoint",
				);
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
		shows,
		scripts,
	};
}
