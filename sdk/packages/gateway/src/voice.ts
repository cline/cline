import {
	createStreamingAudioTranscriptionSession,
	type AudioTranscriptionRequest,
	type AudioTranscriptionResult,
	DEFAULT_TRANSCRIPTION_TIMEOUT_MS,
	getProvider,
	type ProviderConfig,
	type StreamingAudioTranscriptionSession,
	type StreamingAudioTranscriptionSessionRequest,
	transcribeAudio,
} from "@cline/llms";
import type { VoiceInputSelection } from "@cline/shared";
import type { GatewayGlobalSettingsStore } from "./global-settings";
import type { GatewayPaths } from "./paths";
import {
	readSavedProviderSelection,
	savedProviderApiKey,
	type GatewayProviderSettingsStore,
} from "./provider-settings";
import { readSecretFile } from "./secrets";

export const MAX_VOICE_AUDIO_BYTES = 25 * 1024 * 1024;
export const MAX_VOICE_AUDIO_BASE64_CHARACTERS =
	4 * Math.ceil(MAX_VOICE_AUDIO_BYTES / 3);
export const MAX_GATEWAY_VOICE_FRAME_CHARACTERS =
	MAX_VOICE_AUDIO_BASE64_CHARACTERS + 1024 * 1024;
export const VOICE_TRANSCRIPTION_TIMEOUT_MS = DEFAULT_TRANSCRIPTION_TIMEOUT_MS;

const STREAMING_SESSION_LIFETIME_SECONDS = 300;
const BASE64_PATTERN =
	/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export type GatewayVoiceErrorKind = "configuration" | "provider";

/** A voice error whose message is safe to return over the Gateway wire. */
export class GatewayVoiceError extends Error {
	readonly kind: GatewayVoiceErrorKind;

	constructor(kind: GatewayVoiceErrorKind, message: string) {
		super(message);
		this.name = "GatewayVoiceError";
		this.kind = kind;
	}
}

export interface GatewayVoicePrimitives {
	transcribeAudio(
		request: AudioTranscriptionRequest,
	): Promise<AudioTranscriptionResult>;
	createStreamingAudioTranscriptionSession(
		request: StreamingAudioTranscriptionSessionRequest,
	): Promise<StreamingAudioTranscriptionSession>;
}

export interface VoiceTranscriptionInput {
	readonly audioBase64: string;
	readonly mediaType?: string;
}

export interface VoiceTranscriptionResult {
	readonly text: string;
	readonly language?: string;
	readonly durationInSeconds?: number;
}

export interface VoiceStreamingSession {
	readonly token: string;
	readonly url: string;
	readonly expiresAt?: number;
}

export interface VoiceSettingsResult {
	readonly voiceInput?: VoiceInputSelection;
}

interface ResolvedVoiceTarget {
	readonly selection: VoiceInputSelection;
	readonly providerConfig: ProviderConfig;
}

export interface GatewayVoiceManagerOptions {
	readonly paths: GatewayPaths;
	readonly providerSettings: GatewayProviderSettingsStore;
	readonly globalSettings: GatewayGlobalSettingsStore;
	readonly env?: Record<string, string | undefined>;
	readonly primitives?: GatewayVoicePrimitives;
	/** Test seam; production always uses {@link MAX_VOICE_AUDIO_BYTES}. */
	readonly maxAudioBytes?: number;
}

/**
 * Gateway-owned voice selection and transcription boundary.
 *
 * Long-lived credentials are resolved inside the Gateway and are passed only
 * to @cline/llms. Provider failures are deliberately replaced at this
 * boundary because upstream response bodies may contain sensitive data.
 */
export class GatewayVoiceManager {
	private readonly paths: GatewayPaths;
	private readonly providerSettings: GatewayProviderSettingsStore;
	private readonly globalSettings: GatewayGlobalSettingsStore;
	private readonly env: Record<string, string | undefined>;
	private readonly primitives: GatewayVoicePrimitives;
	private readonly maxAudioBytes: number;

