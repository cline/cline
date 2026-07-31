/**
 * The /fast slash command is a shortcut for Cline usage-based billing users
 * to jump straight to the fast variant of the flagship Opus model without
 * going through the /model picker.
 */

// Usage-based billing is the plain "cline" provider; "cline-pass"
// (subscription) intentionally does not get the shortcut.
export const FAST_MODEL_PROVIDER_ID = "cline";

export const FAST_MODEL_ID = "anthropic/claude-opus-5-fast";
export const FAST_MODEL_DISPLAY_NAME = "Claude Opus 5 (Fast)";

export function isFastModelSwitchAvailable(
	providerId: string | undefined,
): boolean {
	return providerId === FAST_MODEL_PROVIDER_ID;
}
