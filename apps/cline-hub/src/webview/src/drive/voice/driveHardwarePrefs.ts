/**
 * Client-local audio hardware prefs for Drive (mic device + playback volume).
 * Not Drive facets: device ids are machine-specific and must not enter the
 * durable facet envelope / privacy catalog.
 */

export type DriveHardwarePrefs = {
	/** MediaDeviceInfo.deviceId for audioinput; undefined = browser default. */
	micDeviceId: string | undefined;
	/** Playback volume in [0, 1] for partner TTS. */
	outputVolume: number;
};

export const DEFAULT_DRIVE_HARDWARE_PREFS: DriveHardwarePrefs = {
	micDeviceId: undefined,
	outputVolume: 1,
};

export function clampOutputVolume(value: number): number {
	if (!Number.isFinite(value)) {
		return DEFAULT_DRIVE_HARDWARE_PREFS.outputVolume;
	}
	return Math.min(1, Math.max(0, value));
}

export function normalizeDriveHardwarePrefs(
	input: Partial<DriveHardwarePrefs> | null | undefined,
): DriveHardwarePrefs {
	const micDeviceId =
		typeof input?.micDeviceId === "string" && input.micDeviceId.length > 0
			? input.micDeviceId
			: undefined;
	return {
		micDeviceId,
		outputVolume: clampOutputVolume(
			input?.outputVolume ?? DEFAULT_DRIVE_HARDWARE_PREFS.outputVolume,
		),
	};
}

/** Constraints for getUserMedia when a preferred mic is selected. */
export function audioConstraintsForMicDevice(
	micDeviceId: string | undefined,
): MediaTrackConstraints | true {
	if (!micDeviceId) {
		return true;
	}
	return { deviceId: { ideal: micDeviceId } };
}