	constructor(options: GatewayVoiceManagerOptions) {
		this.paths = options.paths;
		this.providerSettings = options.providerSettings;
		this.globalSettings = options.globalSettings;
		this.env = options.env ?? process.env;
		this.primitives = options.primitives ?? {
			transcribeAudio,
			createStreamingAudioTranscriptionSession,
		};
		this.maxAudioBytes = options.maxAudioBytes ?? MAX_VOICE_AUDIO_BYTES;
	}

	selection(): VoiceInputSelection | undefined {
		return this.globalSettings.get().voiceInput;
	}

	async setSelection(
		selection: VoiceInputSelection | undefined,
	): Promise<VoiceSettingsResult> {
		if (!selection) {
			this.globalSettings.setVoiceInput(undefined);
			return {};
		}
		const normalized = normalizeSelection(selection);
		await this.validateSelection(normalized);
		this.globalSettings.setVoiceInput(normalized);
		return { voiceInput: normalized };
	}

	async transcribe(
		input: VoiceTranscriptionInput,
	): Promise<VoiceTranscriptionResult> {
		const audio = decodeAudioBase64(input.audioBase64, this.maxAudioBytes);
		const mediaType = normalizeAudioMediaType(input.mediaType);
		const target = await this.resolveTarget("batch");
		try {
			return await this.primitives.transcribeAudio({
				providerConfig: target.providerConfig,
				modelId: target.selection.modelId,
				audio,
				...(mediaType ? { mediaType } : {}),
				maxRetries: 0,
			});
		} catch {
			throw providerFailure(target.selection, "transcription");
		}
	}

	async createStreamingSession(): Promise<VoiceStreamingSession> {
		const target = await this.resolveTarget("streaming");
		try {
			return await this.primitives.createStreamingAudioTranscriptionSession({
				providerConfig: target.providerConfig,
				modelId: target.selection.modelId,
				expiresAfterSeconds: STREAMING_SESSION_LIFETIME_SECONDS,
			});
		} catch {
			throw providerFailure(target.selection, "streaming session setup");
		}
	}

	private async resolveTarget(
		mode: "batch" | "streaming",
	): Promise<ResolvedVoiceTarget> {
		const selection = this.selection();
		if (!selection) {
			throw new GatewayVoiceError(
				"configuration",
				"Voice input is not configured. Choose a transcription provider and model in Settings.",
			);
		}
		const normalized = normalizeSelection(selection);
		await this.validateSelection(normalized, mode);

		try {
			const [saved, provider] = await Promise.all([
				Promise.resolve(
					readSavedProviderSelection(normalized.providerId, {
						filePath: this.providerSettings.filePath,
						env: this.env,
					}),
				),
				getProvider(normalized.providerId),
			]);
			if (!saved) {
				throw missingProviderConfiguration(normalized.providerId);
			}
			const environmentCredential = provider?.env
				?.map((name) => this.env[name]?.trim())
				.find((value): value is string => Boolean(value));
			const credential =
				this.env.CLINE_GATEWAY_API_KEY?.trim() ||
				environmentCredential ||
				readSecretFile(this.paths, normalized.providerId)?.trim() ||
				savedProviderApiKey(normalized.providerId, saved.settings);
			if (!credential) {
				throw new GatewayVoiceError(
					"configuration",
					`No credential is configured for voice provider "${normalized.providerId}". Add one in Settings and try again.`,
				);
			}
			const configuredTimeout = saved.settings.timeout;
			return {
				selection: normalized,
				providerConfig: {
					providerId: normalized.providerId,
					modelId: normalized.modelId,
					apiKey: credential,
					baseUrl: saved.settings.baseUrl ?? provider?.baseUrl,
					headers: saved.settings.headers,
					timeoutMs: Math.min(
						configuredTimeout ?? VOICE_TRANSCRIPTION_TIMEOUT_MS,
						VOICE_TRANSCRIPTION_TIMEOUT_MS,
					),
				},
			};
		} catch (error) {
			if (error instanceof GatewayVoiceError) throw error;
			throw new GatewayVoiceError(
				"configuration",
				`Voice provider "${normalized.providerId}" could not be loaded. Check its settings and try again.`,
			);
		}
	}

