import type { TelemetryProperties } from "../providers/ITelemetryProvider"
import type { TelemetryService } from "../TelemetryService"
import { EventHandlerBase } from "./EventHandlerBase"

/**
 * Property types for dictation/voice telemetry events
 */

export interface VoiceRecordingStartedProperties extends TelemetryProperties {
	taskId?: string
	platform: string
	timestamp: string
}

export interface VoiceRecordingStoppedProperties extends TelemetryProperties {
	taskId?: string
	durationMs?: number
	success?: boolean
	platform: string
	timestamp: string
}

export interface VoiceTranscriptionStartedProperties extends TelemetryProperties {
	taskId?: string
	language?: string
	timestamp: string
}

export interface VoiceTranscriptionCompletedProperties extends TelemetryProperties {
	taskId?: string
	transcriptionLength?: number
	durationMs?: number
	language?: string
	accountType: string
	timestamp: string
}

export interface VoiceTranscriptionErrorProperties extends TelemetryProperties {
	taskId?: string
	errorType?: string
	errorMessage?: string
	durationMs?: number
	timestamp: string
}

/**
 * Event handler for dictation/voice-related telemetry events
 */
export class DictationEvents extends EventHandlerBase {
	static override readonly prefix = "dictation"

	/**
	 * Records when voice recording is started
	 * @param service The telemetry service instance
	 * @param taskId Optional task identifier if recording was started during a task
	 * @param platform The platform where recording is happening
	 */
	static captureVoiceRecordingStarted(service: TelemetryService, taskId?: string, platform?: string): void {
		const properties: VoiceRecordingStartedProperties = {
			taskId,
			platform: platform ?? process.platform,
			timestamp: new Date().toISOString(),
		}
		DictationEvents.capture(service, "voice.recording_started", properties)
	}

	/**
	 * Records when voice recording is stopped
	 * @param service The telemetry service instance
	 * @param taskId Optional task identifier
	 * @param durationMs Duration of the recording in milliseconds
	 * @param success Whether the recording was successful
	 * @param platform The platform where recording happened
	 */
	static captureVoiceRecordingStopped(
		service: TelemetryService,
		taskId?: string,
		durationMs?: number,
		success?: boolean,
		platform?: string,
	): void {
		const properties: VoiceRecordingStoppedProperties = {
			taskId,
			durationMs,
			success,
			platform: platform ?? process.platform,
			timestamp: new Date().toISOString(),
		}
		DictationEvents.capture(service, "voice.recording_stopped", properties)
	}

	/**
	 * Records when voice transcription is started
	 * @param service The telemetry service instance
	 * @param taskId Optional task identifier
	 * @param language Language hint provided for transcription
	 */
	static captureVoiceTranscriptionStarted(service: TelemetryService, taskId?: string, language?: string): void {
		const properties: VoiceTranscriptionStartedProperties = {
			taskId,
			language,
			timestamp: new Date().toISOString(),
		}
		DictationEvents.capture(service, "voice.transcription_started", properties)
	}

	/**
	 * Records when voice transcription is completed successfully
	 * @param service The telemetry service instance
	 * @param taskId Optional task identifier
	 * @param transcriptionLength Length of the transcribed text
	 * @param durationMs Time taken for transcription in milliseconds
	 * @param language Language used for transcription
	 * @param isOrgAccount Whether the transcription was done using an organization account
	 */
	static captureVoiceTranscriptionCompleted(
		service: TelemetryService,
		taskId?: string,
		transcriptionLength?: number,
		durationMs?: number,
		language?: string,
		isOrgAccount?: boolean,
	): void {
		const properties: VoiceTranscriptionCompletedProperties = {
			taskId,
			transcriptionLength,
			durationMs,
			language,
			accountType: isOrgAccount ? "organization" : "personal",
			timestamp: new Date().toISOString(),
		}
		DictationEvents.capture(service, "voice.transcription_completed", properties)
	}

	/**
	 * Records when voice transcription fails
	 * @param service The telemetry service instance
	 * @param taskId Optional task identifier
	 * @param errorType Type of error that occurred
	 * @param errorMessage The error message
	 * @param durationMs Time taken before failure in milliseconds
	 */
	static captureVoiceTranscriptionError(
		service: TelemetryService,
		taskId?: string,
		errorType?: string,
		errorMessage?: string,
		durationMs?: number,
	): void {
		const properties: VoiceTranscriptionErrorProperties = {
			taskId,
			errorType,
			errorMessage,
			durationMs,
			timestamp: new Date().toISOString(),
		}
		DictationEvents.capture(service, "voice.transcription_error", properties)
	}
}
