export function shouldHandleInputHistory(input: {
	isRunning: boolean;
	hasQueuedPrompts: boolean;
}): boolean {
	return !input.isRunning || !input.hasQueuedPrompts;
}
