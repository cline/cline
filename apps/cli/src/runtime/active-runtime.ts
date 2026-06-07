let activeRuntimeAbort: (() => void) | undefined;
let activeRuntimeCleanup: (() => void) | undefined;
let abortGraceTimer: ReturnType<typeof setTimeout> | undefined;
let abortInProgress = false;
let savedRejectionListeners: Function[] | undefined;

export function setActiveRuntimeAbort(abortFn: (() => void) | undefined): void {
	activeRuntimeAbort = abortFn;
}

export function setActiveRuntimeCleanup(
	cleanupFn: (() => void) | undefined,
): void {
	activeRuntimeCleanup = cleanupFn;
}

export function abortActiveRuntime(): void {
	try {
		activeRuntimeAbort?.();
	} catch {
		// Best-effort abort path.
	}
}

export function cleanupActiveRuntime(): void {
	try {
		activeRuntimeCleanup?.();
	} catch {
		// Best-effort cleanup path.
	}
}

// AbortController.abort() can cause internal LLM streaming promises to
// reject outside the main run promise chain. The main run handles abort
// correctly (returns finishReason:"aborted"), but orphan rejections from
// the streaming layer or hub capability teardown surface as
// unhandledRejections and would otherwise crash the CLI.
export function markAbortInProgress(): void {
	if (abortInProgress) {
		return;
	}
	abortInProgress = true;
	if (abortGraceTimer) {
		clearTimeout(abortGraceTimer);
		abortGraceTimer = undefined;
	}
	// Temporarily replace all unhandledRejection listeners with a
	// suppressing handler. AbortController.abort() causes orphan promise
	// rejections in the LLM streaming layer that reach every registered
	// listener (including OpenTUI's error overlay). Swapping the listeners
	// is the only way to prevent them from surfacing to the user.
	savedRejectionListeners = process.rawListeners(
		"unhandledRejection",
	) as Function[];
	process.removeAllListeners("unhandledRejection");
	process.on("unhandledRejection", (_reason, promise) => {
		promise.catch(() => {});
	});
}

export function clearAbortInProgress(): void {
	if (abortGraceTimer) {
		clearTimeout(abortGraceTimer);
	}
	abortGraceTimer = setTimeout(() => {
		abortInProgress = false;
		abortGraceTimer = undefined;
		if (savedRejectionListeners) {
			process.removeAllListeners("unhandledRejection");
			for (const listener of savedRejectionListeners) {
				process.on(
					"unhandledRejection",
					listener as (...args: unknown[]) => void,
				);
			}
			savedRejectionListeners = undefined;
		}
	}, 2000);
}

export function isAbortInProgress(): boolean {
	return abortInProgress;
}
