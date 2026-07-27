/**
 * Per-process gate for the CLI's `user.extension_activated` telemetry
 * event. Owns the boolean state in a tiny module so the production
 * `captureCliExtensionActivated` helper and the test-only reset helper
 * can share the same flag without exporting a publicly-visible setter
 * from the production telemetry module.
 *
 * Production code only ever calls {@link wasActivationCaptured} and
 * {@link markActivationCaptured}; resetting the gate is exposed only via
 * `apps/cli/src/utils/telemetry.test-helpers.ts`, which is not part of
 * the production import graph.
 *
 * @internal
 */
let captured = false;

/** Returns whether the activation event has already been emitted in this process. */
export function wasActivationCaptured(): boolean {
	return captured;
}

/** Marks the activation event as emitted so subsequent calls become no-ops. */
export function markActivationCaptured(): void {
	captured = true;
}

/**
 * Resets the gate. Intended exclusively for unit tests that need to
 * re-exercise the activation path; do not call from production code.
 *
 * @internal
 */
export function resetActivationGate(): void {
	captured = false;
}
