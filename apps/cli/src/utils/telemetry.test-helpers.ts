/**
 * Test-only helpers for the CLI telemetry module. Kept in a separate
 * file (and outside the production `telemetry.ts` export surface) so
 * downstream bundlers and external consumers cannot accidentally call
 * them and silently reset production-side state.
 *
 * Only unit tests under `apps/cli/src/utils/` should import from this
 * module. The production CLI never imports it.
 *
 * @internal
 */
import { resetActivationGate } from "./telemetry.activation-gate";

/**
 * Resets the memoized `user.extension_activated` gate so unit tests can
 * re-exercise the activation path deterministically. No-op in
 * production code paths.
 *
 * @internal
 */
export function resetCliExtensionActivationForTests(): void {
	resetActivationGate();
}
