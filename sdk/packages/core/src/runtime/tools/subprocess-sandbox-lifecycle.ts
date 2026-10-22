export const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647;

type ParentProcess = {
	once(event: "disconnect", listener: () => void): unknown;
	exit(code: number): unknown;
};

export function normalizeIdleTimeoutMs(
	timeoutMs: number | undefined,
): number | undefined {
	return typeof timeoutMs === "number" &&
		Number.isInteger(timeoutMs) &&
		timeoutMs > 0 &&
		timeoutMs <= MAX_NODE_TIMER_DELAY_MS
		? timeoutMs
		: undefined;
}

/** Ensure an IPC child cannot survive the process that owns it. */
export function installParentDisconnectGuard(
	target: ParentProcess = process,
): void {
	target.once("disconnect", () => target.exit(0));
}
