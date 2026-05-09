import type { HubCommandEnvelope, HubEventEnvelope } from "@clinebot/shared";

export function eventNameForScheduleCommand(
	command: HubCommandEnvelope["command"],
): HubEventEnvelope["event"] | undefined {
	switch (command) {
		case "schedule.create":
			return "schedule.created";
		case "schedule.update":
		case "schedule.enable":
		case "schedule.disable":
			return "schedule.updated";
		case "schedule.delete":
			return "schedule.deleted";
		case "schedule.trigger":
			return "schedule.triggered";
		default:
			return undefined;
	}
}
