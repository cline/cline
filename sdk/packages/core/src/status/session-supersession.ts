import type { StatusState } from "@cline/shared";

/** Session-owned work that has not reached a terminal state. */
export const OPEN_STATUS_STATES: readonly StatusState[] = [
	"queued",
	"running",
	"blocked",
];
