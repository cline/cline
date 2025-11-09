import type { BaseTTSProvider, TTSOptions, TTSSynthesisResult, TTSVoicesResult } from "./providers/BaseTTSProvider"
import { ElevenLabsProvider } from "./providers/ElevenLabsProvider"

/**
 * Supported TTS providers
 */
export type TTSProvider = "elevenlabs" | "openai"

/**
 * Configuration for TTS service
 */
export interface TTSConfig {
	provider: TTSProvider
	apiKey: string
}

/**
 * Text-to-Speech Service
 * Manages TTS provider instances and handles speech synthesis requests
 */
export class TextToSpeechService {
	private provider: BaseTTSProvider | null = null
	private currentConfig: TTSConfig | null = null

	/**
	 * Initialize the TTS service with configuration
	 */
	async initialize(config: TTSConfig): Promise<void> {
		// Only reinitialize if config changed
		if (
			this.currentConfig &&
			this.currentConfig.provider === config.provider &&
			this.currentConfig.apiKey === config.apiKey
		) {
			return
		}

		this.currentConfig = config
		this.provider = this.createProvider(config)
	}

	/**
	 * Create a TTS provider instance based on configuration
	 */
	private createProvider(config: TTSConfig): BaseTTSProvider {
		switch (config.provider) {
			case "elevenlabs":
				return new ElevenLabsProvider(config.apiKey)
			case "openai":
				// TODO: Implement OpenAI TTS provider
				throw new Error("OpenAI TTS provider not yet implemented")
			default:
				throw new Error(`Unsupported TTS provider: ${config.provider}`)
		}
	}

	/**
	 * Synthesize speech from text
	 */
	async synthesizeSpeech(options: TTSOptions): Promise<TTSSynthesisResult> {
		if (!this.provider) {
			throw new Error("TTS service not initialized. Call initialize() first.")
		}

		return this.provider.synthesizeSpeech(options)
	}

	/**
	 * Get available voices for the current provider
	 */
	async getAvailableVoices(): Promise<TTSVoicesResult> {
		if (!this.provider) {
			throw new Error("TTS service not initialized. Call initialize() first.")
		}

		return this.provider.getAvailableVoices()
	}

	/**
	 * Validate the current API key
	 */
	async validateApiKey(): Promise<boolean> {
		if (!this.provider) {
			return false
		}

		return this.provider.validateApiKey()
	}

	/**
	 * Check if service is initialized
	 */
	isInitialized(): boolean {
		return this.provider !== null
	}

	/**
	 * Get current provider type
	 */
	getCurrentProvider(): TTSProvider | null {
		return this.currentConfig?.provider ?? null
	}
}