	private async validateSelection(
		selection: VoiceInputSelection,
		mode?: "batch" | "streaming",
	): Promise<void> {
		const provider = this.providerSettings.get(selection.providerId);
		if (!provider?.enabled) {
			throw new GatewayVoiceError(
				"configuration",
				`Voice provider "${selection.providerId}" is not enabled. Enable it in Settings and try again.`,
			);
		}
		let models: Awaited<ReturnType<GatewayProviderSettingsStore["models"]>>;
		try {
			models = await this.providerSettings.models(selection.providerId);
		} catch {
			throw missingProviderConfiguration(selection.providerId);
		}
		const model = models.models.find(
			(candidate) => candidate.id === selection.modelId,
		);
		if (!model || model.operation !== "transcription") {
			throw new GatewayVoiceError(
				"configuration",
				`Model "${selection.modelId}" is not a transcription model for provider "${selection.providerId}". Choose another voice model in Settings.`,
			);
		}
		if (mode === "streaming" && !model.operationModes?.includes("streaming")) {
			throw new GatewayVoiceError(
				"configuration",
				`Voice model "${selection.modelId}" does not support streaming transcription. Choose a streaming model in Settings.`,
			);
		}
		if (
			mode === "batch" &&
			model.operationModes !== undefined &&
			!model.operationModes.includes("batch")
		) {
			throw new GatewayVoiceError(
				"configuration",
				`Voice model "${selection.modelId}" supports streaming only. Choose a batch transcription model in Settings.`,
			);
		}
	}
}

function normalizeSelection(
	selection: VoiceInputSelection,
): VoiceInputSelection {
	const providerId = selection.providerId.trim();
	const modelId = selection.modelId.trim();
	if (!providerId || !modelId) {
		throw new GatewayVoiceError(
			"configuration",
			"Both a voice provider and transcription model are required.",
		);
	}
	return { providerId, modelId };
}

function normalizeAudioMediaType(
	mediaType: string | undefined,
): string | undefined {
	const normalized = mediaType?.trim();
	if (!normalized) return undefined;
	if (
		normalized.length > 255 ||
		!normalized.toLowerCase().startsWith("audio/") ||
		/[\r\n]/.test(normalized)
	) {
		throw new GatewayVoiceError(
			"configuration",
			"Recorded audio has an invalid media type.",
		);
	}
	return normalized;
}

function decodeAudioBase64(value: string, maxAudioBytes: number): Uint8Array {
	if (
		!value ||
		value.length > 4 * Math.ceil(maxAudioBytes / 3) ||
		!BASE64_PATTERN.test(value)
	) {
		throw new GatewayVoiceError(
			"configuration",
			`Recorded audio must be valid base64 and no larger than ${Math.floor(maxAudioBytes / (1024 * 1024))} MiB.`,
		);
	}
	const audio = Buffer.from(value, "base64");
	if (audio.byteLength === 0 || audio.byteLength > maxAudioBytes) {
		throw new GatewayVoiceError(
			"configuration",
			`Recorded audio must be between 1 byte and ${Math.floor(maxAudioBytes / (1024 * 1024))} MiB.`,
		);
	}
	return audio;
}

function missingProviderConfiguration(providerId: string): GatewayVoiceError {
	return new GatewayVoiceError(
		"configuration",
		`Voice provider "${providerId}" is not configured. Configure and enable it in Settings, then try again.`,
	);
}

function providerFailure(
	selection: VoiceInputSelection,
	action: string,
): GatewayVoiceError {
	return new GatewayVoiceError(
		"provider",
		`Voice ${action} failed for "${selection.providerId}". Check the provider credential and selected model, then try again.`,
	);
}
