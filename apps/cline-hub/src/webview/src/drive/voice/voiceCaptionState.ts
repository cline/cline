/**
 * Ephemeral voice caption helpers (DRV-CAPTIONS / DRV-PRIVACY).
 * Captions are React state only — never written to vscode setState / disk.
 */

/** After Discard: empty draft, no residue. */
export function clearVoiceCaptionDraft(): string {
	return "";
}

/** After Send spoken: clear draft once the prompt is handed off. */
export function clearVoiceCaptionAfterSend(): string {
	return "";
}

/**
 * Keys allowed in hub webview persistence for Drive.
 * Explicitly excludes caption / transcript fields.
 */
export const DRIVE_PERSIST_KEYS = ["driveUi", "driveVoice"] as const;

export type DrivePersistPayload = {
	driveUi: unknown;
	driveVoice: unknown;
};

/**
 * Build the Drive slice of vscode setState. Never includes voiceCaption,
 * caption, or transcript keys (privacy-strict).
 */
export function buildDrivePersistPayload(input: {
	existing?: Record<string, unknown>;
	driveUi: unknown;
	driveVoice: unknown;
}): Record<string, unknown> {
	const next: Record<string, unknown> = {
		...(input.existing ?? {}),
		driveUi: input.driveUi,
		driveVoice: input.driveVoice,
	};
	delete next.voiceCaption;
	delete next.caption;
	delete next.transcript;
	return next;
}

/** True when a persist blob accidentally carries caption-like keys. */
export function persistPayloadHasCaptionKeys(
	payload: Record<string, unknown>,
): boolean {
	return (
		Object.prototype.hasOwnProperty.call(payload, "voiceCaption") ||
		Object.prototype.hasOwnProperty.call(payload, "caption") ||
		Object.prototype.hasOwnProperty.call(payload, "transcript")
	);
}
