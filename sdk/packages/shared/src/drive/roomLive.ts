import { z } from "zod";
import {
	ParticipantAudioFlagsSchema,
	StageDirectorStateSchema,
} from "./director";

export const DriveRoomLiveStateSchema = z
	.object({
		roomId: z.string().min(1),
		spotlightParticipantId: z.string().min(1).nullable(),
		participantAudio: z.array(ParticipantAudioFlagsSchema),
		director: StageDirectorStateSchema,
		seatedParticipantIds: z.array(z.string().min(1)),
		version: z.number().int().nonnegative(),
	})
	.strict();
export type DriveRoomLiveState = z.infer<typeof DriveRoomLiveStateSchema>;

export function parseDriveRoomLiveState(input: unknown): DriveRoomLiveState {
	return DriveRoomLiveStateSchema.parse(input);
}

export function createEmptyDriveRoomLiveState(
	roomId: string,
): DriveRoomLiveState {
	return {
		roomId,
		spotlightParticipantId: null,
		participantAudio: [],
		director: {
			doBacklog: [],
			showBacklog: [],
			activeScript: null,
			activeBeatId: null,
			activeShowId: null,
			stickyShowIds: [],
			spotlightParticipantId: null,
			lastPresentedAt: null,
		},
		seatedParticipantIds: [],
		version: 0,
	};
}
