export type DriveLaunchAction = "join" | "focus";

export type DriveOpenCallRequest = {
	action: DriveLaunchAction;
	roomId: string;
};

export type DriveLaunchRequest = DriveOpenCallRequest & {
	id: number;
};
