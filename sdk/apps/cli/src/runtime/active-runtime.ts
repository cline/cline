let activeRuntimeAbort: (() => void) | undefined;
let activeRuntimeCleanup: (() => void) | undefined;

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
