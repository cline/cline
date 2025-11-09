/**
 * Base interface for Text-to-Speech providers
 */

export interface TTSVoice {
	id: string
	name: string
	description?: string
	previewUrl?: string
}

export interface TTSOptions {
	voiceId: string
	text: string
	speed?: number
	stability?: number
	similarityBoost?: number
}

export interface TTSSynthesisResult {
	audioData: Uint8Array
	contentType: string
	error?: string
}

export interface TTSVoicesResult {
	voices: TTSVoice[]
	error?: string
}

export abstract class BaseTTSProvider {
	protected apiKey: string

	constructor(apiKey: string) {
		this.apiKey = apiKey
	}

	/**
	 * Synthesize speech from text
	 * @param options Synthesis options including text and voice settings
	 * @returns Audio buffer and content type
	 */
	abstract synthesizeSpeech(options: TTSOptions): Promise<TTSSynthesisResult>

	/**
	 * Get list of available voices
	 * @returns List of available voices
	 */
	abstract getAvailableVoices(): Promise<TTSVoicesResult>

	/**
	 * Validate API key by making a test request
	 * @returns True if API key is valid
	 */
	abstract validateApiKey(): Promise<boolean>
}
