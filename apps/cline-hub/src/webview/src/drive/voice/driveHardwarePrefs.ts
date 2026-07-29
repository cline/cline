/**
 * Client-local audio hardware prefs for Drive (mic, speaker, playback volume).
 * Not Drive facets: device ids are machine-specific and must not enter the
 * durable facet envelope / privacy catalog.
 */

export type DriveHardwarePrefs = {
	/** MediaDeviceInfo.deviceId for audioinput; undefined = browser default. */
	micDeviceId: string | undefined;
	/** MediaDeviceInfo.deviceId for audiooutput; undefined = browser default. */
	speakerDeviceId: string | undefined;
	/** Playback volume in [0, 1] for partner TTS. */
	outputVolume: number;
};

export const DEFAULT_DRIVE_HARDWARE_PREFS: DriveHardwarePrefs = {
	micDeviceId: undefined,
	speakerDeviceId: undefined,
	outputVolume: 1,
};

export function clampOutputVolume(value: number): number {
	if (!Number.isFinite(value)) {
		return DEFAULT_DRIVE_HARDWARE_PREFS.outputVolume;
	}
	return Math.min(1, Math.max(0, value));
}

function normalizeDeviceId(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function normalizeDriveHardwarePrefs(
	input: Partial<DriveHardwarePrefs> | null | undefined,
): DriveHardwarePrefs {
	return {
		micDeviceId: normalizeDeviceId(input?.micDeviceId),
		speakerDeviceId: normalizeDeviceId(input?.speakerDeviceId),
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

type SinkTarget = {
	setSinkId?: (sinkId: string) => Promise<void>;
};

/**
 * Route an HTMLMediaElement (or AudioContext) to a preferred output device.
 * No-ops when sinkId is unset, unsupported, or the device is gone.
 */
export async function applyAudioOutputSinkId(
	target: SinkTarget,
	sinkId: string | undefined,
): Promise<{ ok: true } | { ok: false; reason: string }> {
	if (!sinkId) {
		return { ok: true };
	}
	if (typeof target.setSinkId !== "function") {
		return { ok: false, reason: "setSinkId_unsupported" };
	}
	try {
		await target.setSinkId(sinkId);
		return { ok: true };
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "setSinkId_failed";
		return { ok: false, reason: message };
	}
}
