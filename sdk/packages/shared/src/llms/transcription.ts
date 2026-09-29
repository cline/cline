/** Short-lived browser credentials and the audio contract for a voice session. */
export type StreamingAudioTranscriptionSession = {
	token: string;
	url: string;
	sampleRate: number;
	expiresAt?: number;
} & (
	| {
			transport: "vercel-ai-gateway" | "openai-native";
			modelId: string;
			baseUrl: string;
	  }
	| { transport: "elevenlabs" }
);
