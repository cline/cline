import { MacOSScrollAccel } from "@opentui/core";

/**
 * Mouse wheel acceleration for the chat transcript.
 *
 * Without an acceleration, OpenTUI's scrollbox moves exactly one row per wheel
 * notch, so reaching the top of a long conversation takes dozens of notches.
 * `MacOSScrollAccel` keeps a single notch precise (a notch after a pause is
 * x1) and speeds up bursts of notches up to `maxMultiplier`, so a quick flick
 * covers a long transcript.
 */
export const TRANSCRIPT_SCROLL_ACCELERATION = {
	A: 1.2,
	tau: 2,
	maxMultiplier: 12,
} as const;

export function createTranscriptScrollAcceleration(): MacOSScrollAccel {
	return new MacOSScrollAccel({ ...TRANSCRIPT_SCROLL_ACCELERATION });
}
